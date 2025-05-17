// lib/platform/fileSystemAdapter.ts
import * as FileSystem from 'expo-file-system';
import { createLogger } from '@/lib/utils/logger';
import { getPlatform, PlatformConstants, safelyRun } from './index';

const logger = createLogger('FileSystemAdapter');

/**
 * Platform-agnostic file system adapter
 * Provides a consistent API for file system operations across platforms
 */
export class FileSystemAdapter {
  private isWeb: boolean;
  private webStorageAvailable: boolean = false;
  private inMemoryStorage: Map<string, string> = new Map();
  private storagePrefix: string;

  constructor(storagePrefix: string = 'powr-fs') {
    this.isWeb = PlatformConstants.isWeb;
    this.storagePrefix = storagePrefix;

    if (this.isWeb) {
      try {
        const testKey = '__test__';
        localStorage.setItem(testKey, testKey);
        localStorage.removeItem(testKey);
        this.webStorageAvailable = true;
        logger.info('[FileSystemAdapter] Web storage is available and will be used for caching');
      } catch (e) {
        logger.warn('[FileSystemAdapter] Web storage not available. In-memory fallback will be used, but data will not persist between sessions.');
        this.webStorageAvailable = false;
      }
    }

    if (this.isWeb) {
      logger.debug('Initialized web file system adapter');
    } else {
      logger.debug('Initialized native file system adapter');
    }
  }

  /**
   * Get file or directory info
   */
  async getInfoAsync(path: string): Promise<FileSystem.FileInfo | null> {
    if (this.isWeb) {
      // In web, we can't directly access file info
      // Instead, try to see if we have any record of this path in localStorage
      const key = `${this.storagePrefix}:${path}`;

      if (typeof localStorage !== 'undefined') {
        const storedInfo = localStorage.getItem(key);
        if (storedInfo) {
          try {
            const parsedInfo = JSON.parse(storedInfo);
            return {
              exists: true,
              isDirectory: parsedInfo.isDirectory || false,
              uri: path,
              size: parsedInfo.size || 0,
              modificationTime: parsedInfo.modificationTime || Date.now() / 1000,
              md5: undefined
            };
          } catch (error) {
            logger.warn(`Error parsing stored file info for ${path}:`, error);
          }
        }
      }

      return null;
    }

    // On native platforms, use the real file system
    try {
      return await FileSystem.getInfoAsync(path);
    } catch (error) {
      logger.error(`Error getting info for ${path}:`, error);
      return null;
    }
  }

  /**
   * Create a directory
   */
  async makeDirectoryAsync(path: string, options?: FileSystem.MakeDirectoryOptions): Promise<void> {
    if (this.isWeb) {
      // On web, simulate directory creation by storing a record
      const key = `${this.storagePrefix}:${path}`;

      if (typeof localStorage !== 'undefined') {
        try {
          const dirInfo = {
            isDirectory: true,
            size: 0,
            modificationTime: Date.now() / 1000,
            children: []
          };

          localStorage.setItem(key, JSON.stringify(dirInfo));
          logger.debug(`Created virtual directory: ${path}`);
        } catch (error) {
          logger.error(`Error creating virtual directory ${path}:`, error);
        }
      }

      return;
    }

    // On native platforms, create a real directory
    try {
      await FileSystem.makeDirectoryAsync(path, options);
    } catch (error) {
      logger.error(`Error creating directory ${path}:`, error);
      throw error;
    }
  }

  /**
   * Read directory contents
   */
  async readDirectoryAsync(path: string): Promise<string[]> {
    if (this.isWeb) {
      // On web, simulate directory reading by checking localStorage
      const prefix = `${this.storagePrefix}:${path}/`;
      const results: string[] = [];

      if (typeof localStorage !== 'undefined') {
        try {
          // Look for keys that start with this path
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
              // Extract the filename from the key
              const fileName = key.substring(prefix.length).split('/')[0];
              if (fileName && !results.includes(fileName)) {
                results.push(fileName);
              }
            }
          }

          // Also check if we have a directory record with children
          const dirKey = `${this.storagePrefix}:${path}`;
          const dirInfo = localStorage.getItem(dirKey);
          if (dirInfo) {
            try {
              const parsed = JSON.parse(dirInfo);
              if (parsed.children && Array.isArray(parsed.children)) {
                for (const child of parsed.children) {
                  if (!results.includes(child)) {
                    results.push(child);
                  }
                }
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        } catch (error) {
          logger.error(`Error reading virtual directory ${path}:`, error);
        }
      }

      return results;
    }

    // On native platforms, read the real directory
    try {
      return await FileSystem.readDirectoryAsync(path);
    } catch (error) {
      logger.error(`Error reading directory ${path}:`, error);
      return [];
    }
  }

  /**
   * Delete a file or directory
   */
  async deleteAsync(path: string, options?: FileSystem.DeletingOptions): Promise<void> {
    if (this.isWeb) {
      // On web, remove from localStorage
      const prefix = `${this.storagePrefix}:${path}`;

      if (typeof localStorage !== 'undefined') {
        try {
          // Check if this is a directory - if so, remove all children
          const keysToRemove: string[] = [];

          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key === prefix || key.startsWith(`${prefix}/`))) {
              keysToRemove.push(key);
            }
          }

          // Remove all the collected keys
          for (const key of keysToRemove) {
            localStorage.removeItem(key);
          }

          logger.debug(`Deleted ${keysToRemove.length} virtual items from ${path}`);
        } catch (error) {
          logger.error(`Error deleting virtual items at ${path}:`, error);
        }
      }

      return;
    }

    // On native platforms, delete the real file/directory
    try {
      await FileSystem.deleteAsync(path, options);
    } catch (error) {
      logger.error(`Error deleting ${path}:`, error);
      throw error;
    }
  }

  /**
   * Read file content
   */
  async readAsStringAsync(path: string, options?: FileSystem.ReadingOptions): Promise<string> {
    if (this.isWeb) {
      // On web, read from localStorage or in-memory fallback
      const key = `${this.storagePrefix}:${path}`;

      if (this.webStorageAvailable) {
        try {
          const item = localStorage.getItem(key);
          if (item) {
            return item;
          }
        } catch (e) {
          logger.error(`Error reading from localStorage: ${e}`);
        }
      } else {
        // Try in-memory storage fallback
        const item = this.inMemoryStorage.get(key);
        if (item) {
          return item;
        }
      }

      return '';
    }

    // On native platforms, read the real file
    try {
      return await FileSystem.readAsStringAsync(path, options);
    } catch (error) {
      logger.error(`Error reading file ${path}:`, error);
      throw error;
    }
  }

  /**
   * Write string to file
   */
  async writeAsStringAsync(path: string, contents: string, options?: FileSystem.WritingOptions): Promise<void> {
    if (this.isWeb) {
      // On web, store in localStorage or in-memory fallback
      const key = `${this.storagePrefix}:${path}`;

      if (this.webStorageAvailable) {
        try {
          localStorage.setItem(key, contents);
          
          // Update parent directory's children if needed
          const lastSlash = path.lastIndexOf('/');
          if (lastSlash > 0) {
            const dirPath = path.substring(0, lastSlash);
            const filename = path.substring(lastSlash + 1);
            const dirKey = `${this.storagePrefix}:${dirPath}`;
            const dirInfoJSON = localStorage.getItem(dirKey);
            
            if (dirInfoJSON) {
              try {
                const dirInfo = JSON.parse(dirInfoJSON);
                if (dirInfo.children && Array.isArray(dirInfo.children)) {
                  // Add child if not already present
                  if (!dirInfo.children.includes(filename)) {
                    dirInfo.children.push(filename);
                    localStorage.setItem(dirKey, JSON.stringify(dirInfo));
                  }
                }
              } catch (error) {
                logger.error(`Error updating parent directory ${dirPath}:`, error);
              }
            }
          }
          
          logger.debug(`Wrote ${contents.length} bytes to virtual file: ${path}`);
        } catch (e) {
          logger.error(`Error writing to localStorage: ${e}`);
          // Fallback to in-memory storage
          this.inMemoryStorage.set(key, contents);
        }
      } else {
        // Use in-memory storage fallback
        this.inMemoryStorage.set(key, contents);
        logger.debug(`Wrote ${contents.length} bytes to in-memory storage: ${path}`);
      }
      
      return;
    }
    
    // On native platforms, write to the real file
    try {
      await FileSystem.writeAsStringAsync(path, contents, options);
    } catch (error) {
      logger.error(`Error writing to file ${path}:`, error);
      throw error;
    }
  }
  
  /**
   * Get platform-appropriate cache directory path
   */
  getCacheDirectory(): string {
    if (this.isWeb) {
      return 'web-cache:/';
    }
    
    return FileSystem.cacheDirectory || '';
  }
  
  /**
   * Get platform-appropriate document directory path
   */
  getDocumentDirectory(): string {
    if (this.isWeb) {
      return 'web-documents:/';
    }
    
    return FileSystem.documentDirectory || '';
  }
  
  /**
   * Get a full path with appropriate directory
   */
  getFullPath(relativePath: string, useCache: boolean = true): string {
    const baseDir = useCache ? this.getCacheDirectory() : this.getDocumentDirectory();
    
    // Make sure the path has a leading slash if needed
    if (relativePath.startsWith('/')) {
      relativePath = relativePath.substring(1);
    }
    
    return `${baseDir}${relativePath}`;
  }
}

/**
 * Create a file system adapter with the specified storage prefix
 */
export function createFileSystemAdapter(storagePrefix: string = 'powr-fs'): FileSystemAdapter {
  return new FileSystemAdapter(storagePrefix);
}

/**
 * Get the default file system adapter
 */
export const fileSystem = new FileSystemAdapter();
