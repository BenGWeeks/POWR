// lib/db/services/ImageCacheBase.ts
import NDK, { NDKUser } from '@nostr-dev-kit/ndk-mobile';
import { createLogger } from '@/lib/utils/logger';
import { SafeFileSystem, PlatformUtils } from '@/lib/utils/platform-utils';

// Base class for image caching that works on all platforms
export abstract class ImageCacheBase {
  protected ndk: NDK | null = null;
  protected accessLog: Map<string, number> = new Map(); // Track last access times
  protected cacheSize: number = 0; // Track total cache size
  protected initialized: boolean = false;
  protected cacheDirectory: string;
  protected cacheMetadata: Map<string, any> = new Map();
  protected webStorage: boolean = false;
  protected logger: ReturnType<typeof createLogger>;
  
  constructor(cacheName: string, maxCacheSize: number) {
    this.logger = createLogger(cacheName);
    this.cacheDirectory = `${SafeFileSystem.getCacheDirectory()}${cacheName}/`;
    
    // Initialize differently based on platform
    if (PlatformUtils.isWeb()) {
      this.logger.debug('Creating web version of cache');
      this.webStorage = true;
      this.initializeWebStorage(cacheName);
    } else {
      this.ensureCacheDirectoryExists();
    }
  }
  
  /**
   * Set the NDK instance for profile fetching
   * @param ndk NDK instance
   */
  setNDK(ndk: NDK): void {
    this.ndk = ndk;
    
    // Ensure cache is initialized when NDK is set
    if (!this.initialized) {
      this.initializeCacheMetadata();
    }
  }
  
  /**
   * Initialize web storage system
   */
  protected async initializeWebStorage(storagePrefix: string): Promise<void> {
    try {
      // In a web environment, load metadata from localStorage
      if (typeof window !== 'undefined' && window.localStorage) {
        const metadataKey = `${storagePrefix}-cache:metadata`;
        const storedMetadata = localStorage.getItem(metadataKey);
        
        if (storedMetadata) {
          try {
            const parsedMetadata = JSON.parse(storedMetadata) as any[];
            
            // Rebuild the cache metadata
            this.cacheMetadata.clear();
            this.accessLog.clear();
            this.cacheSize = 0;
            
            for (const item of parsedMetadata) {
              this.cacheMetadata.set(item.pubkey, item);
              this.accessLog.set(item.pubkey, item.lastAccessed);
              this.cacheSize += item.size;
            }
            
            this.logger.debug(`Web cache initialized: ${parsedMetadata.length} entries, ${(this.cacheSize / 1024).toFixed(2)} KB`);
          } catch (error) {
            this.logger.error('Error parsing cache metadata:', error);
          }
        } else {
          this.logger.debug('No existing cache metadata found');
        }
      } else {
        this.logger.warn('Web storage not available');
      }
      
      // Mark as initialized
      this.initialized = true;
      
      // Clean up old cache entries
      this.clearOldCache();
    } catch (error) {
      this.logger.error('Error initializing web cache metadata:', error);
    }
  }
  
  /**
   * Save web metadata
   */
  protected async saveWebMetadata(storagePrefix: string): Promise<void> {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const metadataArray = Array.from(this.cacheMetadata.values());
        localStorage.setItem(`${storagePrefix}-cache:metadata`, JSON.stringify(metadataArray));
      } catch (error) {
        this.logger.error('Error saving cache metadata:', error);
      }
    }
  }
  
  /**
   * Ensure the cache directory exists
   */
  protected async ensureCacheDirectoryExists(): Promise<void> {
    if (PlatformUtils.isWeb()) return;
    
    try {
      const dirInfo = await SafeFileSystem.getInfoAsync(this.cacheDirectory);
      if (!dirInfo || !dirInfo.exists) {
        await SafeFileSystem.makeDirectoryAsync(this.cacheDirectory, { intermediates: true });
        this.logger.debug(`Created cache directory: ${this.cacheDirectory}`);
      }
    } catch (error) {
      this.logger.error('Error creating cache directory:', error);
    }
  }
  
  /**
   * Initialize cache metadata
   */
  protected abstract initializeCacheMetadata(): Promise<void>;
  
  /**
   * Clear old cache items
   */
  protected abstract clearOldCache(maxAgeDays?: number): Promise<void>;
  
  /**
   * Get current cache statistics
   */
  async getCacheStats(): Promise<{ size: number; itemCount: number; directory: string }> {
    return {
      size: this.cacheSize,
      itemCount: this.accessLog.size,
      directory: this.webStorage ? 'web-storage' : this.cacheDirectory
    };
  }
  
  /**
   * Clear the entire cache
   */
  async clearCache(): Promise<void> {
    if (this.webStorage) {
      // Web implementation
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          // Clear all cache-related entries
          const prefix = this.cacheDirectory.split('/')[1];
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.includes(prefix)) {
              keysToRemove.push(key);
            }
          }
          
          // Remove all keys
          for (const key of keysToRemove) {
            localStorage.removeItem(key);
          }
        }
        
        // Reset metadata
        this.cacheMetadata.clear();
        this.accessLog.clear();
        this.cacheSize = 0;
        
        this.logger.debug('Cache cleared (web storage)');
      } catch (error) {
        this.logger.error('Error clearing web cache:', error);
      }
    } else {
      // Native implementation
      try {
        await SafeFileSystem.deleteAsync(this.cacheDirectory, { idempotent: true });
        await this.ensureCacheDirectoryExists();
        
        // Reset metadata
        this.accessLog.clear();
        this.cacheSize = 0;
        this.initialized = false;
        
        this.logger.debug('Cache cleared (native storage)');
      } catch (error) {
        this.logger.error('Error clearing native cache:', error);
      }
    }
  }
}
