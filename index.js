import 'react-native-get-random-values';
import { registerRootComponent } from 'expo';
import { ExpoRoot } from 'expo-router';
import { Platform } from 'react-native';

// Load environment variables from .env.local file, but only in non-web environments
if (Platform.OS !== 'web') {
  // Dynamically import dotenv to avoid web compatibility issues
  const dotenv = require('dotenv');
  dotenv.config({ path: '.env.local' });
}

// https://docs.expo.dev/router/reference/troubleshooting/#expo_router_app_root-not-defined

// Must be exported or Fast Refresh won't update the context
export function App() {
  const ctx = require.context('./app');
  return <ExpoRoot context={ctx} />;
}

registerRootComponent(App);
