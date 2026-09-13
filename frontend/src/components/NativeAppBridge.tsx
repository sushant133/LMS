import { useEffect, useRef } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "features/auth/AuthProvider";
import { getRoleRedirectPath } from "lib/auth";
import { runBackHandlers } from "lib/nativeBackButton";
import { setNotificationNavigator } from "lib/notificationRouting";
import { isNativeApp } from "lib/platform";
import { attachPushNavigationListener } from "lib/pushNotifications";

/** Second back press inside this window leaves the app. */
const EXIT_CONFIRM_WINDOW_MS = 2000;

/**
 * Native shell glue, mounted once inside the router.
 *
 * 1. Android back button: close an overlay, else step back through in-app history,
 *    else return to the role home, else exit on a confirmed second press.
 * 2. System notification taps: navigate inside the running app instead of reloading
 *    the whole site (which showed a blank white screen while it downloaded).
 *
 * Renders nothing and does nothing at all in a browser.
 */
export const NativeAppBridge = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { user } = useAuth();

  /**
   * How many pages deep the user is *inside this app run*. WebView history is not a
   * usable substitute: it also holds the pre-login redirects, so `canGoBack` stays
   * true at the home screen and back never reaches an exit.
   */
  const depthRef = useRef(0);
  const lastBackPressRef = useRef(0);
  const homePathRef = useRef<string>("/login");
  const pathnameRef = useRef(location.pathname);

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    homePathRef.current = getRoleRedirectPath(user?.role) ?? "/login";
  }, [user?.role]);

  useEffect(() => {
    if (navigationType === "PUSH") {
      depthRef.current += 1;
    } else if (navigationType === "POP") {
      depthRef.current = Math.max(0, depthRef.current - 1);
    }
    // REPLACE swaps the current entry — the depth is unchanged.
  }, [location.key, navigationType]);

  // —— Notification taps ——
  useEffect(() => {
    if (!isNativeApp()) return;

    // The navigator goes in first so a retained tap from a cold start is consumed
    // by the listener below the moment it fires.
    const releaseNavigator = setNotificationNavigator((path) => {
      if (pathnameRef.current === path) return;
      // replace(): the notification is an entry point, not a page worth going "back" to.
      navigate(path, { replace: true });
    });

    // Attach early — waiting for login meant the tap was handled only after the
    // session resolved, long after the user was staring at the screen.
    attachPushNavigationListener();

    return releaseNavigator;
  }, [navigate]);

  // —— Hardware / gesture back ——
  useEffect(() => {
    if (!isNativeApp()) return;

    let handle: PluginListenerHandle | null = null;
    let cancelled = false;

    const handleBack = () => {
      // 1. An open drawer / modal gets the press first.
      if (runBackHandlers()) return;

      // 2. Step back through pages opened in this app run.
      if (depthRef.current > 0) {
        navigate(-1);
        return;
      }

      // 3. Deep entry point (notification tap, redirect): go to the role home first.
      const home = homePathRef.current;
      if (home && pathnameRef.current !== home) {
        navigate(home, { replace: true });
        return;
      }

      // 4. At home: confirm, then leave the app.
      const now = Date.now();
      if (now - lastBackPressRef.current < EXIT_CONFIRM_WINDOW_MS) {
        void CapacitorApp.exitApp().catch(() => {
          // Plugin unavailable — nothing sensible left to do
        });
        return;
      }
      lastBackPressRef.current = now;
      toast("Press back again to exit");
    };

    void CapacitorApp.addListener("backButton", handleBack)
      .then((registered) => {
        if (cancelled) {
          void registered.remove();
          return;
        }
        handle = registered;
      })
      .catch(() => {
        // Older shells without @capacitor/app keep Capacitor's default behaviour
      });

    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [navigate]);

  return null;
};

export default NativeAppBridge;
