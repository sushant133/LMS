import { useEffect, useRef, useState } from "react";
import { Button } from "components/ui/button";
import {
  DEFAULT_ANDROID_UPDATE_MESSAGE,
  openAndroidUpdatePage,
  shouldPromptAndroidUpdate,
  type AndroidAppVersionInfo,
} from "lib/appUpdate";

/**
 * Native Android only. Shows once per launch while the installed APK
 * is behind the published versionCode in /android-app-version.json.
 * Later dismisses for this session; login and routing keep working.
 */
export const AppUpdatePrompt = () => {
  const [update, setUpdate] = useState<AndroidAppVersionInfo | null>(null);
  const dismissedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = () =>
      shouldPromptAndroidUpdate()
        .then((info) => {
          if (!cancelled && !dismissedRef.current && info) setUpdate(info);
        })
        .catch(() => {
          // Never block the app if the version check fails
        });

    void run();
    // One retry: Capacitor plugin headers can land after the first paint
    // on slower WebViews (remote server.url).
    const retry = window.setTimeout(() => {
      void run();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(retry);
    };
  }, []);

  if (!update) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-5 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-update-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
          PHIT COLLEGE
        </p>
        <h2 id="app-update-title" className="mt-2 text-xl font-semibold text-slate-900">
          Update Available
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {update.message || DEFAULT_ANDROID_UPDATE_MESSAGE}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              dismissedRef.current = true;
              setUpdate(null);
            }}
          >
            Later
          </Button>
          <Button type="button" size="lg" onClick={() => openAndroidUpdatePage(update.storeUrl)}>
            Update
          </Button>
        </div>
      </div>
    </div>
  );
};
