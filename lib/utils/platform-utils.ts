// lib/utils/platform-utils.ts
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { createLogger } from './logger';

const logger = createLogger('PlatformUtils');

/**
 * Safely determines if a feature is available on the current platform
 * 
 * @param feature Name of the feature to check availability for
 * @returns boolean indicating if the feature is available
 */
export function isFeatureAvailable(feature: 'fileSystem' | 'sqlite' | 'notification' | 'camera'): boolean {
  switch (feature) {
    case 'fileSystem':
      return Platform.OS !== 'web';
    case 'sqlite':
      return true; // We handle SQLite compatibility in database services
    case 'notification':
      return Platform.OS !== 'web';
    case 'camera':
      return Platform.OS !== 'web';
    default:
      return false;
  }
}

/**
 * Safe file system operations that work across platforms
 */
export const SafeFileSystem = {
  /**
   * Safely get file info, returns null on web or if operation fails
   */
  async getInfoAsync(fileUri: string): Promise<FileSystem.FileInfo | null> {
    if (Platform.OS === 'web') {
      return null;
    }
    
    try {
      return await FileSystem.getInfoAsync(fileUri);
    } catch (error) {
      logger.warn(`Error getting file info for ${fileUri}:`, error);
      return null;
    }
  },
  
  /**
   * Safely make directory, no-op on web
   */
  async makeDirectoryAsync(dirUri: string, options?: FileSystem.MakeDirectoryOptions): Promise<void> {
    if (Platform.OS === 'web') {
      return;
    }
    
    try {
      await FileSystem.makeDirectoryAsync(dirUri, options);
    } catch (error) {
      logger.warn(`Error creating directory ${dirUri}:`, error);
    }
  },
  
  /**
   * Safely read directory, returns empty array on web or if operation fails
   */
  async readDirectoryAsync(dirUri: string): Promise<string[]> {
    if (Platform.OS === 'web') {
      return [];
    }
    
    try {
      return await FileSystem.readDirectoryAsync(dirUri);
    } catch (error) {
      logger.warn(`Error reading directory ${dirUri}:`, error);
      return [];
    }
  },
  
  /**
   * Safely delete file or directory, no-op on web
   */
  async deleteAsync(fileUri: string, options?: FileSystem.DeleteOptions): Promise<void> {
    if (Platform.OS === 'web') {
      return;
    }
    
    try {
      await FileSystem.deleteAsync(fileUri, options);
    } catch (error) {
      logger.warn(`Error deleting ${fileUri}:`, error);
    }
  },
  
  /**
   * Return platform appropriate cache directory with fallback for web
   */
  getCacheDirectory(): string {
    return Platform.OS === 'web' 
      ? 'web-cache:/' 
      : FileSystem.cacheDirectory || '';
  },
  
  /**
   * Return platform appropriate document directory with fallback for web
   */
  getDocumentDirectory(): string {
    return Platform.OS === 'web'
      ? 'web-documents:/'
      : FileSystem.documentDirectory || '';
  }
};

/**
 * Safe platform detection
 */
export const PlatformUtils = {
  /**
   * Check if current platform is web
   */
  isWeb(): boolean {
    return Platform.OS === 'web';
  },
  
  /**
   * Check if current platform is iOS
   */
  isIOS(): boolean {
    return Platform.OS === 'ios';
  },
  
  /**
   * Check if current platform is Android
   */
  isAndroid(): boolean {
    return Platform.OS === 'android';
  },
  
  /**
   * Check if current platform is native (iOS or Android)
   */
  isNative(): boolean {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  }
};

/**
 * Safe wrapper for operations that might not be available on web
 */
export async function safelyExecute<T>(
  operation: () => Promise<T>,
  fallbackValue: T,
  operationName: string = 'Operation'
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logger.warn(`${operationName} failed:`, error);
    return fallbackValue;
  }
}
