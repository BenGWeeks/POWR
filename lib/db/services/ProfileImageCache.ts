import * as FileSystem from 'expo-file-system';
import NDK, { NDKUser, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk-mobile';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { isWeb, WebStorage, InMemoryStorage } from '@/lib/platform/webFallbacks';
import { createLogger } from '@/lib/utils/logger';

// Constants for cache management
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB limit for profile images
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_FRESHNESS_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheAccessRecord {
  pubkey: string;
  path: string;
  size: number;
  lastAccessed: number;
}

/**
 * Service for caching profile images
 * This service downloads and caches profile images locally,
 * providing offline access and reducing network usage
 * 
 * Enhanced with:
 * - LRU-based eviction for space management
 * - Size-based limits (50MB max)
 * - Usage tracking for intelligent cleanup
 */
// Create a logger instance
const logger = createLogger('ProfileImageCache');

export class ProfileImageCache {
  private cacheDirectory: string;
  private ndk: NDK | null = null;
  private accessLog: Map<string, number> = new Map(); // Track last access times
  private cacheSize: number = 0; // Track total cache size
  private initialized: boolean = false;
  private webCache: Map<string, string> = new Map(); // In-memory cache for web platform
  
  constructor() {
    // Set cache directory for native platforms
    this.cacheDirectory = isWeb 
      ? '' // Web platform doesn't use FileSystem
      : `${FileSystem.cacheDirectory}profile-images/`;
    
    // Initialize the cache based on platform
    if (!isWeb) {
      this.ensureCacheDirectoryExists();
    } else {
      // For web, we'll try to load any previously stored cache from localStorage
      this.initializeWebCache();
      this.initialized = true;
    }
  }
  
  /**
   * Initialize the web cache from localStorage if available
   * @private
   */
  private initializeWebCache() {
    if (!isWeb) return;
    
    try {
      // Try to load cached URLs from localStorage
      const cachedData = WebStorage.getItem('profile-image-cache');
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        
        // Rebuild the cache from the stored data
        if (parsed && typeof parsed === 'object') {
          Object.entries(parsed).forEach(([pubkey, url]) => {
            if (typeof url === 'string') {
              this.webCache.set(pubkey, url);
              this.accessLog.set(pubkey, Date.now());
            }
          });
        }
        
        logger.debug(`Loaded ${this.webCache.size} profile images from web cache`);
      }
    } catch (error) {
      logger.warn('Failed to load web cache from localStorage:', error);
    }
  }
  
  /**
   * Save the web cache to localStorage
   * @private
   */
  private saveWebCache() {
    if (!isWeb) return;
    
    try {
      // Create a simple object from the Map for storage
      const cacheObject: Record<string, string> = {};
      this.webCache.forEach((url, pubkey) => {
        cacheObject[pubkey] = url;
      });
      
      // Store in localStorage
      WebStorage.setItem('profile-image-cache', JSON.stringify(cacheObject));
    } catch (error) {
      logger.warn('Failed to save web cache to localStorage:', error);
    }
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
    if (isWeb) return; // No need on web platform
    
    try {
      const dirInfo = await FileSystem.getInfoAsync(this.cacheDirectory);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(this.cacheDirectory, { intermediates: true });
        logger.debug(`Created profile image cache directory: ${this.cacheDirectory}`);
      }
    } catch (error) {
      logger.error('Error creating cache directory:', error);
    }
  }
  
  /**
   * Initialize cache metadata by scanning the cache directory
   * @private
   */
  private async initializeCacheMetadata() {
    try {
      // Get list of all cached files
      const files = await FileSystem.readDirectoryAsync(this.cacheDirectory);
      this.cacheSize = 0;
      
      // Process each file to build the access log and calculate total size
      for (const file of files) {
        if (!file.endsWith('.jpg')) continue;
        
        const filePath = `${this.cacheDirectory}${file}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        
        if (fileInfo.exists && fileInfo.size) {
          const pubkey = file.replace('.jpg', '');
          
          // Add to access log with current time (conservative approach)
          this.accessLog.set(pubkey, Date.now());
          
          // Add to total cache size
          this.cacheSize += fileInfo.size;
        }
      }
      
      console.log(`Profile image cache initialized: ${files.length} files, ${(this.cacheSize / (1024 * 1024)).toFixed(2)} MB`);
      
      // If cache is over the limit already, clean it up
      if (this.cacheSize > MAX_CACHE_SIZE) {
        this.enforceSizeLimit();
      }
      
      // Mark as initialized
      this.initialized = true;
      
      // Also clear old cache based on time
      this.clearOldCache();
    } catch (error) {
      console.error('Error initializing cache metadata:', error);
    }
  }
  
  /**
   * Extract pubkey from a profile image URI
   * @param uri Profile image URI
   * @returns Pubkey if found, undefined otherwise
   */
  extractPubkeyFromUri(uri?: string): string | undefined {
    if (!uri) return undefined;
    
    // Try to extract pubkey from nostr: URI
    if (uri.startsWith('nostr:')) {
      const match = uri.match(/nostr:pubkey:([a-f0-9]{64})/i);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    // Try to extract from URL parameters
    try {
      const url = new URL(uri);
      const pubkey = url.searchParams.get('pubkey');
      if (pubkey && pubkey.length === 64) {
        return pubkey;
      }
    } catch (error) {
      // Not a valid URL, continue
    }
    
    return undefined;
  }
  
  /**
   * Get a cached profile image URI or download if needed
   * @param pubkey User's public key
   * @param fallbackUrl Fallback URL to use if no cached image is found
   * @returns Promise with the cached image URI or fallback URL
   */
  async getProfileImageUri(pubkey?: string, fallbackUrl?: string): Promise<string | undefined> {
    if (!pubkey) return fallbackUrl;
    
    // Handle differently based on platform
    if (isWeb) {
      return this.getWebProfileImageUri(pubkey, fallbackUrl);
    } else {
      return this.getNativeProfileImageUri(pubkey, fallbackUrl);
    }
  }
  
  /**
   * Get profile image for web platform
   * @private
   */
  private async getWebProfileImageUri(pubkey: string, fallbackUrl?: string): Promise<string | undefined> {
    try {
      // Check if we already have a cached URL in memory
      if (this.webCache.has(pubkey)) {
        // Update access time
        this.accessLog.set(pubkey, Date.now());
        return this.webCache.get(pubkey);
      }
      
      // Try to fetch the profile to get the image URL
      if (this.ndk) {
        const user = this.ndk.getUser({ pubkey });
        
        try {
          // Attempt to fetch the profile
          await user.fetchProfile();
          
          if (user.profile?.image) {
            const imageUrl = user.profile.image;
            
            // Store in our web cache
            this.webCache.set(pubkey, imageUrl);
            this.accessLog.set(pubkey, Date.now());
            
            // Persist to localStorage
            this.saveWebCache();
            
            return imageUrl;
          }
        } catch (profileError) {
          logger.warn(`Failed to fetch profile for ${pubkey}:`, profileError);
        }
      }
      
      // If we reach here, return the fallback
      return fallbackUrl;
    } catch (error) {
      logger.error('Error in getWebProfileImageUri:', error);
      return fallbackUrl;
    }
  }
  
  /**
   * Get profile image for native platforms
   * @private
   */
  private async getNativeProfileImageUri(pubkey: string, fallbackUrl?: string): Promise<string | undefined> {
    try {
      // Check if we already have a cached image
      const cachedImagePath = `${this.cacheDirectory}${pubkey}.jpg`;
      const fileInfo = await FileSystem.getInfoAsync(cachedImagePath);
      
      // If image exists and is not too old, return it
      if (fileInfo.exists) {
        // Update access log
        this.accessLog.set(pubkey, Date.now());
        
        // Type assertion for modification time
        const modTime = (fileInfo as any).modificationTime || 0;
        const fileAge = Date.now() - modTime * 1000;
        
        if (fileAge < CACHE_FRESHNESS_MS) {
          return cachedImagePath;
        }
        
        // Image exists but is old - we'll still use it but also try to refresh
        logger.debug(`Profile image for ${pubkey} is old (${Math.round(fileAge / (1000 * 60 * 60))} hours), refreshing...`);
      }
      
      // If we have NDK, try to fetch the profile picture URL
      if (this.ndk) {
        // First check if we have a URL already
        let user = this.ndk.getUser({ pubkey });
        
        try {
          // Attempt to fetch the profile with cache usage
          await user.fetchProfile();
          
          if (user.profile?.image) {
            const imageUrl = user.profile.image;
            
            try {
              // Download the image to cache
              const downloadResult = await FileSystem.downloadAsync(
                imageUrl,
                cachedImagePath
              );
              
              if (downloadResult.status === 200) {
                logger.debug(`Downloaded profile image for ${pubkey}`);
                
                // Get file info to update cache size
                const newFileInfo = await FileSystem.getInfoAsync(cachedImagePath);
                if (newFileInfo.exists && newFileInfo.size) {
                  // Check if we need to enforce size limits
                  this.cacheSize += newFileInfo.size;
                  if (this.cacheSize > MAX_CACHE_SIZE) {
                    this.enforceSizeLimit();
                  }
                  
                  // Update access log
                  this.accessLog.set(pubkey, Date.now());
                }
                
                return cachedImagePath;
              }
            } catch (downloadError) {
              logger.error(`Error downloading profile image for ${pubkey}:`, downloadError);
            }
          }
        } catch (error) {
          console.log('Could not fetch profile from cache:', error);
        }
        
        // If not in cache and no fallback, try network
        if (!fallbackUrl) {
          try {
            await user.fetchProfile({
              cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST
            });
            const imageUrl = user.profile?.image || user.profile?.picture;
            
            if (imageUrl) {
              // Download and cache the image
              const cachedImagePath = `${this.cacheDirectory}${pubkey}.jpg`;
              logger.debug(`Downloading profile image for ${pubkey} from ${imageUrl}`);
              const downloadResult = await FileSystem.downloadAsync(imageUrl, cachedImagePath);
              
              // Update cache metadata if successful
              if (downloadResult.status === 200) {
                const fileInfo = await FileSystem.getInfoAsync(cachedImagePath);
                if (fileInfo.exists && fileInfo.size > 0) {
                  this.accessLog.set(pubkey, Date.now());
                  this.cacheSize += fileInfo.size;
                }
              }
              return cachedImagePath;
            }
          } catch (error) {
            console.error('Error fetching profile from network:', error);
          }
        }
      }
      
      // Return fallback URL if provided and nothing in cache
      return fallbackUrl;
    } catch (error) {
      console.error('Error getting profile image:', error);
      return fallbackUrl;
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
      const files = await FileSystem.readDirectoryAsync(this.cacheDirectory);
      for (const file of files) {
        if (!file.endsWith('.jpg')) continue;
        
        const pubkey = file.replace('.jpg', '');
        const path = `${this.cacheDirectory}${file}`;
        const fileInfo = await FileSystem.getInfoAsync(path);
        
        if (fileInfo.exists && fileInfo.size) {
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
          await FileSystem.deleteAsync(record.path, { idempotent: true });
          
          // Update cache metadata
          this.accessLog.delete(record.pubkey);
          freedSpace += record.size;
          removedCount++;
          
          console.log(`Removed old profile image: ${record.pubkey} (${(record.size / 1024).toFixed(1)} KB)`);
        } catch (error) {
          console.error(`Error removing cache file ${record.path}:`, error);
        }
      }
      
      // Update total cache size
      this.cacheSize -= freedSpace;
      
      if (removedCount > 0) {
        console.log(`Cleaned up profile image cache: removed ${removedCount} files, freed ${(freedSpace / (1024 * 1024)).toFixed(2)} MB`);
      }
    } catch (error) {
      console.error('Error enforcing cache size limit:', error);
    }
  }
  
  /**
   * Clear old cached images
   * @param maxAgeDays Maximum age in days (default: 7)
   * @returns Promise that resolves when clearing is complete
   */
  async clearOldCache(maxAgeDays: number = 7): Promise<void> {
    try {
      const files = await FileSystem.readDirectoryAsync(this.cacheDirectory);
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      const now = Date.now();
      let clearedCount = 0;
      let clearedSize = 0;
      
      for (const file of files) {
        const filePath = `${this.cacheDirectory}${file}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        
        if (fileInfo.exists) {
          // Type assertion for modificationTime
          const modTime = (fileInfo as any).modificationTime || 0;
          const fileAge = now - modTime * 1000;
          if (fileAge > maxAgeMs) {
            // Get file size for statistics before deleting
            const size = fileInfo.size || 0;
            
            await FileSystem.deleteAsync(filePath);
            
            // Update cache metadata
            const pubkey = file.replace('.jpg', '');
            this.accessLog.delete(pubkey);
            this.cacheSize -= size;
            
            clearedCount++;
            clearedSize += size;
          }
        }
      }
      
      console.log(`Cleared ${clearedCount} old profile images from cache (${(clearedSize / (1024 * 1024)).toFixed(2)} MB)`);
    } catch (error) {
      console.error('Error clearing old cache:', error);
    }
  }
  
  /**
   * Clear the entire cache
   * @returns Promise that resolves when clearing is complete
   */
  async clearCache(): Promise<void> {
    if (isWeb) {
      // For web, just clear the in-memory cache and localStorage
      this.webCache.clear();
      this.accessLog.clear();
      WebStorage.removeItem('profile-image-cache');
      logger.debug('Web profile image cache cleared');
      return;
    }
    
    try {
      await FileSystem.deleteAsync(this.cacheDirectory, { idempotent: true });
      await this.ensureCacheDirectoryExists();
      
      // Reset metadata
      this.accessLog.clear();
      this.cacheSize = 0;
      this.initialized = false;
      
      logger.debug('Profile image cache cleared');
    } catch (error) {
      logger.error('Error clearing cache:', error);
    }
  }
  
  /**
   * Get current cache statistics
   * @returns Object with cache statistics
   */
  async getCacheStats() {
    if (isWeb) {
      return {
        size: 0, // Not applicable on web
        itemCount: this.webCache.size,
        directory: 'web-storage'
      };
    }
    
    return {
      size: this.cacheSize,
      itemCount: this.accessLog.size,
      directory: this.cacheDirectory
    };
  }
}

// Create singleton instance
export const profileImageCache = new ProfileImageCache();
