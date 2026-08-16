import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'np.com.phit.lms2',
  appName: 'PHIT COLLEGE',
  webDir: 'dist',
  server: {
    url: 'https://lms.phit.com.np',
    cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: true,
      backgroundColor: "#ffffff",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_INSIDE",
      layoutName: "launch_splash",
      useDialog: true,
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    SystemBars: {
      insetsHandling: "css",
      style: "LIGHT"
    }
  },
  android: {
    allowMixedContent: true
  }
};

export default config;