// lib/hooks/usePlatformDB.ts
import { Platform } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('PlatformDB');

type DatabaseFunctions = {
  execAsync: (sql: string, params?: any[]) => Promise<void>;
  runAsync: (sql: string, params?: any[]) => Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync: <T>(sql: string, params?: any[]) => Promise<T | null>;
  getAllAsync: <T>(sql: string, params?: any[]) => Promise<T[]>;
  isWebPlatform: boolean;
};

/**
 * Hook to provide platform-aware database access
 * Returns SQLite database instance on native platforms
 * On web, provides a mock implementation that handles errors gracefully
 */
export function usePlatformDB(): DatabaseFunctions {
  // Flag to indicate web platform
  const isWebPlatform = Platform.OS === 'web';
  
  // Try to get the real database context
  let db: any = null;
  let dbError = false;
  
  try {
    // This will throw an error on web if SQLite is not initialized properly
    db = useSQLiteContext();
  } catch (error) {
    logger.warn('SQLite context unavailable, using fallback', error);
    dbError = true;
  }
  
  // If we're on web or there was an error getting the context,
  // return a mock/fallback implementation
  if (isWebPlatform || dbError || !db) {
    return {
      execAsync: async (sql: string) => {
        logger.debug(`[Web Mock] execAsync: ${sql.substring(0, 50)}...`);
        return Promise.resolve();
      },
      runAsync: async (sql: string) => {
        logger.debug(`[Web Mock] runAsync: ${sql.substring(0, 50)}...`);
        return { changes: 0, lastInsertRowId: -1 };
      },
      getFirstAsync: async <T>(sql: string): Promise<T | null> => {
        logger.debug(`[Web Mock] getFirstAsync: ${sql.substring(0, 50)}...`);
        return null;
      },
      getAllAsync: async <T>(sql: string): Promise<T[]> => {
        logger.debug(`[Web Mock] getAllAsync: ${sql.substring(0, 50)}...`);
        return [];
      },
      isWebPlatform: true
    };
  }
  
  // On native platforms, return the real database with our platform flag
  return {
    ...db,
    isWebPlatform: false
  };
}

/**
 * Helper function to check if we're on web platform
 */
export function isWebPlatform(): boolean {
  return Platform.OS === 'web';
}

/**
 * Helper function to safely execute database operations with fallbacks
 */
export async function safeDBOperation<T>(
  operation: () => Promise<T>,
  fallbackValue: T,
  operationName: string = 'DB Operation'
): Promise<T> {
  if (Platform.OS === 'web') {
    try {
      return await operation();
    } catch (error) {
      logger.warn(`${operationName} failed on web:`, error);
      return fallbackValue;
    }
  } else {
    return operation();
  }
}
