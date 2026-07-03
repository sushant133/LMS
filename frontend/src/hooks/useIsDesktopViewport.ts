import { useSyncExternalStore } from "react";

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

const subscribe = (onStoreChange: () => void) => {
  const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
};

const getDesktopSnapshot = () => window.matchMedia(DESKTOP_MEDIA_QUERY).matches;

export const useIsDesktopViewport = (): boolean =>
  useSyncExternalStore(subscribe, getDesktopSnapshot, () => true);