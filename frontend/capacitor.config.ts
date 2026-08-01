import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'np.com.phit.lms2',
  appName: 'PHIT COLLEGE',
  webDir: 'dist',
  server: {
    url: 'https://lms.phit.com.np',
    cleartext: true
  },
  android: {
    allowMixedContent: true
  }
};

export default config;