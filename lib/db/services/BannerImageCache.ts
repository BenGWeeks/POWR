import NDK, { NDKUser, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk-mobile';
import { createLogger, enableModule } from '../../utils/logger';
import { Platform } from 'react-native';
import { fileSystem } from '../../platform/fileSystemAdapter';

// Enable logging for BannerImageCache
enableModule('BannerImageCache');
const logger = createLogger('BannerImageCache');
const platformTag = Platform.OS === 'ios' ? '[iOS]' : '[Android]';

// Constants for cache management
const MAX_CACHE_SIZE = 150 * 1024 * 1024; // 150MB limit for banner images (larger than profile images)
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_FRESHNESS_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheAccessRecord {
  pubkey: string;
  path: string;
  size: number;
  lastAccessed: number;
}

/**
 * Service for caching profile banner images
 * This service downloads and caches banner images locally,
 * providing offline access and reducing network usage
 * 
 * Enhanced with:
 * - LRU-based eviction for space management
 * - Size-based limits (150MB max)
 * - Usage tracking for intelligent cleanup
 */
export class BannerImageCache {
  private cacheDirectory: string;
  private ndk: NDK | null = null;
  private accessLog: Map<string, number> = new Map(); // Track last access times
  private cacheSize: number = 0; // Track total cache size
  private initialized: boolean = false;
  
  constructor() {
    this.cacheDirectory = `${fileSystem.getCacheDirectory()}banner-images/`;
    this.ensureCacheDirectoryExists();
  }
  
  /**
   * Set the NDK instance for profile fetching
   * @param ndk NDK instance
   */
  setNDK(ndk: NDK) {
    this.ndk = ndk;
    
    // Initialize cache metadata when NDK is set
    if (!this.initialized) {
      this.initializeCacheMetadata();
    }
  }
  
  /**
   * Ensure the cache directory exists
   * @private
   */
  private async ensureCacheDirectoryExists() {
    try {
      const dirInfo = await fileSystem.getInfoAsync(this.cacheDirectory);
      if (!dirInfo || !dirInfo.exists) {
        await fileSystem.makeDirectoryAsync(this.cacheDirectory, { intermediates: true });
        logger.info(`Created banner image cache directory: ${this.cacheDirectory}`);
      }
    } catch (error) {
      // Log the error but don't throw - we need to handle web platform gracefully
      logger.warn('Error creating banner cache directory - web fallback will be used:', error);
    }
  }
  
  /**
   * Initialize cache metadata by scanning the cache directory
   * @private
   */
  private async initializeCacheMetadata() {
    try {
      // Get list of all cached files
      const files = await fileSystem.readDirectoryAsync(this.cacheDirectory);
      this.cacheSize = 0;
      
      // Process each file to build the access log and calculate total size
      for (const file of files) {
        if (!file.endsWith('_banner.jpg')) continue;
        
        const filePath = `${this.cacheDirectory}${file}`;
        const fileInfo = await fileSystem.getInfoAsync(filePath);
        
        if (fileInfo && fileInfo.exists && fileInfo.size) {
          const pubkey = file.replace('_banner.jpg', '');
          
          // Add to access log with current time (conservative approach)
          this.accessLog.set(pubkey, Date.now());
          
          // Add to total cache size
          this.cacheSize += fileInfo.size;
        }
      }
      
      logger.info(`Banner image cache initialized: ${files.length} files, ${(this.cacheSize / (1024 * 1024)).toFixed(2)} MB`);
      
      // If cache is over the limit already, clean it up
      if (this.cacheSize > MAX_CACHE_SIZE) {
        this.enforceSizeLimit();
      }
      
      // Mark as initialized
      this.initialized = true;
      
      // Also clear old cache based on time
      this.clearOldCache();
    } catch (error) {
      // On web, this might fail but we can continue without caching
      logger.warn('Error initializing banner cache metadata - using in-memory fallback:', error);
      this.initialized = true; // Mark as initialized anyway to prevent repeated attempts
    }
  }
  
  /**
   * Get a cached banner image URI or download if needed
   * @param pubkey User's public key
   * @param fallbackUrl Fallback URL to use if no cached image is found
   * @returns Promise with the cached image URI or fallback URL
   */
  async getBannerImageUri(pubkey?: string, fallbackUrl?: string): Promise<string | undefined> {
    try {
      if (!pubkey) {
        logger.warn(`${platformTag} getBannerImageUri called without pubkey`);
        return fallbackUrl;
      }
      
      logger.info(`${platformTag} Getting banner for pubkey: ${pubkey.substring(0, 8)}...`);
      
      // Check if image exists in cache
      const cachedPath = `${this.cacheDirectory}${pubkey}_banner.jpg`;
      logger.debug(`${platformTag} Checking cache at path: ${cachedPath}`);
      
      // Check if we have a cached file
      try {
        const fileInfo = await fileSystem.getInfoAsync(cachedPath);
        
        if (fileInfo && fileInfo.exists) {
          // Check if cache is stale
          const modTime = (fileInfo as any).modificationTime || 0;
          const fileAge = Date.now() - modTime * 1000; // modTime is in seconds
          
          // If file is fresh enough, use it right away
          if (fileAge < CACHE_FRESHNESS_MS) {
            // Record access
            this.accessLog.set(pubkey, Date.now());
            return cachedPath;
          } else {
            // Cache exists but is stale - fetch in background but return the cached version right away
            this.fetchAndCacheBanner(pubkey, fallbackUrl, cachedPath);
            
            // Record access
            this.accessLog.set(pubkey, Date.now());
            return cachedPath;
          }
        }
      } catch (error) {
        logger.warn(`${platformTag} Error checking cached file, will try downloading: ${error}`);
      }
      
      // Before downloading, make sure we have enough space
      await this.enforceSizeLimit();
      
      // If not in cache or stale, try to get from NDK
      if (this.ndk) {
        logger.info(`${platformTag} Attempting to fetch profile data from NDK`);
        try {
          const user = new NDKUser({ pubkey });
          user.ndk = this.ndk;
          
          // Get profile from NDK cache first
          await user.fetchProfile({ 
            cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST 
          });
          
          // Log profile data for debugging
          logger.debug(`${platformTag} Profile data received: ${JSON.stringify({
            hasBanner: !!user.profile?.banner,
            hasBackground: !!(user.profile as any)?.background,
            hasFallback: !!fallbackUrl
          })}`);
          
          const imageUrl = user.profile?.banner || 
                        (user.profile as any)?.background ||
                        fallbackUrl;
          
          if (imageUrl) {
            logger.info(`${platformTag} Found image URL: ${imageUrl}`);
            try {
              // Download and cache the image using our platform-agnostic adapter
              await this.downloadAndCacheImage(imageUrl, cachedPath, pubkey);
              return cachedPath;
            } catch (downloadError) {
              logger.error(`${platformTag} Error downloading banner: ${downloadError}`);
              return fallbackUrl;
            }
          } else {
            logger.info(`${platformTag} No banner image URL found in profile`);
            return fallbackUrl;
          }
        } catch (error) {
          logger.error(`${platformTag} Error fetching profile: ${error}`);
          return fallbackUrl;
        }
      }
      
      // Return fallback URL if nothing else works
      return fallbackUrl;
    } catch (error) {
      logger.error(`${platformTag} Unexpected error in getBannerImageUri: ${error}`);
      return fallbackUrl;
    }
  }
  
  /**
   * Fetch and cache a banner image in background
   */
  private async fetchAndCacheBanner(pubkey: string, fallbackUrl?: string, cachedPath?: string) {
    if (!this.ndk) return;
    
    try {
      const user = new NDKUser({ pubkey });
      user.ndk = this.ndk;
      
      await user.fetchProfile({ 
        cacheUsage: NDKSubscriptionCacheUsage.PREFER_CACHE 
      });
      
      const imageUrl = user.profile?.banner || 
                     (user.profile as any)?.background ||
                     fallbackUrl;
      
      if (imageUrl && cachedPath) {
        await this.downloadAndCacheImage(imageUrl, cachedPath, pubkey);
      }
    } catch (error) {
      logger.warn(`${platformTag} Background banner fetch failed: ${error}`);
    }
  }
  
  /**
   * Download and cache an image
   */
  private async downloadAndCacheImage(url: string, cachedPath: string, pubkey: string) {
    try {
      // On web, we need to handle downloading differently
      if (typeof window !== 'undefined') {
        // For web, fetch image and convert to blob
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error, status = ${response.status}`);
        }
        
        const blob = await response.blob();
        const blobSize = blob.size;
        
        // Write blob to our virtual filesystem
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        
        await new Promise((resolve, reject) => {
          reader.onloadend = async () => {
            try {
              // Save as data URL in our cache
              if (reader.result) {
                await fileSystem.writeAsStringAsync(cachedPath, reader.result.toString());
                
                // Update cache metadata
                this.accessLog.set(pubkey, Date.now());
                this.cacheSize += blobSize;
                
                logger.info(`${platformTag} Successfully cached banner image for web (${(blobSize / 1024).toFixed(1)} KB)`);
                resolve(true);
              } else {
                reject(new Error('Failed to read image data'));
              }
            } catch (error) {
              reject(error);
            }
          };
          reader.onerror = reject;
        });
        
        return;
      }
      
      // For native platforms, use downloadAsync directly
      const downloadResult: any = await fileSystem.writeAsStringAsync(
        cachedPath, 
        `fetch:${url}`  // Our adapter should recognize this as a download instruction
      );
      
      // Verify the file exists after download
      const fileInfo = await fileSystem.getInfoAsync(cachedPath);
      if (fileInfo && fileInfo.exists && fileInfo.size > 0) {
        // Update cache metadata
        this.accessLog.set(pubkey, Date.now());
        this.cacheSize += fileInfo.size;
        
        logger.info(`${platformTag} Successfully cached banner image (${(fileInfo.size / 1024).toFixed(1)} KB)`);
      } else {
        throw new Error('Downloaded file is empty or missing');
      }
    } catch (error) {
      logger.error(`${platformTag} Error in downloadAndCacheImage: ${error}`);
      throw error;
    }
  }
  
  /**
   * Enforce the cache size limit by removing least recently used items
   * @private
   */
  private async enforceSizeLimit() {
    try {
      // If we're under the limit, no need to clean up
      if (this.cacheSize <= MAX_CACHE_SIZE * 0.9) { // 90% threshold to avoid cleaning up too often
        return;
      }
      
      // Convert the access log to an array for sorting
      const accessRecords: CacheAccessRecord[] = [];
      
      // Get all cache files with their metadata
      const files = await fileSystem.readDirectoryAsync(this.cacheDirectory);
      for (const file of files) {
        if (!file.endsWith('_banner.jpg')) continue;
        
        const pubkey = file.replace('_banner.jpg', '');
        const path = `${this.cacheDirectory}${file}`;
        const fileInfo = await fileSystem.getInfoAsync(path);
        
        if (fileInfo && fileInfo.exists && fileInfo.size) {
          accessRecords.push({
            pubkey,
            path,
            size: fileInfo.size,
            lastAccessed: this.accessLog.get(pubkey) || 0
          });
        }
      }
      
      // Sort by last accessed time (oldest first)
      accessRecords.sort((a, b) => a.lastAccessed - b.lastAccessed);
      
      // Delete oldest files until we're under the size limit
      let removedCount = 0;
      let freedSpace = 0;
      
      for (const record of accessRecords) {
        // Stop if we've freed enough space (aim for 75% of max to leave headroom)
        if (this.cacheSize - freedSpace <= MAX_CACHE_SIZE * 0.75) {
          break;
        }
        
        try {
          await fileSystem.deleteAsync(record.path, { idempotent: true });
          
          // Update cache metadata
          this.accessLog.delete(record.pubkey);
          freedSpace += record.size;
          removedCount++;
          
          logger.info(`Removed old banner image: ${record.pubkey} (${(record.size / 1024).toFixed(1)} KB)`);
        } catch (error) {
          logger.error(`Error removing cache file ${record.path}:`, error);
        }
      }
      
      // Update total cache size
      this.cacheSize -= freedSpace;
      
      if (removedCount > 0) {
        logger.info(`Cleaned up banner image cache: removed ${removedCount} files, freed ${(freedSpace / (1024 * 1024)).toFixed(2)} MB`);
      }
    } catch (error) {
      logger.warn('Error enforcing cache size limit - not critical:', error);
    }
  }
  
  /**
   * Clear old cached images
   * @param maxAgeDays Maximum age in days (default: 7)
   * @returns Promise that resolves when clearing is complete
   */
  async clearOldCache(maxAgeDays: number = 7): Promise<void> {
    try {
      const files = await fileSystem.readDirectoryAsync(this.cacheDirectory);
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      const now = Date.now();
      let clearedCount = 0;
      let clearedSize = 0;
      
      for (const file of files) {
        const filePath = `${this.cacheDirectory}${file}`;
        const fileInfo = await fileSystem.getInfoAsync(filePath);
        
        if (fileInfo && fileInfo.exists) {
          // Type assertion for modificationTime
          const modTime = (fileInfo as any).modificationTime || 0;
          const fileAge = now - modTime * 1000;
          if (fileAge > maxAgeMs) {
            // Get file size for statistics before deleting
            const size = fileInfo.size || 0;
            
            await fileSystem.deleteAsync(filePath);
            
            // Update cache metadata
            const pubkey = file.replace('_banner.jpg', '');
            this.accessLog.delete(pubkey);
            this.cacheSize -= size;
            
            clearedCount++;
            clearedSize += size;
          }
        }
      }
      
      logger.info(`Cleared ${clearedCount} old banner images from cache (${(clearedSize / (1024 * 1024)).toFixed(2)} MB)`);
    } catch (error) {
      logger.warn('Error clearing old banner cache - this is not critical:', error);
    }
  }
  
  /**
   * Clear the entire cache
   * @returns Promise that resolves when clearing is complete
   */
  async clearCache(): Promise<void> {
    try {
      await fileSystem.deleteAsync(this.cacheDirectory, { idempotent: true });
      await this.ensureCacheDirectoryExists();
      
      // Reset metadata
      this.accessLog.clear();
      this.cacheSize = 0;
      this.initialized = false;
      
      logger.info('Banner image cache cleared');
    } catch (error) {
      logger.error('Error clearing banner cache:', error);
    }
  }
  
  /**
   * Get current cache statistics
   * @returns Object with cache statistics
   */
  async getCacheStats() {
    return {
      size: this.cacheSize,
      itemCount: this.accessLog.size,
      directory: this.cacheDirectory
    };
  }
}

// Create singleton instance
export const bannerImageCache = new BannerImageCache();
