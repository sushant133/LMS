import { useSyncExternalStore } from "react";

const subscribe = (onStoreChange: () => void): (() => void) => {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
};

const getSnapshot = (): boolean => navigator.onLine !== false;

/** Server / SSR snapshot — assume online so SSR and first paint do not flash offline. */
const getServerSnapshot = (): boolean => true;

/** True when the browser reports an active network connection. */
export const useOnlineStatus = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
