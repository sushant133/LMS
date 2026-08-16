import { Capacitor } from "@capacitor/core";

const ANDROID_PACKAGE = "np.com.phit.lms2";
const VERSION_MANIFEST_URL = "/android-app-version.json";

export interface AndroidAppVersionInfo {
  versionCode: number;
  versionName: string;
  storeUrl: string;
}

declare global {
  interface Window {
    PhitNativeApp?: {
      getVersionCode: () => string;
      getVersionName: () => string;
      getPackageName: () => string;
    };
  }
}

const isNativeAndroid = (): boolean => {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
};

const readInstalledVersionCode = (): number => {
  try {
    const raw = window.PhitNativeApp?.getVersionCode?.();
    const code = Number.parseInt(String(raw ?? ""), 10);
    return Number.isFinite(code) ? code : 0;
  } catch {
    return 0;
  }
};

export const fetchLatestAndroidVersion = async (): Promise<AndroidAppVersionInfo | null> => {
  try {
    const response = await fetch(VERSION_MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<AndroidAppVersionInfo>;
    const versionCode = Number(data.versionCode);
    if (!Number.isFinite(versionCode) || versionCode < 1) return null;
    return {
      versionCode,
      versionName: typeof data.versionName === "string" ? data.versionName : String(versionCode),
      storeUrl:
        typeof data.storeUrl === "string" && data.storeUrl.startsWith("http")
          ? data.storeUrl
          : `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`,
    };
  } catch {
    return null;
  }
};

/** True when this native Android install is older than the published version. */
export const shouldPromptAndroidUpdate = async (): Promise<AndroidAppVersionInfo | null> => {
  if (!isNativeAndroid()) return null;
  const installed = readInstalledVersionCode();
  if (installed < 1) return null;
  const latest = await fetchLatestAndroidVersion();
  if (!latest || installed >= latest.versionCode) return null;
  return latest;
};

export const openAndroidUpdatePage = (storeUrl?: string): void => {
  const webUrl = storeUrl || `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
  const marketUrl = `market://details?id=${ANDROID_PACKAGE}`;
  try {
    window.location.assign(marketUrl);
    window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        window.open(webUrl, "_blank", "noopener,noreferrer");
      }
    }, 700);
  } catch {
    window.open(webUrl, "_blank", "noopener,noreferrer");
  }
};
