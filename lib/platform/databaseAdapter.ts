// lib/platform/databaseAdapter.ts
import { openDatabaseSync, SQLiteDatabase } from 'expo-sqlite';
import { createLogger } from '@/lib/utils/logger';
import { getPlatform, PlatformConstants, safelyRun } from './index';
import { Platform } from 'react-native';

const logger = createLogger('DatabaseAdapter');

/**
 * Result type for database operations
 */
export type SQLiteResult = {
  changes: number;
  lastInsertRowId: number;
};

/**
 * Platform-specific database adapter
 * Provides a consistent API for database operations across platforms
 */
export class DatabaseAdapter {
  private db: SQLiteDatabase | null = null;
  private dbName: string;
  private isReady: boolean = false;
  private webFallback: boolean = false;
  private webStorage: Map<string, any> = new Map();
  
  constructor(databaseName: string) {
    this.dbName = databaseName;
    // Use setTimeout to avoid blocking the main thread with synchronous DB operations
    setTimeout(() => this.initialize(), 0);
  }
  
  /**
   * Initializes the database connection
   * @private
   */
  private initialize(): void {
    try {
      if (PlatformConstants.isWeb) {
        // For web platform, always use the web fallback
        logger.info('[DB] Web platform detected, using in-memory storage');
        this.webFallback = true;
        this.initializeWebStorage();
        this.isReady = true;
        return;
      }
      
      // On native platforms, we rely on SQLite working properly
      try {
        this.db = openDatabaseSync(this.dbName);
        this.isReady = true;
        logger.debug(`Database '${this.dbName}' opened successfully on platform: ${getPlatform()}`);
      } catch (nativeDbError) {
        // Even on native, be more resilient to initialization failures
        logger.error(`Failed to open database '${this.dbName}' on native platform:`, nativeDbError);
        // Set up fallback even on native if SQLite fails
        logger.warn('Using web fallback mode as native fallback');
        this.webFallback = true;
        this.initializeWebStorage();
        this.isReady = true;
      }
    } catch (error) {
      // This is a general catch for any unexpected errors
      logger.error(`Failed to open database '${this.dbName}':`, error);
      
      if (PlatformConstants.isWeb) {
        logger.warn('Continuing with limited functionality on web platform');
        this.webFallback = true;
        this.isReady = true; // We're ready with the fallback
      } else {
        // On native platforms, we still try to be resilient
        this.isReady = false;
        // Don't throw, just log the error
        logger.error('Database initialization failed, some features may not work');
      }
    }
  }
  
  /**
   * Initialize in-memory storage for web fallbacks
   * This creates in-memory tables that mimic the SQLite database structure
   */
  private initializeWebStorage(): void {
    try {
      // Check if we already have stored tables in localStorage
      if (Platform.OS === 'web') {
        try {
          const storedTables = localStorage.getItem('powr_db_tables');
          if (storedTables) {
            // Parse and use existing tables
            const parsedTables = JSON.parse(storedTables);
            this.webStorage.set('tables', parsedTables);
            logger.debug('Loaded existing web storage tables from localStorage');
            return;
          }
        } catch (storageError) {
          logger.warn('Unable to access localStorage, using in-memory only', storageError);
        }
      }
      
      // Set up basic table structures (either if localStorage failed or on native with fallback)
      const tables: Record<string, any[]> = {
        'favorites': [],
        'workouts': [],
        'workout_summaries': [],
        'templates': []
      };
      
      this.webStorage.set('tables', tables);
      
      // Try to persist to localStorage for web platform
      if (Platform.OS === 'web') {
        try {
          localStorage.setItem('powr_db_tables', JSON.stringify(tables));
        } catch (saveError) {
          logger.warn('Failed to persist tables to localStorage', saveError);
        }
      }
      
      logger.debug('Web storage initialized for fallback operation');
    } catch (error) {
      logger.error('Failed to initialize web storage', error);
      // Create an empty tables object as a last resort
      this.webStorage.set('tables', {
        'favorites': [],
        'workouts': [],
        'workout_summaries': [],
        'templates': []
      });
    }
  }
  
  /**
   * Check if the database is ready for use
   */
  isInitialized(): boolean {
    return this.isReady;
  }
  
  /**
   * Execute SQL statement that doesn't return a result
   */
  async execAsync(sql: string): Promise<void> {
    if (!this.isReady) {
      throw new Error('Database not initialized');
    }
    
    if (this.webFallback) {
      logger.debug(`[Web Fallback] execAsync: ${sql.substring(0, 80)}${sql.length > 80 ? '...' : ''}`);
      return Promise.resolve();
    }
    
    if (this.db) {
      return this.db.execAsync(sql);
    }
  }
  
  /**
   * Execute SQL statement that modifies data
   */
  async runAsync(sql: string, params: any[] = []): Promise<SQLiteResult> {
    if (!this.isReady) {
      throw new Error('Database not initialized');
    }
    
    if (this.webFallback) {
      logger.debug(`[Web Fallback] runAsync: ${sql.substring(0, 80)}${sql.length > 80 ? '...' : ''}`);
      
      // Handle INSERT, UPDATE, DELETE operations on common tables
      const sqlLower = sql.toLowerCase();
      let tableName = '';
      let operation = '';
      let result = { changes: 0, lastInsertRowId: -1 };
      
      // Determine operation type and table
      if (sqlLower.includes('insert into')) {
        operation = 'insert';
        const match = sql.match(/INSERT\s+INTO\s+([\w_]+)/i);
        if (match) tableName = match[1];
      } else if (sqlLower.includes('update')) {
        operation = 'update';
        const match = sql.match(/UPDATE\s+([\w_]+)/i);
        if (match) tableName = match[1];
      } else if (sqlLower.includes('delete from')) {
        operation = 'delete';
        const match = sql.match(/DELETE\s+FROM\s+([\w_]+)/i);
        if (match) tableName = match[1];
      }
      
      // Initialize tables storage if needed
      const tables = this.webStorage.get('tables') || {};
      if (!tables[tableName]) {
        tables[tableName] = [];
      }
      
      if (operation === 'insert' && tableName === 'favorites') {
        // Handle favorites insertion
        const row = {
          id: params[0],
          content_type: params[1],
          content_id: params[2],
          content: params[3],
          pubkey: params[4],
          created_at: params[5]
        };
        
        // Remove any existing item with same content_id
        const existingIndex = tables[tableName].findIndex(
          (item: any) => item.content_type === row.content_type && 
                           item.content_id === row.content_id
        );
        
        if (existingIndex >= 0) {
          tables[tableName].splice(existingIndex, 1);
        }
        
        // Add the new item
        tables[tableName].push(row);
        result.lastInsertRowId = tables[tableName].length;
        result.changes = 1;
      } else if (operation === 'delete' && tableName === 'favorites') {
        // Handle favorites deletion
        const contentType = params[0];
        const contentId = params[1];
        
        const initialLength = tables[tableName].length;
        tables[tableName] = tables[tableName].filter(
          (item: any) => !(item.content_type === contentType && item.content_id === contentId)
        );
        
        result.changes = initialLength - tables[tableName].length;
      }
      
      // Store updated tables
      this.webStorage.set('tables', tables);
      
      return result;
    }
    
    if (this.db) {
      return this.db.runAsync(sql, params);
    }
    
    return { changes: 0, lastInsertRowId: -1 };
  }
  
  /**
   * Execute SQL query that returns the first result row
   */
  async getFirstAsync<T>(sql: string, params: any[] = []): Promise<T | null> {
    if (!this.isReady) {
      if (PlatformConstants.isWeb) {
        // On web, be more forgiving and just return null
        logger.warn('Database not ready, but continuing with null result on web');
        return null;
      }
      throw new Error('Database not initialized');
    }
    
    if (this.webFallback) {
      logger.debug(`[Web Fallback] getFirstAsync: ${sql.substring(0, 80)}${sql.length > 80 ? '...' : ''}`);
      
      // Handle common queries with in-memory fallbacks
      if (sql.toLowerCase().includes('from favorites')) {
        // Return simulated favorites data from storage
        const tableName = 'favorites';
        const tables = this.webStorage.get('tables') || {};
        const tableData = tables[tableName] || [];
        
        if (sql.toLowerCase().includes('where content_type')) {
          // Specific content type requested
          const contentTypeParam = params[0];
          const filtered = tableData.filter((item: { content_type: string }) => item.content_type === contentTypeParam);
          if (filtered.length > 0) {
            return filtered[0] as unknown as T;
          }
        } else if (sql.toLowerCase().includes('count(*)')) {
          // Return count
          return { count: tableData.length } as unknown as T;
        }
      }
      
      // If no special handling, return null
      return null;
    }
    
    if (this.db) {
      return this.db.getFirstAsync<T>(sql, params);
    }
    
    return null;
  }
  
  /**
   * Execute SQL query that returns all result rows
   */
  async getAllAsync<T>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.isReady) {
      if (PlatformConstants.isWeb) {
        // On web, be more forgiving and just return empty array
        logger.warn('Database not ready, but continuing with empty result on web');
        return [] as T[];
      }
      throw new Error('Database not initialized');
    }
    
    if (this.webFallback) {
      logger.debug(`[Web Fallback] getAllAsync: ${sql.substring(0, 80)}${sql.length > 80 ? '...' : ''}`);
      
      // Handle common queries with in-memory fallbacks
      if (sql.toLowerCase().includes('from favorites')) {
        // Return simulated favorites data
        const tableName = 'favorites';
        const tables = this.webStorage.get('tables') || {};
        const tableData = tables[tableName] || [];
        
        if (params.length > 0 && sql.toLowerCase().includes('where content_type')) {
          // Filter by content type
          const contentTypeParam = params[0];
          return tableData.filter((item: { content_type: string }) => 
            item.content_type === contentTypeParam
          ) as unknown as T[];
        }
        
        // Return all data for this table
        return tableData as unknown as T[];
      }
      
      // For other tables
      if (sql.toLowerCase().includes('from sqlite_master')) {
        // Simulate schema information
        const tables = this.webStorage.get('tables') || {};
        const tableNames = Object.keys(tables);
        
        if (sql.toLowerCase().includes('where name')) {
          // Specific table requested
          const tableName = params[0];
          if (tableNames.includes(tableName)) {
            return [{ type: 'table', name: tableName, count: 1 }] as unknown as T[];
          }
          return [] as T[];
        }
        
        // Return all tables
        return tableNames.map(name => ({ 
          type: 'table', 
          name, 
          count: 1 
        })) as unknown as T[];
      }
      
      return [];
    }
    
    if (this.db) {
      return this.db.getAllAsync<T>(sql, params);
    }
    
    return [];
  }
  
  /**
   * Execute SQL within a transaction
   */
  async withTransactionAsync(callback: () => Promise<void>): Promise<void> {
    if (!this.isReady) {
      throw new Error('Database not initialized');
    }
    
    if (this.webFallback) {
      logger.debug('[Web Fallback] withTransactionAsync - simulating transaction');
      try {
        await callback();
      } catch (error) {
        logger.error('Transaction error in web fallback:', error);
      }
      return;
    }
    
    if (this.db) {
      return this.db.withTransactionAsync(callback);
    }
  }
  
  /**
   * Check if currently in a transaction
   */
  async isInTransactionAsync(): Promise<boolean> {
    if (!this.isReady) {
      throw new Error('Database not initialized');
    }
    
    if (this.webFallback) {
      return false;
    }
    
    if (this.db) {
      return this.db.isInTransactionAsync();
    }
    
    return false;
  }
  
  /**
   * Close the database connection
   */
  async closeAsync(): Promise<void> {
    if (this.webFallback) {
      logger.debug('[Web Fallback] closeAsync - no-op');
      return;
    }
    
    if (this.db) {
      return this.db.closeAsync();
    }
  }
  
  /**
   * Delete the database file
   */
  // No deleteAsync in SQLiteDatabase interface, but we provide it for our adapter
  async deleteDatabase(): Promise<void> {
    if (this.webFallback) {
      logger.debug('[Web Fallback] deleteDatabase - no-op');
      return;
    }
    
    // Close the database first
    if (this.db) {
      await this.db.closeAsync();
      logger.debug(`Database closed for deletion`);
      
      // In a real implementation, you would delete the file
      // but expo-sqlite doesn't expose this directly
      logger.debug(`Database '${this.dbName}' would be deleted here`);
    }
  }
  
  /**
   * Get the native SQLiteDatabase instance
   * Warning: Only use this if you need direct access to the native instance
   */
  getNativeDatabase(): SQLiteDatabase | null {
    return this.db;
  }
  
  /**
   * Get database metadata
   */
  getDatabaseInfo(): {
    name: string;
    isWeb: boolean;
    usingFallback: boolean;
  } {
    return {
      name: this.dbName,
      isWeb: PlatformConstants.isWeb,
      usingFallback: this.webFallback
    };
  }
}

/**
 * Create a database adapter for the specified database
 */
export function createDatabaseAdapter(dbName: string): DatabaseAdapter {
  return new DatabaseAdapter(dbName);
}
