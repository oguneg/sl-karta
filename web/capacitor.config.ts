import type { CapacitorConfig } from '@capacitor/cli';

// Native wrapper config. Change appId to your own reverse-domain id before the first store upload;
// it cannot be changed after publishing.
const config: CapacitorConfig = {
  appId: 'se.example.slkarta',
  appName: 'SL Karta',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
