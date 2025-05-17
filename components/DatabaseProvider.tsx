// components/DatabaseProvider.tsx
import React from 'react';
import { View, ActivityIndicator, ScrollView, Text } from 'react-native';
import { Platform } from 'react-native';
// Import SQLite type and our new cross-platform database adapter
import { type SQLiteDatabase } from 'expo-sqlite';
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
          const dbAdapter = createDatabaseAdapter('powr.db');
          // Get the native SQLite database object which is compatible with our schema functions
          const db = dbAdapter.getNativeDatabase();
          
          if (!db) {
            throw new Error('Failed to create database adapter');
          }
          
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
          
          // Create services with the database
          // We use a database adapter that can use db, or fallback to memory on web
          const exerciseService = new ExerciseService(db);
          const workoutService = new WorkoutService(db);
          // TemplateService requires both db and exerciseService
          const templateService = new TemplateService(db, exerciseService);
          const publicationQueue = new PublicationQueueService(db);
          const favoritesService = new FavoritesService(db);
          const powrPackService = new POWRPackService(db);
          
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
  if (!context.exerciseService) {
    throw new Error('Exercise service not initialized');
  }
  return context.exerciseService;
}

export function useWorkoutService() {
  const context = React.useContext(DatabaseServicesContext);
  if (!context.workoutService) {
    throw new Error('Workout service not initialized');
  }
  return context.workoutService;
}

export function useTemplateService() {
  const context = React.useContext(DatabaseServicesContext);
  if (!context.templateService) {
    throw new Error('Template service not initialized');
  }
  return context.templateService;
}

export function usePublicationQueue() {
  const context = React.useContext(DatabaseServicesContext);
  if (!context.publicationQueue) {
    throw new Error('Publication queue not initialized');
  }
  return context.publicationQueue;
}

export function useFavoritesService() {
  const context = React.useContext(DatabaseServicesContext);
  if (!context.favoritesService) {
    throw new Error('Favorites service not initialized');
  }
  return context.favoritesService;
}

export function usePOWRPackService() {
  const context = React.useContext(DatabaseServicesContext);
  if (!context.powrPackService) {
    throw new Error('POWR Pack service not initialized');
  }
  return context.powrPackService;
}

export function useDatabase() {
  const context = React.useContext(DatabaseServicesContext);
  if (!context.db) {
    throw new Error('Database not initialized');
  }
  return context.db;
}
