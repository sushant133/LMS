import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";

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

/** Light = dark icons (white header). Dark = light icons (login hero). */
export const setNativeSystemBarStyle = (style: "light" | "dark"): void => {
  if (!isNativeApp()) return;
  void SystemBars.setStyle({
    style: style === "light" ? SystemBarsStyle.Light : SystemBarsStyle.Dark,
  }).catch(() => {
    // Plugin may be unavailable on older WebViews
  });
};
