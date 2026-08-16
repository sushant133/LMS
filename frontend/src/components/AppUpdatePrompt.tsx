import { useEffect, useState } from "react";
import { Button } from "components/ui/button";
import {
  openAndroidUpdatePage,
  shouldPromptAndroidUpdate,
  type AndroidAppVersionInfo,
} from "lib/appUpdate";

/**
 * Native Android only. Shows once per launch while the installed APK
 * is behind the published versionCode in /android-app-version.json.
 * After the user updates, versionCodes match and this stays hidden.
 */
export const AppUpdatePrompt = () => {
  const [update, setUpdate] = useState<AndroidAppVersionInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void shouldPromptAndroidUpdate().then((info) => {
      if (!cancelled) setUpdate(info);
    });
    return () => {
      cancelled = true;
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
          Update available
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          A new version of the app is available
          {update.versionName ? ` (${update.versionName})` : ""}. Update now to keep
          using the latest features and fixes.
        </p>
        <Button
          type="button"
          className="mt-5 w-full"
          size="lg"
          onClick={() => openAndroidUpdatePage(update.storeUrl)}
        >
          Update Now
        </Button>
      </div>
    </div>
  );
};
