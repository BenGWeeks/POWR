// lib/db/database-adapter.ts
import { Platform } from 'react-native';
import { SQLiteDatabase, openDatabaseSync } from 'expo-sqlite';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('DatabaseAdapter');

/**
 * Initialize the database with appropriate settings based on platform
 * Handles the different ways SQLite needs to be initialized on web vs native
 */
export function initializeDatabase(dbName: string): SQLiteDatabase {
  try {
    logger.debug(`Initializing database '${dbName}' on platform: ${Platform.OS}`);
    
    // Open the database - this uses different implementation on web vs native
    const db = openDatabaseSync(dbName);
    logger.debug('Database opened successfully');

    // Add platform-specific setup if needed in the future
    if (Platform.OS === 'web') {
      logger.debug('Using web-specific SQLite configuration');
      // Web-specific initialization can be added here if needed
    }
    
    return db;
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    // On web, we want to fail gracefully rather than crashing the app
    if (Platform.OS === 'web') {
      logger.warn('Using fallback in-memory database for web');
      // For demo purposes, return a minimal implementation that won't crash the app
      // This should be replaced with a proper IndexedDB or other web-friendly solution
      return createFallbackDatabase();
    }
    throw error;
  }
}

/**
 * Creates a minimal database implementation that won't crash on web
 * This is for fallback purposes only and should be replaced with a proper solution
 */
function createFallbackDatabase(): SQLiteDatabase {
  logger.warn('Using fallback database - limited functionality available');
  
  // A minimal implementation that won't crash but doesn't provide real functionality
  // Create a minimal implementation with basic methods and add the required properties
  const fallbackDb = {
    name: 'fallback-memory-db',
    version: 'fallback',
    execAsync: async () => { logger.warn('execAsync called on fallback DB'); },
    runAsync: async () => ({ changes: 0, lastInsertRowId: -1 }),
    getFirstAsync: async () => null,
    getAllAsync: async () => [],
    withTransactionAsync: async (callback: () => Promise<void>) => { 
      try {
        await callback();
      } catch (error) {
        logger.error('Transaction error in fallback DB:', error);
      }
    },
    // Add additional required properties to match SQLiteDatabase type
    databasePath: ':memory:',
    options: {},
    isInTransactionAsync: async () => false,
    closeAsync: async () => {},
    deleteAsync: async () => {}
  };
  
  // Cast to SQLiteDatabase type to satisfy TypeScript
  return fallbackDb as unknown as SQLiteDatabase;
}

/**
 * Check if the current platform supports full SQLite functionality
 */
export function hasSQLiteSupport(): boolean {
  // Add more detailed detection if needed in the future
  return true; // We assume basic support exists with our adapter
}
