import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

const ANDROID_PACKAGE = "np.com.phit.lms2";
const VERSION_MANIFEST_PATH = "/android-app-version.json";
const FETCH_TIMEOUT_MS = 8000;
const DEFAULT_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
/**
 * Last Play Store build that shipped without @capacitor/app.
 * Used only when the native versionCode cannot be read, so existing
 * installs still see the popup after the server versionCode is raised.
 */
const LEGACY_ANDROID_VERSION_CODE = 17;

export const DEFAULT_ANDROID_UPDATE_MESSAGE =
  "A new version of the app is available. Please update to continue using the latest features and fixes.";

export interface AndroidAppVersionInfo {
  versionCode: number;
  versionName: string;
  storeUrl: string;
  message: string;
}

declare global {
  interface Window {
    androidBridge?: unknown;
    PhitNativeApp?: {
      getVersionCode: () => string;
      getVersionName: () => string;
      getPackageName: () => string;
    };
  }
}

const parseVersionCode = (raw: unknown): number => {
  const code = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(code) && code > 0 ? code : 0;
};

const isNativeAndroid = (): boolean => {
  try {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      return true;
    }
  } catch {
    // Bundled Capacitor may be unavailable in a plain browser
  }
  try {
    if (typeof window.androidBridge !== "undefined") return true;
    if (typeof window.PhitNativeApp?.getVersionCode === "function") return true;
  } catch {
    // ignore
  }
  return false;
};

const readInstalledVersionCode = async (): Promise<number> => {
  try {
    const info = await App.getInfo();
    const fromPlugin = parseVersionCode(info.build);
    if (fromPlugin > 0) return fromPlugin;
  } catch {
    // Plugin is not in older APKs — fall through
  }
  try {
    return parseVersionCode(window.PhitNativeApp?.getVersionCode?.());
  } catch {
    return 0;
  }
};

const versionManifestUrl = (): string => {
  const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
  return `${origin}${VERSION_MANIFEST_PATH}?t=${Date.now()}`;
};

export const fetchLatestAndroidVersion = async (): Promise<AndroidAppVersionInfo | null> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(versionManifestUrl(), {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<AndroidAppVersionInfo> & { message?: unknown };
    const versionCode = parseVersionCode(data.versionCode);
    if (versionCode < 1) return null;
    const message = typeof data.message === "string" ? data.message.trim() : "";
    return {
      versionCode,
      versionName: typeof data.versionName === "string" ? data.versionName : String(versionCode),
      storeUrl:
        typeof data.storeUrl === "string" && data.storeUrl.startsWith("http")
          ? data.storeUrl
          : DEFAULT_STORE_URL,
      message: message || DEFAULT_ANDROID_UPDATE_MESSAGE,
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
};

/** True when this native Android install is older than the published version. */
export const shouldPromptAndroidUpdate = async (): Promise<AndroidAppVersionInfo | null> => {
  if (!isNativeAndroid()) return null;
  const latest = await fetchLatestAndroidVersion();
  if (!latest) return null;
  let installed = await readInstalledVersionCode();
  if (installed < 1) {
    installed = LEGACY_ANDROID_VERSION_CODE;
  }
  if (installed >= latest.versionCode) return null;
  return latest;
};

export const openAndroidUpdatePage = (storeUrl?: string): void => {
  const webUrl = storeUrl && storeUrl.startsWith("http") ? storeUrl : DEFAULT_STORE_URL;
  try {
    const opened = window.open(webUrl, "_blank", "noopener,noreferrer");
    if (opened) return;
    const anchor = document.createElement("a");
    anchor.href = webUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch {
    window.open(webUrl, "_blank");
  }
};
