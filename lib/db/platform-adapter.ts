// lib/db/platform-adapter.ts
import { Platform } from 'react-native';
import { openDatabaseSync, SQLiteDatabase } from 'expo-sqlite';
import { createLogger } from '@/lib/utils/logger';

// Track database initialization state
let databaseInitialized = false;
let webCompatibilityMode = false;

const logger = createLogger('PlatformAdapter');

/**
 * Opens a SQLite database with platform-specific handling
 * 
 * This adapter helps manage the differences between web and native platforms
 * when working with SQLite
 */
export function openDatabase(name: string): SQLiteDatabase {
  try {
    logger.debug(`Opening database '${name}' on platform: ${Platform.OS}`);
    
    // Use the openDatabaseSync method which works on both web and native
    // The implementation is different internally for each platform
    const db = openDatabaseSync(name);
    
    if (Platform.OS === 'web') {
      logger.debug('Using web SQLite implementation');
      // Mark that we're on web platform for special handling
      webCompatibilityMode = true;
    } else {
      logger.debug('Using native SQLite implementation');
    }
    
    // Mark database as initialized
    databaseInitialized = true;
    
    return db;
  } catch (error) {
    logger.error(`Failed to open database '${name}':`, error);
    
    if (Platform.OS === 'web') {
      logger.warn('Web SQLite error - attempting to recover');
      // For web, provide more helpful error info
      console.warn('[DB] Web SQLite error. Make sure you have the proper CORS headers set.', error);
      
      // Entering web compatibility mode even on error
      webCompatibilityMode = true;
      
      // Return a safe proxy that won't crash but may not work fully
      // This lets the app continue loading on web even with SQLite issues
      return createWebFallbackDatabase(name);
    }
    
    throw error;
  }
}

/**
 * Check if we're running in a web environment
 */
export function isWebPlatform(): boolean {
  return Platform.OS === 'web';
}

/**
 * Check if the database has been initialized properly
 */
export function isDatabaseInitialized(): boolean {
  return databaseInitialized;
}

/**
 * Check if we're running in web compatibility mode
 * (web platform with specific adaptations for limitations)
 */
export function isWebCompatibilityMode(): boolean {
  return webCompatibilityMode;
}

/**
 * Log database information for debugging purposes
 */
export function logDatabaseInfo(db: SQLiteDatabase): void {
  try {
    // Access database properties safely
    const dbInfo: Record<string, any> = {};
    
    // The 'name' property may not be available on all implementations
    if ('name' in db) {
      dbInfo.name = (db as any).name;
    }
    
    // The 'databasePath' property exists on native but not web
    if ('databasePath' in db) {
      dbInfo.path = db.databasePath;
    } else {
      dbInfo.path = 'in-memory (web)';
    }
    
    logger.debug('Database info:', dbInfo);
  } catch (error) {
    logger.warn('Unable to log database info:', error);
  }
}

/**
 * Creates a minimal database implementation that won't crash on web
 * This is for fallback purposes only when the real SQLite implementation fails
 */
function createWebFallbackDatabase(name: string): SQLiteDatabase {
  logger.warn('Using fallback web database - limited functionality available');
  
  // Create a minimal implementation with basic methods and add the required properties
  const fallbackDb = {
    name: `fallback-${name}`,
    version: 'fallback',
    execAsync: async (sql: string) => { 
      logger.warn(`Web fallback: execAsync called with: ${sql.substring(0, 50)}...`);
    },
    runAsync: async (sql: string, params: any[] = []) => {
      logger.warn(`Web fallback: runAsync called with: ${sql.substring(0, 50)}...`);
      return { changes: 0, lastInsertRowId: -1 };
    },
    getFirstAsync: async <T>(sql: string, params: any[] = []): Promise<T | null> => {
      logger.warn(`Web fallback: getFirstAsync called with: ${sql.substring(0, 50)}...`);
      return null;
    },
    getAllAsync: async <T>(sql: string, params: any[] = []): Promise<T[]> => {
      logger.warn(`Web fallback: getAllAsync called with: ${sql.substring(0, 50)}...`);
      return [];
    },
    withTransactionAsync: async (callback: () => Promise<void>) => { 
      try {
        logger.warn('Web fallback: withTransactionAsync called');
        // Just run the callback without any real transaction
        await callback();
      } catch (error) {
        logger.error('Transaction error in web fallback DB:', error);
      }
    },
    // Add additional required properties to match SQLiteDatabase type
    databasePath: ':memory:',
    options: {},
    isInTransactionAsync: async () => false,
    closeAsync: async () => {
      logger.warn('Web fallback: closeAsync called');
    },
    deleteAsync: async () => {
      logger.warn('Web fallback: deleteAsync called');
    }
  };
  
  // Cast to SQLiteDatabase type to satisfy TypeScript
  return fallbackDb as unknown as SQLiteDatabase;
}
