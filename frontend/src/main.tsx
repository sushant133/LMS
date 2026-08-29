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
