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
      /**
       * Upper bound, not a fixed duration — main.tsx calls SplashScreen.hide() the
       * moment the web app has painted, so a normal open is *shorter* than before.
       *
       * The old fixed 3000 was the blank screen after a notification tap: the WebView
       * loads the remote site (server.url), and on a cold radio the HTML had not
       * arrived yet when the splash expired, so it handed over to an empty white
       * WebView. autoHide stays on so a dead network can never freeze on the logo.
       */
      launchShowDuration: 10000,
      launchAutoHide: true,
      launchFadeOutDuration: 300,
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