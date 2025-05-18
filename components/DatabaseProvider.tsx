// components/DatabaseProvider.tsx
import React from 'react';
import { View, ActivityIndicator, ScrollView, Text } from 'react-native';
import { Platform } from 'react-native';
// Import SQLite type and our new cross-platform database adapter
import { type SQLiteDatabase, openDatabaseSync } from 'expo-sqlite';
import { createDatabaseAdapter } from '@/lib/platform/databaseAdapter';
import { PlatformConstants, safelyRun } from '@/lib/platform';
import { schema } from '@/lib/db/schema';
import { ExerciseService } from '@/lib/db/services/ExerciseService';
import { PublicationQueueService } from '@/lib/db/services/PublicationQueueService';
import { FavoritesService } from '@/lib/db/services/FavoritesService';
import { WorkoutService } from '@/lib/db/services/WorkoutService';
import { TemplateService } from '@/lib/db/services/TemplateService';
import POWRPackService from '@/lib/db/services/POWRPackService';
import { logDatabaseInfo } from '@/lib/db/debug';
import { useNDKStore } from '@/lib/stores/ndk';
import { useLibraryStore } from '@/lib/stores/libraryStore';
import { createLogger, setQuietMode } from '@/lib/utils/logger';
import { setDatabaseConnection } from '@/types/nostr-workout';

// Create database-specific logger
const logger = createLogger('DatabaseProvider');

// Create context for services
interface DatabaseServicesContextValue {
  exerciseService: ExerciseService | null;
  workoutService: WorkoutService | null;
  templateService: TemplateService | null;
  publicationQueue: PublicationQueueService | null;
  favoritesService: FavoritesService | null;
  powrPackService: POWRPackService | null;
  db: SQLiteDatabase | null;
}

const DatabaseServicesContext = React.createContext<DatabaseServicesContextValue>({
  exerciseService: null,
  workoutService: null,
  templateService: null,
  publicationQueue: null,
  favoritesService: null,
  powrPackService: null,
  db: null,
});

interface DatabaseProviderProps {
  children: React.ReactNode;
}

// Add a DelayedInitializer component to ensure database is fully ready
const DelayedInitializer: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [ready, setReady] = React.useState(false);
  
  React.useEffect(() => {
    // Small delay to ensure database is fully ready
    const timer = setTimeout(() => {
      logger.info('Delayed initialization complete');
      setReady(true);
    }, 300); // 300ms delay should be sufficient
    
    return () => clearTimeout(timer);
  }, []);
  
  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="small" className="mb-2" />
        <Text className="text-foreground text-sm">Finishing initialization...</Text>
      </View>
    );
  }
  
  return <>{children}</>;
};

export function DatabaseProvider({ children }: DatabaseProviderProps) {
  const [isReady, setIsReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [services, setServices] = React.useState<DatabaseServicesContextValue>({
    exerciseService: null,
    workoutService: null,
    templateService: null,
    publicationQueue: null,
    favoritesService: null,
    powrPackService: null,
    db: null,
  });
  
  // Enable quiet mode to reduce console noise
  React.useEffect(() => {
    // Set quiet mode (only show errors) to reduce console output
    setQuietMode(true);
    logger.info('Quiet mode enabled to reduce console output');
    
    return () => {
      // Restore normal logging when component unmounts
      setQuietMode(false);
    };
  }, []);
  
  // Get NDK from store to provide to services
  const ndk = useNDKStore(state => state.ndk);
  
  // Effect to set NDK on services when it becomes available
  React.useEffect(() => {
    if (ndk && services.publicationQueue) {
      services.publicationQueue.setNDK(ndk);
    }
  }, [ndk, services]);

  // Effect to trigger initial data refresh when database is ready
  React.useEffect(() => {
    if (isReady && services.db) {
      console.log('[DB] Database ready - triggering initial library refresh');
    }
  }, [isReady, services.db]);

  // Effect to initialize database
  React.useEffect(() => {
    async function initDatabase() {
      try {
        console.log('[DB] Starting database initialization...');
        
        try {
          // Add a small delay to ensure system is ready (especially on Android)
          await new Promise(resolve => setTimeout(resolve, 200));
          
          console.log('[DB] Opening database using new cross-platform adapter...');
          
          // First determine if we're on web platform
          const isWeb = Platform.OS === 'web' || PlatformConstants.isWeb;
          console.log(`[DB] Platform detection: ${Platform.OS}, isWeb=${isWeb}`);
          
          if (isWeb) {
            console.log('[DB] Web platform detected - using web fallback mode');
          }
          
          // Create adapter with timeout handling to prevent hanging
          const dbAdapterPromise = createDatabaseAdapter('powr.db');
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database initialization timeout after 5 seconds')), 5000);
          });
          
          // Race the database initialization with a timeout
          console.log('[DB] Waiting for database adapter to initialize...');
          const dbAdapter = await Promise.race([
            dbAdapterPromise,
            timeoutPromise
          ]) as any;
          
          console.log('[DB] Adapter initialized, getting native database...');
          
          // Get the native SQLite database object which is compatible with our schema functions
          const db = await dbAdapter.getNativeDatabase();
          
          if (!db) {
            if (isWeb) {
              // On web platforms, this is expected behavior - log as info, not error
              console.log('[DB] Web platform: Database adapter returned null (expected behavior)');
              console.log('[DB] Using in-memory fallbacks for database operations');
              // Continue with in-memory fallbacks on web platforms
              // Services will be created with null db but use their internal web fallbacks
            } else {
              // On native platforms, this is an actual error
              console.error('[DB] Native platform: Database adapter returned null - this is unexpected');
              throw new Error('Failed to create database adapter - adapter returned null database');
            }
          }
          
          console.log('[DB] Successfully obtained database instance');
          
          console.log(`[DB] Running on platform: ${Platform.OS}`);
          
          // The adapter will handle web fallbacks automatically
          console.log('[DB] Creating schema...');
          
          // Run migrations with robust error handling
          const runMigration = async (version: string, migrationFn: (db: SQLiteDatabase) => Promise<void>) => {
            try {
              await migrationFn(db);
              console.log(`[DB] Migration ${version} executed successfully`);
            } catch (migrationError) {
              console.warn(`[DB] Error running migration ${version}:`, migrationError);
              // Log more details about the error
              if (migrationError instanceof Error) {
                console.warn(`[DB] Migration error details: ${migrationError.message}`);
                if (migrationError.stack) {
                  console.warn(`[DB] Stack trace: ${migrationError.stack}`);
                }
              }
              // Continue even if migration fails - tables might already be updated
            }
          };
          
          // Safely run schema creation with error handling
          await safelyRun(
            async () => {
              if (db) {
                // Create schema tables
                await schema.createTables(db);
                await schema.ensureCriticalTablesExist(db);
                
                // Run migrations
                await runMigration('v8', (schema as any).migrate_v8);
                await runMigration('v9', (schema as any).migrate_v9);
                await runMigration('v10', (schema as any).migrate_v10);
              }
            },
            undefined,
            'Schema setup'
          );
          
          // Initialize services
          console.log('[DB] Initializing database services...');
          
          // Use our previous web platform detection
          
          // Create services with the database (or null db on web with fallbacks)
          // On web, if db is null, the services should use their internal fallbacks
          const exerciseService = new ExerciseService(db);
          const workoutService = new WorkoutService(db);
          
          // TemplateService requires both db and exerciseService
          const templateService = new TemplateService(db, exerciseService);
          const publicationQueue = new PublicationQueueService(db);
          const favoritesService = new FavoritesService(db);
          const powrPackService = new POWRPackService(db);
          
          if (isWeb && !db) {
            console.log('[DB] Web environment detected with null database - services will use in-memory fallbacks');
          }
          
          // Initialize table creation (if needed) and other startup operations
          // Some services may have additional initialization needs
          try {            
            // Connect the publication queue to NDK if available
            if (ndk && typeof publicationQueue.setNDK === 'function') {
              publicationQueue.setNDK(ndk);
            }
          } catch (initError) {
            console.warn('[DB] Non-critical initialization error:', initError);
            // Continue even if some initialization fails - especially on web
          }
          
          // Set services in the context
          setServices({
            exerciseService,
            workoutService,
            templateService,
            publicationQueue,
            favoritesService,
            powrPackService,
            db,
          });
          
          // Make database available to other modules that need it
          setDatabaseConnection(db);
          
          // Log database info in dev mode
          if (__DEV__) {
            await logDatabaseInfo();
          }
          
          console.log('[DB] Database initialized successfully');
          setIsReady(true);
        } catch (error) {
          console.error('[DB] Database initialization failed:', error);
          
          if (PlatformConstants.isWeb) {
            // On web, we'll try to continue even with errors
            console.warn('[DB] Continuing with limited functionality on web platform');
            // Note: We'll set an error message but still try to render the app
            setError('Database initialization had issues. Some features may not work properly on web.');
            // We'll continue with initialization but with limited functionality
          } else {
            // On native, we'll stop if there's an error
            setError(String(error));
            setIsReady(false);
            return;
          }
        }
      } catch (error) {
        console.error('[DB] Database initialization failed:', error);
        
        if (PlatformConstants.isWeb) {
          // On web, we'll try to continue even with errors
          console.warn('[DB] Continuing with limited functionality on web platform');
          // Note: We'll set an error message but still try to render the app
          setError('Database initialization had issues. Some features may not work properly on web.');
          // We'll continue with initialization but with limited functionality
        } else {
          // On native, we'll stop if there's an error
          setError(String(error));
          setIsReady(false);
          return;
        }
      }
    }

    initDatabase();
  }, [ndk]);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-4">
        <Text className="text-foreground text-lg font-bold mb-2">Database Error</Text>
        <Text className="text-destructive text-sm text-center">{error}</Text>
      </View>
    );
  }

  if (!isReady) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" className="mb-4" />
        <Text className="text-foreground text-base">Initializing Database...</Text>
      </View>
    );
  }

  return (
    <DatabaseServicesContext.Provider value={services}>
      <DelayedInitializer>
        {children}
      </DelayedInitializer>
    </DatabaseServicesContext.Provider>
  );
}

// Hooks for accessing services
export function useExerciseService() {
  const context = React.useContext(DatabaseServicesContext);
  const isWeb = Platform.OS === 'web' || PlatformConstants.isWeb;
  
  if (!context.exerciseService) {
    if (isWeb) {
      console.log('[DB] Web platform detected in useExerciseService - service not available');
      // Return a mock service with minimal functionality for web
      return {
        // Add minimal implementations for the most commonly used methods
        getExercises: async () => [],
        getExerciseById: async () => null,
        // Add other methods as needed
      } as any;
    }
    throw new Error('Exercise service not initialized');
  }
  return context.exerciseService;
}

export function useWorkoutService() {
  const context = React.useContext(DatabaseServicesContext);
  const isWeb = Platform.OS === 'web' || PlatformConstants.isWeb;
  
  if (!context.workoutService) {
    if (isWeb) {
      console.log('[DB] Web platform detected in useWorkoutService - service not available');
      // Return a mock service with minimal functionality for web
      return {
        // Add minimal implementations for the most commonly used methods
        getWorkouts: async () => [],
        getWorkoutById: async () => null,
        saveWorkout: async () => {},
        // Add other methods as needed
      } as any;
    }
    throw new Error('Workout service not initialized');
  }
  return context.workoutService;
}

export function useTemplateService() {
  const context = React.useContext(DatabaseServicesContext);
  const isWeb = Platform.OS === 'web' || PlatformConstants.isWeb;
  
  if (!context.templateService) {
    if (isWeb) {
      console.log('[DB] Web platform detected in useTemplateService - service not available');
      // Return a mock service with minimal functionality for web
      return {
        // Add minimal implementations for the most commonly used methods
        getTemplates: async () => [],
        getTemplateById: async () => null,
        // Add other methods as needed
      } as any;
    }
    throw new Error('Template service not initialized');
  }
  return context.templateService;
}

export function usePublicationQueue() {
  const context = React.useContext(DatabaseServicesContext);
  const isWeb = Platform.OS === 'web' || PlatformConstants.isWeb;
  
  if (!context.publicationQueue) {
    if (isWeb) {
      console.log('[DB] Web platform detected in usePublicationQueue - service not available');
      // Return a mock service with minimal functionality for web
      return {
        // Add minimal implementations for web
        setNDK: () => {},
        enqueue: async () => {},
        processQueue: async () => {},
        // Add other methods as needed
      } as any;
    }
    throw new Error('Publication queue not initialized');
  }
  return context.publicationQueue;
}

export function useFavoritesService() {
  const context = React.useContext(DatabaseServicesContext);
  const isWeb = Platform.OS === 'web' || PlatformConstants.isWeb;
  
  if (!context.favoritesService) {
    if (isWeb) {
      console.log('[DB] Web platform detected in useFavoritesService - service not available');
      // Return a mock service with minimal functionality for web
      return {
        // Add minimal implementations for web
        getFavorites: async () => [],
        addFavorite: async () => {},
        removeFavorite: async () => {},
        // Add other methods as needed
      } as any;
    }
    throw new Error('Favorites service not initialized');
  }
  return context.favoritesService;
}

export function usePOWRPackService() {
  const context = React.useContext(DatabaseServicesContext);
  const isWeb = Platform.OS === 'web' || PlatformConstants.isWeb;
  
  if (!context.powrPackService) {
    if (isWeb) {
      console.log('[DB] Web platform detected in usePOWRPackService - service not available');
      // Return a mock service with minimal functionality for web
      return {
        // Add minimal implementations for web
        getPacks: async () => [],
        // Add other methods as needed
      } as any;
    }
    throw new Error('POWR Pack service not initialized');
  }
  return context.powrPackService;
}

export function useDatabase() {
  const context = React.useContext(DatabaseServicesContext);
  const isWeb = Platform.OS === 'web' || PlatformConstants.isWeb;
  
  if (!context.db) {
    if (isWeb) {
      // On web platforms, return a lightweight IndexedDB-based implementation
      console.log('[DB] Creating web-friendly database fallback');
      
      // Create a minimal IndexedDB-compatible implementation
      const webDb = {
        // Basic properties
        databasePath: 'web-indexed-db',
        options: { version: 1 },
        nativeDatabase: null,
        _data: new Map(),
        _initialized: false,
        
        // Core methods
        execAsync: async (sql: string) => {
          console.log('[WebDB] execAsync:', sql);
          return Promise.resolve();
        },
        
        runAsync: async (sql: string, params: any[] = []) => {
          console.log('[WebDB] runAsync:', sql, params);
          // For web, store in memory with some persistence through sessionStorage
          try {
            if (!webDb._initialized) {
              try {
                // Try to restore data from sessionStorage
                const saved = sessionStorage.getItem('powr-web-db');
                if (saved) {
                  const parsed = JSON.parse(saved);
                  Object.entries(parsed).forEach(([key, value]) => {
                    webDb._data.set(key, value);
                  });
                }
                webDb._initialized = true;
              } catch (e) {
                console.warn('[WebDB] Could not restore from sessionStorage:', e);
              }
            }
            
            // Simple INSERT handling
            if (sql.toLowerCase().includes('insert into')) {
              const tableMatch = sql.match(/insert into\s+([\w_]+)/i);
              const tableName = tableMatch ? tableMatch[1] : 'unknown';
              
              // Generate an ID for the new item
              const id = Date.now();
              const tableData = webDb._data.get(tableName) || [];
              const newItem = { id, ...params.reduce((obj, val, idx) => ({ ...obj, [`param${idx}`]: val }), {}) };
              tableData.push(newItem);
              webDb._data.set(tableName, tableData);
              
              // Try to persist to sessionStorage
              try {
                const dataObject = Object.fromEntries(webDb._data.entries());
                sessionStorage.setItem('powr-web-db', JSON.stringify(dataObject));
              } catch (e) {
                console.warn('[WebDB] Could not save to sessionStorage:', e);
              }
              
              return { changes: 1, lastInsertRowId: id };
            }
            
            return { changes: 0, lastInsertRowId: -1 };
          } catch (err) {
            console.error('[WebDB] Error in runAsync:', err);
            return { changes: 0, lastInsertRowId: -1 };
          }
        },
        
        getFirstAsync: async (sql: string, params: any[] = []) => {
          console.log('[WebDB] getFirstAsync:', sql, params);
          // Extract table name from query
          const tableMatch = sql.match(/from\s+([\w_]+)/i);
          const tableName = tableMatch ? tableMatch[1] : null;
          
          if (tableName) {
            const tableData = webDb._data.get(tableName) || [];
            return tableData.length > 0 ? tableData[0] : null;
          }
          return null;
        },
        
        getAllAsync: async (sql: string, params: any[] = []) => {
          console.log('[WebDB] getAllAsync:', sql, params);
          // Extract table name from query
          const tableMatch = sql.match(/from\s+([\w_]+)/i);
          const tableName = tableMatch ? tableMatch[1] : null;
          
          if (tableName) {
            return webDb._data.get(tableName) || [];
          }
          return [];
        },
        
        closeAsync: async () => Promise.resolve(),
        withTransactionAsync: async (callback: () => Promise<void>) => callback(),
        isInTransactionAsync: async () => false,
        serializeAsync: async () => ({})
      } as unknown as SQLiteDatabase;
      
      console.log('[DB] Successfully created web-friendly database fallback');
      return webDb;
    } else {
      // On native platforms, this is a more serious error
      throw new Error('Database not initialized');
    }
  }
  return context.db;
}
