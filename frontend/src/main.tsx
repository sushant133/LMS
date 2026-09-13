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
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./i18n";
import "./index.css";
import { ErrorBoundary } from "components/shared/ErrorBoundary";
import { AuthProvider } from "features/auth/AuthProvider";
import { queryClient } from "lib/queryClient";
import { installStaleChunkRecovery } from "lib/staleChunkRecovery";

installStaleChunkRecovery();

if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

/**
 * Dismiss the static #app-boot-loader from index.html once React has actually
 * painted something (its own splash, a route loader or the page itself). Tied to
 * the first #root child rather than to render() so a slow lazy chunk still shows
 * the logo instead of a blank white screen — which is what a notification tap used
 * to open into.
 */
const dismissBootLoader = (): void => {
  const loader = document.getElementById("app-boot-loader");
  if (!loader) return;
  document.documentElement.classList.add("app-booted");
  window.setTimeout(() => loader.remove(), 300);
};

const waitForFirstPaint = (): void => {
  const startedAt = Date.now();
  const root = document.getElementById("root");

  // rAF is paused while the WebView is hidden; the timer is the backstop.
  window.setTimeout(dismissBootLoader, 15_000);

  const tick = () => {
    // Give up after 15s: whatever went wrong, the loader must not trap the screen.
    if (!root || root.childElementCount > 0 || Date.now() - startedAt > 15_000) {
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
