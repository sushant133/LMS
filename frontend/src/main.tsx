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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Last line of defence: without it, any uncaught render error empties #root entirely */}
    <ErrorBoundary variant="page">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter
            future={{
              v7_relativeSplatPath: true
            }}
          >
            <App />
            <Toaster richColors position="top-right" />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
