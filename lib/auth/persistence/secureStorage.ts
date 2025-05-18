/**
 * Secure storage utilities for authentication
 * Handles credential storage, retrieval, and migration between key formats
 * Provides cross-platform implementation for both native and web environments
 */

import * as ExpoSecureStore from 'expo-secure-store';
import { SECURE_STORE_KEYS } from '../constants';
import { Platform } from 'react-native';
import { isWeb, WebStorage } from '@/lib/platform/webFallbacks';

// Unique key to track migration status
const MIGRATION_VERSION_KEY = 'auth_migration_v1_completed';

// Legacy storage keys that might contain credentials
const LEGACY_KEYS = {
  PRIVATE_KEY: 'powr.private_key',
  NOSTR_PRIVKEY: 'nostr_privkey', // Original key from ndk.ts
};

// Platform-specific secure storage implementation
export const SecureStore = {
  // Get a value from secure storage
  getItemAsync: async (key: string): Promise<string | null> => {
    if (isWeb) {
      try {
        return WebStorage.getItem(key);
      } catch (error) {
        console.warn(`[SecureStore] Web localStorage not available: ${error}`);
        return null;
      }
    } else {
      return ExpoSecureStore.getItemAsync(key);
    }
  },
  
  // Set a value in secure storage
  setItemAsync: async (key: string, value: string): Promise<void> => {
    if (isWeb) {
      try {
        WebStorage.setItem(key, value);
      } catch (error) {
        console.warn(`[SecureStore] Failed to write to web localStorage: ${error}`);
      }
    } else {
      await ExpoSecureStore.setItemAsync(key, value);
    }
  },
  
  // Delete a value from secure storage
  deleteItemAsync: async (key: string): Promise<void> => {
    if (isWeb) {
      try {
        WebStorage.removeItem(key);
      } catch (error) {
        console.warn(`[SecureStore] Failed to delete from web localStorage: ${error}`);
      }
    } else {
      await ExpoSecureStore.deleteItemAsync(key);
    }
  }
};

/**
 * Migrates credentials from legacy storage keys to the standardized keys
 * This is a one-time operation that runs at app startup
 * 
 * @returns Promise that resolves when migration is complete
 */
export async function migrateKeysIfNeeded(): Promise<void> {
  console.log(`[Auth] Starting key migration check (${Platform.OS})`);

  try {
    // Check if migration already happened
    const migrationDone = await SecureStore.getItemAsync(MIGRATION_VERSION_KEY);
    if (migrationDone === 'true') {
      console.log('[Auth] Migration already completed, skipping');
      return;
    }
  } catch (error) {
    console.warn('[Auth] Error checking migration status:', error);
    // Continue with migration attempt even if check fails
  }

  console.log('[Auth] Performing one-time key migration');
  
  try {
    // Get the current value from the standardized location (if any)
    const currentKey = await SecureStore.getItemAsync(SECURE_STORE_KEYS.PRIVATE_KEY);
    if (currentKey) {
      console.log('[Auth] Already have credentials in standard location');
    }

    // Check for credentials in legacy locations
    const legacyKey = await SecureStore.getItemAsync(LEGACY_KEYS.PRIVATE_KEY);
    const ndkStoreKey = await SecureStore.getItemAsync(LEGACY_KEYS.NOSTR_PRIVKEY);
    
    console.log('[Auth] Storage key status:', {
      hasCurrentKey: !!currentKey,
      hasLegacyKey: !!legacyKey,
      hasNdkStoreKey: !!ndkStoreKey
    });

    // Migration strategy: prioritize existing credentials if any
    if (!currentKey) {
      if (legacyKey) {
        console.log('[Auth] Found credentials in legacy location (powr.private_key), migrating');
        await SecureStore.setItemAsync(SECURE_STORE_KEYS.PRIVATE_KEY, legacyKey);
        console.log('[Auth] Legacy key (powr.private_key) migrated successfully');
      } else if (ndkStoreKey) {
        console.log('[Auth] Found credentials in ndk store location (nostr_privkey), migrating');
        await SecureStore.setItemAsync(SECURE_STORE_KEYS.PRIVATE_KEY, ndkStoreKey);
        console.log('[Auth] NDK store key (nostr_privkey) migrated successfully');
      }
    }

    // Mark migration as complete regardless of outcome
    // This prevents repeated migration attempts
    await SecureStore.setItemAsync(MIGRATION_VERSION_KEY, 'true');
    console.log('[Auth] Key migration process completed');
  } catch (error) {
    console.error('[Auth] Error during migration process:', error);
    // Even if migration fails, we still want to continue app startup
  }
}

/**
 * Clear all authentication credentials from secure storage
 * Handles both current and legacy keys
 */
export async function clearAllCredentials(): Promise<void> {
  console.log('[Auth] Clearing all stored credentials');
  
  try {
    // Define all keys that might contain credentials
    const allKeys = [
      SECURE_STORE_KEYS.PRIVATE_KEY,
      SECURE_STORE_KEYS.EXTERNAL_SIGNER,
      SECURE_STORE_KEYS.PUBKEY,
      LEGACY_KEYS.PRIVATE_KEY,
      LEGACY_KEYS.NOSTR_PRIVKEY,
    ];
    
    // Delete all possible keys
    const deletePromises = allKeys.map(async key => {
      try {
        console.log(`[Auth] Deleting key: ${key}`);
        await SecureStore.deleteItemAsync(key);
      } catch (error) {
        console.warn(`[Auth] Error deleting key ${key}:`, error);
      }
    });
    
    await Promise.all(deletePromises);
    console.log('[Auth] All credentials cleared');
  } catch (error) {
    console.error('[Auth] Error clearing credentials:', error);
  }
}

/**
 * Gets a credential from secure storage with fallback to legacy locations
 * Useful during transition period when old keys might still be in use
 * 
 * @param key The main storage key to check
 * @param legacyKeys Array of legacy keys to check as fallbacks
 * @returns The credential value if found, null otherwise
 */
export async function getCredentialWithFallback(
  key: string,
  legacyKeys: string[] = []
): Promise<string | null> {
  try {
    // First try main key
    let value = await SecureStore.getItemAsync(key);
    
    // If not found, try legacy keys
    if (!value) {
      for (const legacyKey of legacyKeys) {
        console.log(`[Auth] Main key not found, trying legacy key: ${legacyKey}`);
        try {
          value = await SecureStore.getItemAsync(legacyKey);
          if (value) {
            console.log(`[Auth] Found credential in legacy location: ${legacyKey}`);
            break;
          }
        } catch (innerError) {
          console.warn(`[Auth] Error checking legacy key ${legacyKey}:`, innerError);
        }
      }
    }
    
    return value;
  } catch (error) {
    console.error('[Auth] Error in getCredentialWithFallback:', error);
    return null;
  }
}

/**
 * Resets the migration flag for testing purposes
 * Only available in development builds
 */
export async function resetMigration(): Promise<void> {
  if (__DEV__) {
    try {
      console.log('[Auth] Resetting migration flag for testing');
      await SecureStore.deleteItemAsync(MIGRATION_VERSION_KEY);
    } catch (error) {
      console.warn('[Auth] Error resetting migration flag:', error);
    }
  }
}
