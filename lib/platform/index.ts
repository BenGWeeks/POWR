// lib/platform/index.ts - Platform abstraction layer
import { Platform } from 'react-native';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Platform');

// Define platform types
type PlatformType = 'web' | 'ios' | 'android' | 'unknown';

/**
 * Get current platform type
 */
export function getPlatform(): PlatformType {
  if (Platform.OS === 'web') return 'web';
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'unknown';
}

/**
 * Platform capability detection
 */
export function hasCapability(capability: 'fileSystem' | 'sqlite' | 'share' | 'camera' | 'biometrics'): boolean {
  const platform = getPlatform();
  
  switch (capability) {
    case 'fileSystem':
      return platform !== 'web';
    case 'sqlite':
      return true; // We handle SQLite compatibility in our adapter
    case 'share':
      return platform !== 'web';
    case 'camera':
      return platform !== 'web';
    case 'biometrics':
      return platform !== 'web';
    default:
      return false;
  }
}

/**
 * Run platform-specific code
 * This helper makes platform-specific code easier to read and maintain
 */
export function runPerPlatform<T>({
  web,
  ios,
  android,
  fallback
}: {
  web?: () => T;
  ios?: () => T;
  android?: () => T;
  fallback: () => T;
}): T {
  const platform = getPlatform();
  
  if (platform === 'web' && web) {
    return web();
  } else if (platform === 'ios' && ios) {
    return ios();
  } else if (platform === 'android' && android) {
    return android();
  }
  
  return fallback();
}

/**
 * Safe wrapper for operations that might fail on certain platforms
 */
export async function safelyRun<T>(
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

/**
 * Get platform-specific configuration value
 */
export function getPlatformConfig<T>(
  key: string,
  webValue: T,
  iosValue: T,
  androidValue: T
): T {
  return runPerPlatform({
    web: () => webValue,
    ios: () => iosValue,
    android: () => androidValue,
    fallback: () => webValue, // Default to web value
  });
}

/**
 * Platform-specific constants
 */
export const PlatformConstants = {
  isWeb: getPlatform() === 'web',
  isIOS: getPlatform() === 'ios',
  isAndroid: getPlatform() === 'android',
  isNative: getPlatform() === 'ios' || getPlatform() === 'android',
  scrollBarWidth: getPlatformConfig('scrollBarWidth', 15, 0, 0),
  maxImageCacheSize: getPlatformConfig('maxImageCacheSize', 20 * 1024 * 1024, 150 * 1024 * 1024, 100 * 1024 * 1024),
  defaultAnimationDuration: getPlatformConfig('defaultAnimationDuration', 300, 400, 350),
};
