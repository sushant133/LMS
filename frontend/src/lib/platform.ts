import { Capacitor } from "@capacitor/core";

/**
 * True when running inside the Capacitor native shell (Android / iOS app),
 * false in any browser. Wrapped in try/catch so web builds never fail if the
 * optional native runtime is unavailable.
 */
export const isNativeApp = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};
