import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { api } from "lib/api";

const STORAGE_KEY = "phit_fcm_device_token";
const ANDROID_CHANNEL_ID = "lms_default";

let listenersAttached = false;
let initInFlight: Promise<void> | null = null;
let lastRegisteredUserId: string | null = null;

const isNativeMobile = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const persistLocalToken = (token: string | null): void => {
  try {
    if (token) {
      window.localStorage.setItem(STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable; ignore
  }
};

const readLocalToken = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const postDeviceToken = async (token: string): Promise<void> => {
  await api.post("/notifications/device-token", {
    token,
    platform: Capacitor.getPlatform() === "ios" ? "ios" : "android",
  });
};

const deleteDeviceToken = async (token: string): Promise<void> => {
  await api.delete("/notifications/device-token", {
    data: {
      token,
      platform: Capacitor.getPlatform() === "ios" ? "ios" : "android",
    },
  });
};

const ensureAndroidChannel = async (): Promise<void> => {
  if (Capacitor.getPlatform() !== "android") return;
  try {
    // Capacitor 8 PushNotifications.createChannel (Android only)
    const push = PushNotifications as typeof PushNotifications & {
      createChannel?: (options: {
        id: string;
        name: string;
        description?: string;
        importance?: number;
        visibility?: number;
        sound?: string;
        vibration?: boolean;
      }) => Promise<void>;
    };
    if (typeof push.createChannel === "function") {
      await push.createChannel({
        id: ANDROID_CHANNEL_ID,
        name: "PHIT LMS Alerts",
        description: "Personal notifications for your PHIT COLLEGE account",
        importance: 5,
        visibility: 1,
        sound: "default",
        vibration: true,
      });
    }
  } catch {
    // Channel may already exist or plugin version may omit the API
  }
};

const navigateFromPushData = (data: Record<string, unknown> | undefined): void => {
  if (typeof window === "undefined") return;
  const rawPath = data?.path;
  const path =
    typeof rawPath === "string" && rawPath.startsWith("/") && !rawPath.startsWith("//")
      ? rawPath
      : "/notifications";
  // Full navigation works inside Capacitor WebView without coupling to router internals
  if (window.location.pathname !== path) {
    window.location.assign(path);
  }
};

const attachListenersOnce = (): void => {
  if (listenersAttached) return;
  listenersAttached = true;

  void PushNotifications.addListener("registration", (event) => {
    const token = event.value?.trim();
    if (!token) return;
    persistLocalToken(token);
    void postDeviceToken(token).catch((error) => {
      console.error("[push] Failed to register device token", error);
    });
  });

  void PushNotifications.addListener("registrationError", (error) => {
    console.error("[push] Registration error", error);
  });

  void PushNotifications.addListener("pushNotificationReceived", (_notification) => {
    // App is in foreground: in-app Notification Center / badge still apply.
    // System may or may not show a heads-up depending on Android settings.
  });

  void PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data = (action.notification?.data ?? {}) as Record<string, unknown>;
    navigateFromPushData(data);
  });
};

/**
 * Request permission, register with FCM, and bind the token to the logged-in user.
 * No-op on web / non-native platforms — does not affect the browser app.
 */
export const initPushNotifications = async (userId: string): Promise<void> => {
  if (!isNativeMobile()) return;
  const uid = String(userId || "").trim();
  if (!uid) return;

  if (initInFlight) {
    await initInFlight;
    // If same user already registered this session, still re-post token after re-login
  }

  initInFlight = (async () => {
    try {
      attachListenersOnce();
      await ensureAndroidChannel();

      const permission = await PushNotifications.requestPermissions();
      if (permission.receive !== "granted") {
        console.info("[push] Permission not granted");
        return;
      }

      await PushNotifications.register();
      lastRegisteredUserId = uid;

      // Re-bind a previously stored token immediately (registration event may not re-fire)
      const existing = readLocalToken();
      if (existing) {
        try {
          await postDeviceToken(existing);
        } catch (error) {
          console.error("[push] Failed to re-bind stored token", error);
        }
      }
    } catch (error) {
      console.error("[push] initPushNotifications failed", error);
    } finally {
      initInFlight = null;
    }
  })();

  await initInFlight;
};

/**
 * Unbind this device from the current user (call before / during logout).
 * Safe no-op on web.
 */
export const unregisterPushNotifications = async (): Promise<void> => {
  if (!isNativeMobile()) return;

  const token = readLocalToken();
  if (!token) {
    lastRegisteredUserId = null;
    return;
  }

  try {
    await deleteDeviceToken(token);
  } catch {
    // Best-effort — session may already be cleared
  } finally {
    // Keep local token so the next login can re-bind the same device quickly
    lastRegisteredUserId = null;
  }
};

/** @internal test helper */
export const __pushDebug = {
  isNativeMobile,
  readLocalToken,
  get lastRegisteredUserId() {
    return lastRegisteredUserId;
  },
};
