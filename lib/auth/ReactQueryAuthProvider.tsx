import React, { ReactNode, useEffect, useState, createContext, useMemo, useRef, useContext } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../queryClient';
import NDK from '@nostr-dev-kit/ndk-mobile';
import { initializeNDK } from '@/lib/initNDK';
import { createLogger } from '@/lib/utils/logger';
import * as SecureStore from 'expo-secure-store';
import { SECURE_STORE_KEYS } from './constants';  

// Create auth-specific logger
const logger = createLogger('ReactQueryAuthProvider');

// Create context for NDK instance
interface NDKContextInterface {
  ndk: NDK | null;
  isInitialized: boolean;
}

export const NDKContext = createContext<NDKContextInterface>({
  ndk: null,
  isInitialized: false,
});

interface ReactQueryAuthProviderProps {
  children: ReactNode;
  enableOfflineMode?: boolean;
  queryClient?: QueryClient;
  enableNDK?: boolean; // New prop to control NDK initialization
}

/**
 * ReactQueryAuthProvider - Enhanced with persistence support
 * 
 * Main provider component for React Query integration with authentication.
 * This component:
 * - Creates and configures the QueryClient
 * - Creates an NDK instance with proper credential restoration
 * - Provides React Query context and NDK context
 * - Ensures consistent hook ordering regardless of initialization state
 */
export function ReactQueryAuthProvider({
  children,
  enableOfflineMode = true,
  queryClient: customQueryClient,
  enableNDK = true, // Default to true for backward compatibility
}: ReactQueryAuthProviderProps) {
  // Create Query Client if not provided (always created)
  const queryClient = useMemo(() => customQueryClient ?? createQueryClient(), [customQueryClient]);
  
  // NDK state - but we ALWAYS render regardless of state
  const [ndk, setNdk] = useState<NDK | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Track initialization attempts
  const initAttemptRef = useRef(0);
  
  // NDK context value (memoized to prevent unnecessary re-renders)
  const ndkContextValue = useMemo(() => ({ 
    ndk, 
    isInitialized 
  }), [ndk, isInitialized]);

  // Enhanced initialization with credential checking and web platform handling
  useEffect(() => {
    // Skip NDK initialization if enableNDK is false
    if (!enableNDK) {
      logger.info("NDK initialization skipped (enableNDK=false)");
      setIsInitialized(true); // Still mark as initialized so the app can proceed
      return;
    }
    
    // Track this initialization attempt
    const currentAttempt = ++initAttemptRef.current;
    
    const initNDK = async () => {
      try {
        logger.info(`Initializing NDK (attempt ${currentAttempt})...`);
        
        // Check if we're on web platform
        const isWeb = typeof window !== 'undefined' && window.document;
        logger.info(`Platform detected: ${isWeb ? 'web' : 'native'}`);
        
        // Pre-check for credentials if we're not on web
        let hasPrivateKey = false;
        let hasExternalSigner = false;
        
        try {
          if (!isWeb) {
            // Native platform credential check
            hasPrivateKey = !!(await SecureStore.getItemAsync(SECURE_STORE_KEYS.PRIVATE_KEY));
            hasExternalSigner = !!(await SecureStore.getItemAsync(SECURE_STORE_KEYS.EXTERNAL_SIGNER));
          } else {
            // Web platform credential check
            hasPrivateKey = !!localStorage.getItem(SECURE_STORE_KEYS.PRIVATE_KEY);
            hasExternalSigner = !!localStorage.getItem(SECURE_STORE_KEYS.EXTERNAL_SIGNER);
          }
          
          logger.debug("Auth credentials status:", { 
            hasPrivateKey, 
            hasExternalSigner,
            platform: isWeb ? 'web' : 'native'
          });
        } catch (credentialError) {
          logger.warn("Error checking credentials, will continue anyway:", credentialError);
        }
        
        // Set timeouts to ensure we don't hang indefinitely
        const initTimeoutMs = isWeb ? 5000 : 10000; // shorter timeout for web
        
        // Use a promise race to enforce timeout
        const initPromise = initializeNDK('react-query');
        const timeoutPromise = new Promise<{ndk: NDK | null; offlineMode: boolean}>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`NDK initialization timed out after ${initTimeoutMs}ms`));
          }, initTimeoutMs);
        });
        
        // Define the expected return type
        type NDKInitResult = {
          ndk: NDK | null;
          offlineMode: boolean;
          [key: string]: any; // Allow other properties
        };
        
        // Race initialization against timeout
        const result = await Promise.race([initPromise, timeoutPromise]).catch(error => {
          logger.warn("NDK initialization warning:", error);
          // Return a partial result to allow continuing
          return { ndk: null, offlineMode: true } as NDKInitResult;
        }) as NDKInitResult; // Assert the type
        
        // Update state only if this is still the most recent initialization attempt
        if (currentAttempt === initAttemptRef.current) {
          // Always set the NDK even if it's null - this allows the app to proceed
          setNdk(result.ndk);
          setIsInitialized(true);
          
          if (result.ndk) {
            logger.info("NDK initialized successfully");
            // Force refetch auth state to ensure it's up to date
            queryClient.invalidateQueries({ queryKey: ['auth', 'current'] });
          } else {
            logger.warn("NDK initialized in offline/fallback mode");
          }
        }
      } catch (err) {
        logger.error("Error initializing NDK:", err);
        // Still mark as initialized so the app can handle the error state
        if (currentAttempt === initAttemptRef.current) {
          setNdk(null);
          setIsInitialized(true); // Allow app to proceed even with errors
        }
      }
    };
    
    initNDK();
  }, [enableOfflineMode, enableNDK, queryClient]);

  // Always render children, regardless of NDK initialization status
  // This ensures consistent hook ordering in child components
  return (
    <QueryClientProvider client={queryClient}>
      <NDKContext.Provider value={ndkContextValue}>
        {children}
      </NDKContext.Provider>
    </QueryClientProvider>
  );
}

/**
 * Example usage in app/_layout.tsx:
 * 
 * ```tsx
 * import { ReactQueryAuthProvider } from '@/lib/auth/ReactQueryAuthProvider';
 * 
 * export default function RootLayout() {
 *   return (
 *     <ReactQueryAuthProvider>
 *       <Stack />
 *     </ReactQueryAuthProvider>
 *   );
 * }
 * ```
 */

/**
 * Hook to use the React Query authentication context
 * This provides easy access to authentication state and methods
 * throughout the application.
 */
export const useReactQueryAuth = () => {
  // Get NDK context
  const ndkContext = useContext(NDKContext);
  
  if (!ndkContext) {
    throw new Error('useReactQueryAuth must be used within a ReactQueryAuthProvider');
  }
  
  // Here you would typically wrap auth-related queries and mutations
  // For now, just return NDK context
  return {
    ...ndkContext,
    // Add any auth-specific methods here
    signIn: async () => {
      console.log('Sign in not implemented yet');
    },
    signOut: async () => {
      console.log('Sign out not implemented yet');
    },
    user: null, // Placeholder for user object
    isAuthenticated: false, // Placeholder authentication state
    isLoading: !ndkContext.isInitialized
  };
};
