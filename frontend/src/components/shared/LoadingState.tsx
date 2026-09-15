import { useEffect } from "react";
import { CollegeLogo } from "components/shared/CollegeLogo";

/**
 * Full-page loaders flag themselves on <html> so the startup logo screen in
 * index.html knows the app has not reached real content yet and keeps the logo up
 * instead of handing over to another loading screen. Counted, not a boolean: two
 * of these can overlap (ProtectedRoute bootstrapping under a suspended route) and
 * the first unmount must not clear the flag while the second is still on screen.
 */
let activeFullPageLoaders = 0;

const syncLoadingFlag = (): void => {
  if (typeof document === "undefined") return;
  if (activeFullPageLoaders > 0) {
    document.documentElement.setAttribute("data-app-loading", "");
  } else {
    document.documentElement.removeAttribute("data-app-loading");
  }
};

export const LoadingState = () => (
  <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
    Loading...
  </div>
);

export const PageLoadingState = () => {
  useEffect(() => {
    activeFullPageLoaders += 1;
    syncLoadingFlag();
    return () => {
      activeFullPageLoaders = Math.max(0, activeFullPageLoaders - 1);
      syncLoadingFlag();
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,_#0f172a_0%,_#061535_45%,_#d6e2f5_100%)] p-6">
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-white/30 bg-white/95 px-8 py-10 text-center text-sm text-slate-600 shadow-2xl">
        <CollegeLogo className="h-12 w-12" />
        Loading...
      </div>
    </div>
  );
};

