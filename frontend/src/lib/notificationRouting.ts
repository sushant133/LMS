/**
 * Where a tapped system notification should land the user.
 *
 * The push listener can fire before — or long before — the router is ready (Capacitor
 * retains "pushNotificationActionPerformed" until something consumes it, so a cold
 * start delivers the tap as soon as the first listener attaches). Queuing the path
 * here lets NativeAppBridge hand over a real `navigate` the moment it mounts.
 *
 * This replaces the previous `window.location.assign(path)`: with `server.url`
 * pointing at the remote site, that was a full page load — index.html, the bundle and
 * the route chunk all re-fetched over mobile data — which showed as a blank white
 * screen for as long as the network took. An in-app navigation keeps the shell (and
 * its loading state) on screen.
 */

type NotificationNavigator = (path: string) => void;

let activeNavigator: NotificationNavigator | null = null;
let pendingPath: string | null = null;

/**
 * Install the router-backed navigator. Any tap that arrived while the app was still
 * booting is delivered immediately. Returns the uninstall function.
 */
export const setNotificationNavigator = (navigator: NotificationNavigator): (() => void) => {
  activeNavigator = navigator;

  if (pendingPath) {
    const path = pendingPath;
    pendingPath = null;
    navigator(path);
  }

  return () => {
    if (activeNavigator === navigator) {
      activeNavigator = null;
    }
  };
};

/** Open a notification target in-app, or hold it until the router is mounted. */
export const openNotificationPath = (path: string): void => {
  if (activeNavigator) {
    activeNavigator(path);
    return;
  }
  pendingPath = path;
};
