// lib/initNDK.ts
import 'react-native-get-random-values'; // This must be the first import
import NDK, { NDKCacheAdapterSqlite } from '@nostr-dev-kit/ndk-mobile';
import * as SecureStore from 'expo-secure-store';
import { RelayService, DEFAULT_RELAYS } from '@/lib/db/services/RelayService';
import { extendNDK } from '@/types/ndk-extensions';
import { ConnectivityService } from '@/lib/db/services/ConnectivityService';
import { profileImageCache } from '@/lib/db/services/ProfileImageCache';
import { PlatformConstants } from '@/lib/platform';

// Connection timeout in milliseconds
const CONNECTION_TIMEOUT = 5000;

/**
 * Initialize NDK with relays
 * @param initContext Optional string indicating which system is initializing NDK
 */
export async function initializeNDK(initContext?: string) {
  console.log(`[NDK] Initializing NDK with platform adapter... (context: ${initContext || 'unknown'})`);
  
  // Detect platform to use appropriate cache adapter
  const isWeb = PlatformConstants.isWeb;
  console.log(`[NDK] Platform detected: ${isWeb ? 'web' : 'native'}`);
  
  let cacheAdapter;
  // Skip cache adapter on web platform entirely
  if (isWeb) {
    console.log('[NDK] Web platform detected - cache adapter not supported');
    cacheAdapter = undefined;
  } else {
    try {
      // Try to initialize cache adapter for native platforms
      console.log('[NDK] Attempting to initialize SQLite cache adapter');
      
      // Note: We're avoiding direct constructor call due to API inconsistencies
      // Instead, set to undefined and let the NDK constructor handle it
      cacheAdapter = undefined;
      
      console.log('[NDK] Will use NDK without explicit cache adapter');
    } catch (error) {
      console.warn('[NDK] Error with cache adapter handling:', error);
      console.log('[NDK] Continuing without cache adapter');
      cacheAdapter = undefined;
    }
  }
  
  // Initialize relay service
  const relayService = new RelayService();
  relayService.enableDebug();
  
  // Create platform-compatible settings store
  const settingsStore = {
    get: async (key: string) => {
      try {
        if (isWeb) {
          return localStorage.getItem(key);
        } else {
          return await SecureStore.getItemAsync(key);
        }
      } catch (error) {
        console.warn(`[Settings] Error getting value for key ${key}:`, error);
        return null;
      }
    },
    set: async (key: string, value: string) => {
      try {
        if (isWeb) {
          localStorage.setItem(key, value);
          return true;
        } else {
          return await SecureStore.setItemAsync(key, value);
        }
      } catch (error) {
        console.warn(`[Settings] Error setting value for key ${key}:`, error);
        return false;
      }
    },
    delete: async (key: string) => {
      try {
        if (isWeb) {
          localStorage.removeItem(key);
          return true;
        } else {
          return await SecureStore.deleteItemAsync(key);
        }
      } catch (error) {
        console.warn(`[Settings] Error deleting key ${key}:`, error);
        return false;
      }
    },
    getSync: (key: string) => {
      try {
        if (isWeb) {
          return localStorage.getItem(key);
        } else {
          console.log('[Settings] Warning: getSync called on native platform, not directly supported');
          return null;
        }
      } catch (error) {
        console.warn(`[Settings] Error in getSync for key ${key}:`, error);
        return null;
      }
    }
  };
  
  // Initialize NDK with default relays first
  console.log(`[NDK] Creating NDK instance with default relays (context: ${initContext || 'unknown'})`);
  
  // Configure NDK options based on platform
  const ndkOptions = {
    cacheAdapter,
    explicitRelayUrls: isWeb ? DEFAULT_RELAYS.slice(0, 3) : DEFAULT_RELAYS, // Use fewer relays on web
    enableOutboxModel: isWeb, // Use outbox model on web for better compatibility
    autoConnectUserRelays: !isWeb, // Disable autoConnect on web to manage connections manually
    clientName: 'powr',
    connectionTimeout: isWeb ? 3000 : 5000, // Shorter timeout on web
    debug: true, // Enable debug logging
  };
  
  console.log(`[NDK] Creating NDK instance with platform-specific options:`, 
    JSON.stringify(ndkOptions, (key, value) => 
      key === 'cacheAdapter' ? (value ? '[Cache Adapter Instance]' : 'undefined') : value
    )
  );
  
  let ndk = new NDK(ndkOptions);
  
  // Extend NDK with helper methods for better compatibility
  ndk = extendNDK(ndk);
  
  // Set the NDK instance in services
  relayService.setNDK(ndk);
  profileImageCache.setNDK(ndk);
  
  // Check network connectivity before attempting to connect
  const connectivityService = ConnectivityService.getInstance();
  const isOnline = await connectivityService.checkNetworkStatus();
  
  if (!isOnline) {
    console.log(`[NDK] No network connectivity detected, skipping relay connections (context: ${initContext || 'unknown'})`);
    return { 
      ndk, 
      relayService,
      connectedRelayCount: 0,
      connectedRelays: [],
      offlineMode: true,
      initContext
    };
  }
  
  try {
    console.log(`[NDK] Connecting to relays with platform-specific handling... (context: ${initContext || 'unknown'})`);
    
    // Platform-specific connection handling
    if (isWeb) {
      console.log(`[NDK] Web platform detected, using modified connection approach`);
      
      // On web, we'll use a more cautious approach with shorter timeouts
      try {
        // Set up event listeners before connection to capture early events
        ndk.pool.on('relay:connect', (relay: any) => {
          console.log(`[NDK:Web] Relay connected: ${relay.url}`);
        });
        
        ndk.pool.on('relay:disconnect', (relay: any) => {
          console.log(`[NDK:Web] Relay disconnected: ${relay.url}`);
        });
        
        // Custom error logging - safe approach without using unsupported event names
        try {
          // @ts-ignore - Handle error events even if not in TypeScript definition
          ndk.pool.on('error', (relay: any, err: Error) => {
            console.warn(`[NDK:Web] Relay error:`, err?.message || 'Unknown error');
          });
        } catch (listenerErr) {
          console.log('[NDK:Web] Unable to register error listener, will continue without it');
        }
        
        // Use Promise.race with a shorter timeout for web
        const connectPromise = ndk.connect();
        const webTimeoutPromise = new Promise<void>((resolve) => {
          setTimeout(() => {
            console.log(`[NDK:Web] Connection grace period reached, proceeding with available relays...`);
            resolve(); // On web, we resolve rather than reject on timeout to gracefully continue
          }, 3000); // Much shorter timeout for web
        });
        
        // On web we'll continue regardless of the race outcome
        await Promise.race([connectPromise, webTimeoutPromise]).catch(err => {
          console.warn(`[NDK:Web] Connection process warning: ${err?.message || 'Unknown error'}`);
          // We intentionally don't re-throw here to continue the flow
        });
        
        console.log(`[NDK:Web] Connection process complete, proceeding with available relays`);
      } catch (webConnErr) {
        console.warn(`[NDK:Web] Error during web connection process:`, webConnErr);
        // Continue execution rather than throwing on web platform
      }
    } else {
      // Native platforms use the original approach with longer timeouts
      // Create a promise that will reject after the timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout')), CONNECTION_TIMEOUT);
      });
      
      // Race the connect operation against the timeout
      await Promise.race([
        ndk.connect(),
        timeoutPromise
      ]).catch(error => {
        if (error.message === 'Connection timeout') {
          console.warn(`[NDK] Connection timeout reached, continuing in offline mode (context: ${initContext || 'unknown'})`);
          throw error; // Re-throw to be caught by outer try/catch
        }
        throw error;
      });
    }
    
    // Wait a moment for connections to establish (shorter on web)
    await new Promise(resolve => setTimeout(resolve, isWeb ? 500 : 1000));
    
    // Get updated relay statuses (with error handling for web)
    let relaysWithStatus = [];
    try {
      relaysWithStatus = await relayService.getAllRelaysWithStatus();
    } catch (statusErr) {
      console.warn(`[NDK] Error getting relay statuses:`, statusErr);
      // Create a fallback status list
      relaysWithStatus = (ndkOptions.explicitRelayUrls || []).map(url => ({
        url,
        status: 'unknown'
      }));
    }
    
    // Count connected relays (cautiously)
    const connectedRelays = relaysWithStatus
      .filter(relay => relay.status === 'connected')
      .map(relay => relay.url);
    
    console.log(`[NDK] Connected to ${connectedRelays.length}/${relaysWithStatus.length} relays (context: ${initContext || 'unknown'})`);
    
    // Log detailed relay status
    console.log(`[NDK] Detailed relay status (context: ${initContext || 'unknown'}):`);
    
    // If relaysWithStatus is empty or has unexpected format, provide fallback logging
    if (relaysWithStatus.length === 0) {
      console.log(`  - No relay status information available`);
    }
    relaysWithStatus.forEach(relay => {
      console.log(`  - ${relay.url}: ${relay.status}`);
    });
    
    return { 
      ndk, 
      relayService,
      connectedRelayCount: connectedRelays.length,
      connectedRelays,
      offlineMode: connectedRelays.length === 0,
      initContext
    };
  } catch (error) {
    console.error(`[NDK] Error during connection (context: ${initContext || 'unknown'}):`, error);
    // Still return the NDK instance so the app can work offline
    return { 
      ndk, 
      relayService,
      connectedRelayCount: 0,
      connectedRelays: [],
      offlineMode: true,
      initContext
    };
  }
}
