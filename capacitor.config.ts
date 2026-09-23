import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.patrickspdf.app',
  appName: 'PatricksPDF',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
