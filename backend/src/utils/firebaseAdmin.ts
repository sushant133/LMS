import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { env, getBackendRoot } from "../config/env.js";

type Messaging = {
  sendEachForMulticast: (message: {
    tokens: string[];
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
    android?: Record<string, unknown>;
  }) => Promise<{
    responses: Array<{ success: boolean; error?: { code?: string } }>;
  }>;
};

let messagingInstance: Messaging | null | undefined;
let initAttempted = false;
let initLogged = false;

const logOnce = (message: string, level: "info" | "warn" | "error" = "info"): void => {
  if (initLogged) return;
  initLogged = true;
  if (level === "error") console.error(message);
  else if (level === "warn") console.warn(message);
  else console.info(message);
};

const loadServiceAccount = (): {
  projectId?: string;
  clientEmail: string;
  privateKey: string;
} | null => {
  const parseObject = (parsed: Record<string, unknown>, source: string) => {
    const clientEmail = parsed.client_email;
    const privateKey = parsed.private_key;
    const projectId = parsed.project_id;
    if (typeof clientEmail !== "string" || typeof privateKey !== "string") {
      logOnce(`[FCM] ${source} is missing private_key or client_email`, "warn");
      return null;
    }
    return {
      projectId: typeof projectId === "string" ? projectId : undefined,
      clientEmail,
      privateKey
    };
  };

  const jsonRaw = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw) as Record<string, unknown>;
      return parseObject(parsed, "FIREBASE_SERVICE_ACCOUNT_JSON");
    } catch {
      logOnce("[FCM] FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON", "warn");
      return null;
    }
  }

  const configuredPath = env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (!configuredPath) {
    return null;
  }

  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(getBackendRoot(), configuredPath);

  if (!existsSync(absolutePath)) {
    logOnce(`[FCM] Service account file not found: ${absolutePath}`, "warn");
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as Record<string, unknown>;
    return parseObject(parsed, absolutePath);
  } catch (error) {
    logOnce(
      `[FCM] Failed to read service account file: ${error instanceof Error ? error.message : String(error)}`,
      "error"
    );
    return null;
  }
};

/**
 * Lazy Firebase Admin init. Returns null when credentials are not configured
 * so in-app notifications keep working without FCM.
 */
export const getFirebaseMessaging = async (): Promise<Messaging | null> => {
  if (messagingInstance !== undefined) {
    return messagingInstance;
  }
  if (initAttempted) {
    return messagingInstance ?? null;
  }
  initAttempted = true;

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    messagingInstance = null;
    logOnce(
      "[FCM] Push disabled — set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON to enable mobile system notifications",
      "info"
    );
    return null;
  }

  try {
    const { cert, getApps, initializeApp } = await import("firebase-admin/app");
    const { getMessaging } = await import("firebase-admin/messaging");

    const app =
      getApps().length > 0
        ? getApps()[0]!
        : initializeApp({
            credential: cert({
              projectId: serviceAccount.projectId,
              clientEmail: serviceAccount.clientEmail,
              privateKey: serviceAccount.privateKey
            })
          });

    messagingInstance = getMessaging(app) as unknown as Messaging;
    logOnce("[FCM] Firebase Admin initialized — mobile push enabled");
    return messagingInstance;
  } catch (error) {
    messagingInstance = null;
    logOnce(
      `[FCM] Firebase Admin init failed: ${error instanceof Error ? error.message : String(error)}`,
      "error"
    );
    return null;
  }
};

/** True when FCM credentials are configured and messaging is available. */
export const isFcmConfigured = async (): Promise<boolean> => Boolean(await getFirebaseMessaging());
