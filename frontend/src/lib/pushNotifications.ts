import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { api } from "lib/api";

const STORAGE_KEY = "phit_fcm_device_token";
const ANDROID_CHANNEL_ID = "lms_default";

let listenersAttached = false;
let initInFlight: Promise<void> | null = null;

const persistLocalToken = (token: string | null): void => {
  try {
    if (token) {
      window.localStorage.setItem(STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable
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
    platform: "android",
  });
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

  void PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const rawPath = action.notification?.data?.path;
    const path =
      typeof rawPath === "string" && rawPath.startsWith("/") && !rawPath.startsWith("//")
        ? rawPath
        : "/notifications";
    if (typeof window !== "undefined" && window.location.pathname !== path) {
      window.location.assign(path);
    }
  });
};

/**
 * Native-only: request notification permission, get the FCM token, and
 * POST it to /api/notifications/device-token. No-op in the browser.
 */
export const initPushNotifications = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  if (initInFlight) return initInFlight;

  initInFlight = (async () => {
    attachListenersOnce();

    if (Capacitor.getPlatform() === "android") {
      try {
        await PushNotifications.createChannel({
          id: ANDROID_CHANNEL_ID,
          name: "PHIT LMS Alerts",
          description: "Personal notifications for your PHIT COLLEGE account",
          importance: 5,
          visibility: 1,
          sound: "default",
          vibration: true,
        });
      } catch {
        // Channel may already exist
      }
    }

    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") return;

    await PushNotifications.register();

    const existing = readLocalToken();
    if (existing) {
      try {
        await postDeviceToken(existing);
      } catch (error) {
        console.error("[push] Failed to re-bind stored token", error);
      }
    }
  })().finally(() => {
    initInFlight = null;
  });

  return initInFlight;
};

/** Unbind this device from the current user. Safe no-op on web. */
export const unregisterPushNotifications = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;

  const token = readLocalToken();
  if (!token) return;

  try {
    await api.delete("/notifications/device-token", {
      data: { token, platform: "android" },
    });
  } catch {
    // Best-effort — logout must still proceed
  }
};
