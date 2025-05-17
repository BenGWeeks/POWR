// lib/platform/webFallbacks.ts
/**
 * Web Fallbacks Module
 * 
 * This module provides fallback implementations for features that
 * might not work properly on web platforms. It helps ensure that
 * the app can continue to run with graceful degradation instead
 * of crashing when certain native features are unavailable.
 */

import { Platform } from 'react-native';

// Check if we're running on the web platform
export const isWeb = Platform.OS === 'web';

/**
 * Safely execute a function that might fail on web platform
 * @param fn Function to execute
 * @param fallbackValue Value to return if function fails
 * @returns Result of function or fallback value
 */
export function safelyRun<T>(fn: () => T, fallbackValue: T): T {
  try {
    return fn();
  } catch (error) {
    console.warn('Operation failed, using fallback', error);
    return fallbackValue;
  }
  
  // On native platforms, we don't use fallbacks by default
  return fn();
}

/**
 * Create a safe wrapper for any async function that might fail on web
 * Returns the result of the function, or a fallback value if it fails
 * 
 * @param fn Async function to safely execute
 * @param fallbackValue Value to return if the function fails
 * @param logErrors Whether to log errors to console
 */
export async function safelyExecuteAsync<T>(
  fn: () => Promise<T>, 
  fallbackValue: T, 
  logErrors: boolean = true
): Promise<T> {
  if (isWeb) {
    try {
      return await fn();
    } catch (err) {
      if (logErrors) {
        console.warn('[Web Fallback] Error executing async function:', err);
      }
      return fallbackValue;
    }
  }
  
  // On native platforms, we don't use fallbacks by default
  return fn();
}

/**
 * Logs an error once on web, and returns the fallback.
 * This is useful when you have an operation that will always fail on web,
 * but you don't want to spam the console with errors.
 */
const loggedErrors = new Set<string>();
export function logErrorOnceAndFallback<T>(
  errorKey: string,
  message: string,
  fallbackValue: T
): T {
  if (isWeb && !loggedErrors.has(errorKey)) {
    console.warn(`[Web Fallback] ${message}`);
    loggedErrors.add(errorKey);
  }
  return fallbackValue;
}

/**
 * Web storage adapter - uses localStorage for persistence
 */
/**
 * Safe check if localStorage is available
 * This handles all edge cases during SSR and initial rendering
 */
const isLocalStorageAvailable = (): boolean => {
  if (!isWeb) return false;
  
  // Check if we're in a non-browser environment (SSR)
  if (typeof window === 'undefined') return false;
  
  try {
    // Test if localStorage is accessible
    const testKey = '__storage_test__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
};

/**
 * Fallback storage mechanism when localStorage isn't available
 * This ensures we still have some persistence during the session
 */
const memoryStore = new Map<string, string>();

export class WebStorage {
  static getItem(key: string): string | null {
    if (!isWeb) return null;
    
    try {
      // First check if localStorage is available
      if (isLocalStorageAvailable()) {
        return localStorage.getItem(key);
      }
      
      // Fall back to memory store
      return memoryStore.get(key) || null;
    } catch (err) {
      console.warn('[Web Storage] Failed to get item:', err);
      return null;
    }
  }
  
  static setItem(key: string, value: string): void {
    if (!isWeb) return;
    
    try {
      // Try localStorage first
      if (isLocalStorageAvailable()) {
        localStorage.setItem(key, value);
        return;
      }
      
      // Fall back to memory store
      memoryStore.set(key, value);
    } catch (err) {
      console.warn('[Web Storage] Failed to set item:', err);
      // Still try to save to memory store as fallback
      memoryStore.set(key, value);
    }
  }
  
  static removeItem(key: string): void {
    if (!isWeb) return;
    
    try {
      // Try to remove from both storage mechanisms
      if (isLocalStorageAvailable()) {
        localStorage.removeItem(key);
      }
      
      // Always clean up memory store too
      memoryStore.delete(key);
    } catch (err) {
      console.warn('[Web Storage] Failed to remove item:', err);
      // Still try to remove from memory store
      memoryStore.delete(key);
    }
  }
}

/**
 * In-memory storage for web platforms
 * Provides a simple key-value store that can be used when localStorage is unavailable
 */
export class InMemoryStorage {
  private static store = new Map<string, any>();
  
  /**
   * Get a value from storage
   * @param key Storage key
   * @returns Stored value or undefined if not found
   */
  static get<T>(key: string): T | undefined {
    return InMemoryStorage.store.get(key) as T | undefined;
  }
  
  /**
   * Set a value in storage
   * @param key Storage key
   * @param value Value to store
   */
  static set<T>(key: string, value: T): void {
    InMemoryStorage.store.set(key, value);
  }
  
  /**
   * Remove a value from storage
   * @param key Storage key
   */
  static remove(key: string): void {
    InMemoryStorage.store.delete(key);
  }
  
  /**
   * Check if storage contains a key
   * @param key Storage key
   * @returns True if key exists
   */
  static has(key: string): boolean {
    return InMemoryStorage.store.has(key);
  }
  
  /**
   * Clear all storage
   */
  static clear(): void {
    InMemoryStorage.store.clear();
  }
}

/**
 * Creates an empty mock object with safe placeholder methods
 * Use this to mock native modules that aren't available on web
 */
export function createEmptyMock<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (target, prop) => {
      if (prop in target) {
        return target[prop as keyof T];
      }
      
      // Return a function that logs once and does nothing
      return (..._args: any[]) => {
        logErrorOnceAndFallback(
          `${name}.${String(prop)}`,
          `${name}.${String(prop)} is not available on web platform`,
          undefined
        );
      };
    }
  });
}
