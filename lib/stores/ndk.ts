// lib/stores/ndk.ts

// Feature flags for the application
export const FLAGS = {
  // Flag to toggle between React Query Auth system and legacy auth
  useReactQueryAuth: false,
};
import 'react-native-get-random-values';
import { create } from 'zustand';
import NDK, { 
  NDKEvent, 
  NDKUser,
  NDKRelay,
  NDKPrivateKeySigner,
  NDKSigner
} from '@nostr-dev-kit/ndk-mobile';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { getCredentialWithFallback } from '@/lib/auth/persistence/secureStorage';
import { SECURE_STORE_KEYS } from '@/lib/auth/constants';
import { PlatformConstants } from '@/lib/platform';

// Constants for SecureStore
const PRIVATE_KEY_STORAGE_KEY = SECURE_STORE_KEYS.PRIVATE_KEY;

// Default relays
const DEFAULT_RELAYS = [
  'wss://powr.duckdns.org',
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://purplepag.es',
  'wss://nos.lol'
];

type NDKStoreState = {
  ndk: NDK | null;
  currentUser: NDKUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: Error | null;
  relayStatus: Record<string, 'connected' | 'connecting' | 'disconnected'>;
};

type NDKStoreActions = {
  init: () => Promise<void>;
  login: (privateKey?: string) => Promise<boolean>;
  loginWithExternalSigner: (pubkey: string, packageName: string) => Promise<boolean>;
  logout: () => Promise<void>;
  autoRestoreCredentials: () => Promise<boolean>;
  generateKeys: () => { privateKey: string; publicKey: string; nsec: string; npub: string };
  publishEvent: (kind: number, content: string, tags: string[][]) => Promise<NDKEvent | null>;
  fetchUserProfile: (pubkey: string) => Promise<NDKUser | null>;
  fetchEventsByFilter: (filter: any) => Promise<NDKEvent[]>;
};

// Helper to convert byte array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Helper to convert hex string to byte array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export const useNDKStore = create<NDKStoreState & NDKStoreActions>((set, get) => ({
  ndk: null,
  currentUser: null,
  isLoading: false,
  isAuthenticated: false,
  error: null,
  relayStatus: {},

  init: async () => {
    try {
      console.log('[NDK] Initializing...');
      set({ isLoading: true, error: null });

      // Check if we're on web and adjust settings accordingly
      const isWeb = PlatformConstants.isWeb;
      if (isWeb) {
        console.log('[NDK] Web platform detected, using web-compatible settings');
      }

      // Initialize NDK with relays
      const ndk = new NDK({
        explicitRelayUrls: DEFAULT_RELAYS,
        enableOutboxModel: isWeb, // Use outbox model for web to avoid websocket compatibility issues
        // Add web-specific options to improve reliability
        ...(isWeb ? { 
          connectionTimeout: 5000,
          explicitRelayUrls: DEFAULT_RELAYS.slice(0, 3) // Use fewer relays on web to avoid connection issues
        } : {})
      });
      
      // Setup relay status tracking
      const relayStatus: Record<string, 'connected' | 'connecting' | 'disconnected'> = {};
      DEFAULT_RELAYS.forEach(url => {
        relayStatus[url] = 'connecting';
      });
      
      // Set NDK instance early so we can use it even if connections fail
      set({ ndk, relayStatus });
      
      try {
        // Add listeners first so we can track connection status
        ndk.pool.on('relay:connect', (relay: NDKRelay) => {
          console.log(`[NDK] Relay connected: ${relay.url}`);
          set(state => ({
            relayStatus: {
              ...state.relayStatus,
              [relay.url]: 'connected'
            }
          }));
        });
        
        ndk.pool.on('relay:disconnect', (relay: NDKRelay) => {
          console.log(`[NDK] Relay disconnected: ${relay.url}`);
          set(state => ({
            relayStatus: {
              ...state.relayStatus,
              [relay.url]: 'disconnected'
            }
          }));
        });
        
        // Connect to relays
        if (!isWeb) {
          // On native, we always try to connect
          await ndk.connect();
          console.log('[NDK] Connected to relays');
        } else {
          // On web, try to connect with a timeout to avoid hanging
          const connectPromise = ndk.connect();
          const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 5000));
          await Promise.race([connectPromise, timeoutPromise]);
          console.log('[NDK] Attempted to connect to relays (web platform)');
        }

        // Attempt to restore user session
        await get().autoRestoreCredentials();
      } catch (connectionError) {
        // On connection errors, we still want to keep the NDK instance
        console.warn('[NDK] Error connecting to relays:', connectionError);
        // But we update the error state
        set({ 
          error: connectionError instanceof Error 
            ? connectionError 
            : new Error('Failed to connect to relays')
        });
      }

      set({ isLoading: false });
    } catch (error) {
      console.error('[NDK] Initialization error:', error);
      set({ error: error instanceof Error ? error : new Error('Failed to initialize NDK'), isLoading: false });
    }
  },
  
  autoRestoreCredentials: async () => {
    console.log('[NDK] Attempting to restore credentials');
    try {
      const { ndk } = get();
      if (!ndk) {
        console.warn('[NDK] No NDK instance available');
        return false;
      }
      
      // Check for stored private key
      const privateKeyHex = await getCredentialWithFallback(
        PRIVATE_KEY_STORAGE_KEY,
        ['powr.private_key', 'nostr_privkey']
      );
      
      if (privateKeyHex) {
        console.log('[NDK] Found stored credentials, attempting login');
        return await get().login(privateKeyHex);
      } else {
        console.log('[NDK] No stored credentials found');
        
        // Try legacy authentication system if no credentials found via main method
        try {
          console.log('[NDK] Using legacy authentication system');
          // Legacy: Check for saved private key
          const legacyKeyHex = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
          if (legacyKeyHex) {
            console.log('[NDK] Found saved private key, initializing signer');
            
            try {
              await get().login(legacyKeyHex);
              return true;
            } catch (error) {
              console.error('[NDK] Error initializing with saved key:', error);
              // Remove invalid key
              await SecureStore.deleteItemAsync(PRIVATE_KEY_STORAGE_KEY);
            }
          }
        } catch (legacyError) {
          console.warn('[NDK] Legacy auth system failed:', legacyError);
        }
        
        return false;
      }
    } catch (error) {
      console.warn('[NDK] Failed to restore credentials:', error);
      return false;
    }
  },
  
  login: async (privateKey?: string) => {
    try {
      console.log('[NDK] Login attempt starting');
      set({ isLoading: true, error: null });
      
      const { ndk } = get();
      if (!ndk) {
        throw new Error('NDK not initialized');
      }
      
      // Generate new keys if none provided
      if (!privateKey) {
        console.log('[NDK] No private key provided, generating new keys');
        const { privateKey: newPrivateKey } = get().generateKeys();
        privateKey = newPrivateKey;
      }
      
      // Create signer from private key
      try {
        const privateKeyBytes = hexToBytes(privateKey!);
        const signer = new NDKPrivateKeySigner(privateKeyBytes);
        ndk.signer = signer;
        
        // Get user from signer
        const user = await ndk.signer.user();
        if (!user) {
          throw new Error('Failed to get user from signer');
        }
        
        // Set current user and authenticated state
        set({ 
          currentUser: user,
          isAuthenticated: true,
          isLoading: false 
        });
        
        // Store credentials securely
        await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, privateKey!);
        
        console.log('[NDK] Login successful with pubkey:', user.pubkey);
        return true;
      } catch (error) {
        console.error('[NDK] Login error:', error);
        set({ 
          error: error instanceof Error ? error : new Error('Failed to login'), 
          isLoading: false 
        });
        return false;
      }
    } catch (error) {
      console.error('[NDK] Login error:', error);
      set({ 
        error: error instanceof Error ? error : new Error('Failed to login'), 
        isLoading: false 
      });
      return false;
    }
  },
  
  logout: async () => {
    try {
      console.log('[NDK] Logging out...');
      
      // Clear stored credentials
      try {
        // Use the more flexible credential helper
        const privateKey = await getCredentialWithFallback(PRIVATE_KEY_STORAGE_KEY, []);
        if (privateKey) {
          await SecureStore.deleteItemAsync(PRIVATE_KEY_STORAGE_KEY);
        }
      } catch (storageError) {
        console.warn('[NDK] Error removing credentials from storage:', storageError);
      }
      
      // Reset NDK state
      const { ndk } = get();
      if (ndk) {
        ndk.signer = undefined;
      }
      
      // Reset the user state
      set({ 
        currentUser: null,
        isAuthenticated: false 
      });
      
      console.log('[NDK] User logged out successfully');
    } catch (error) {
      console.error('[NDK] Logout error:', error);
    }
  },

  loginWithExternalSigner: async (pubkey: string, packageName: string) => {
    set({ isLoading: true, error: null });
    console.log('[NDK] External signer login attempt starting');
    
    try {
      const { ndk } = get();
      if (!ndk) {
        console.log('[NDK] Error: NDK not initialized');
        throw new Error('NDK not initialized');
      }
      
      // Check if we're on web platform
      if (PlatformConstants.isWeb) {
        throw new Error('External signers are not supported on web');
      }
      
      // This part would depend on how you implement external signers
      // For now, we'll just create a placeholder
      throw new Error('External signers not implemented yet');
    } catch (error) {
      console.error('[NDK] External signer login error:', error);
      set({ 
        error: error instanceof Error ? error : new Error('Failed to login with external signer'), 
        isLoading: false 
      });
      return false;
    }
  },
  
  generateKeys: () => {
    try {
      // Generate a new secret key (returns Uint8Array)
      const secretKeyBytes = generateSecretKey();
      
      // Convert to hex for storage
      const privateKey = bytesToHex(secretKeyBytes);
      
      // Get public key
      const publicKey = getPublicKey(secretKeyBytes);
      
      // Generate nsec and npub 
      const nsec = nip19.nsecEncode(secretKeyBytes);
      const npub = nip19.npubEncode(publicKey);
      
      return {
        privateKey,
        publicKey,
        nsec,
        npub
      };
    } catch (error) {
      console.error('[NDK] Error generating keys:', error);
      set({ error: error instanceof Error ? error : new Error('Failed to generate keys') });
      throw error;
    }
  },
  
  publishEvent: async (kind: number, content: string, tags: string[][]) => {
    try {
      const { ndk, isAuthenticated, currentUser } = get();
      
      if (!ndk) {
        throw new Error('NDK not initialized');
      }
      
      if (!isAuthenticated || !currentUser) {
        throw new Error('Not authenticated');
      }
      
      // Create event
      const event = new NDKEvent(ndk);
      event.kind = kind;
      event.content = content;
      event.tags = tags;
      
      // Sign and publish
      await event.sign();
      await event.publish();
      
      console.log('Event published successfully:', event.id);
      return event;
    } catch (error) {
      console.error('Error publishing event:', error);
      set({ error: error instanceof Error ? error : new Error('Failed to publish event') });
      return null;
    }
  },
  
  // Fetch profile for any user
  fetchUserProfile: async (pubkey: string) => {
    try {
      const { ndk } = get();
      if (!ndk) {
        throw new Error('NDK not initialized');
      }
      
      const user = ndk.getUser({ pubkey });
      await user.fetchProfile();
      
      return user;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      set({ error: error instanceof Error ? error : new Error('Failed to fetch user profile') });
      return null;
    }
  },
  
  // Fetch events by filter
  fetchEventsByFilter: async (filter: any) => {
    try {
      const { ndk } = get();
      if (!ndk) {
        throw new Error('NDK not initialized');
      }
      
      // Fetch events using NDK
      const events = await ndk.fetchEvents(filter);
      
      return Array.from(events);
    } catch (error) {
      console.error('Error fetching events:', error);
      set({ error: error instanceof Error ? error : new Error('Failed to fetch events') });
      return [];
    }
  }
}));

// Export hooks for using the store
export function useNDK() {
  return useNDKStore(state => ({
    ndk: state.ndk,
    isLoading: state.isLoading,
    error: state.error,
    init: state.init
  }));
}

export function useNDKCurrentUser() {
  return useNDKStore(state => ({
    currentUser: state.currentUser,
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading
  }));
}

export function useNDKAuth() {
  return useNDKStore(state => ({
    login: state.login,
    logout: state.logout,
    generateKeys: state.generateKeys,
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading
  }));
}

export function useNDKEvents() {
  return useNDKStore(state => ({
    publishEvent: state.publishEvent,
    fetchEventsByFilter: state.fetchEventsByFilter
  }));
}
