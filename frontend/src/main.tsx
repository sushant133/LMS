/**
 * Third-party CSS FIRST, app CSS last.
 * @munatech/nepali-datepicker ships its own Tailwind utilities build that
 * redefines .hidden / .flex but carries no responsive variants. Loaded after
 * index.css (it used to arrive lazily with the date field) its plain .hidden
 * outranked our .md:flex / .md:block, so every `hidden md:*` in the app
 * collapsed to display:none at every width. Importing it up front puts
 * Tailwind last in the cascade again.
 */
import "@munatech/nepali-datepicker/styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { SplashScreen } from "@capacitor/splash-screen";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./i18n";
import "./index.css";
import { ErrorBoundary } from "components/shared/ErrorBoundary";
import { AuthProvider } from "features/auth/AuthProvider";
import { queryClient } from "lib/queryClient";
import { isNativeApp } from "lib/platform";
import { installStaleChunkRecovery } from "lib/staleChunkRecovery";

installStaleChunkRecovery();

if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

/**
 * Startup hand-off: native launch splash → #app-boot-loader (index.html) → the app.
 *
 * All three show the same logo on white, and each one is only dropped once the next
 * is on screen, so opening the app — including from a notification tap, which is the
 * slowest path because the WebView cold-loads the remote site — is a single
 * continuous logo screen with no white gap in the middle.
 */
const BOOT_LOADER_FADE_MS = 300;
/** Nothing may hold the startup screen longer than this, whatever went wrong. */
const BOOT_LOADER_TIMEOUT_MS = 20_000;

let bootLoaderDismissed = false;

const dismissBootLoader = (): void => {
  if (bootLoaderDismissed) return;
  bootLoaderDismissed = true;

  const loader = document.getElementById("app-boot-loader");
  if (loader) {
    document.documentElement.classList.add("app-booted");
    window.setTimeout(() => loader.remove(), BOOT_LOADER_FADE_MS);
  }

  // Hidden last: the native splash sits on top, so the web loader is swapped out
  // behind it and the splash then fades straight onto real content.
  if (!isNativeApp()) return;
  void SplashScreen.hide({ fadeOutDuration: BOOT_LOADER_FADE_MS }).catch(() => {
    // Older shells without the plugin still auto-hide on their own
  });
};

/**
 * The app is "up" once #root has painted something that is not itself a full-page
 * loading screen — PageLoadingState flags those on <html>. Swapping our logo for
 * another spinner would be the flicker this hand-off exists to avoid.
 */
const appHasPainted = (root: HTMLElement | null): boolean =>
  Boolean(root) &&
  root!.childElementCount > 0 &&
  !document.documentElement.hasAttribute("data-app-loading");

const waitForFirstPaint = (): void => {
  const startedAt = Date.now();
  const root = document.getElementById("root");

  // rAF is paused while the WebView is hidden; the timer is the backstop.
  window.setTimeout(dismissBootLoader, BOOT_LOADER_TIMEOUT_MS);

  const tick = () => {
    if (!root || appHasPainted(root) || Date.now() - startedAt > BOOT_LOADER_TIMEOUT_MS) {
      dismissBootLoader();
      return;
    }
    window.requestAnimationFrame(tick);
  };

  window.requestAnimationFrame(tick);
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Last line of defence: without it, any uncaught render error empties #root entirely */}
    <ErrorBoundary variant="page">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <App />
            <Toaster richColors position="top-right" offset="calc(12px + var(--app-safe-top, 0px))" />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

waitForFirstPaint();
