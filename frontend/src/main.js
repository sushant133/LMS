import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./i18n";
import "./index.css";
import { AuthProvider } from "features/auth/AuthProvider";
import { queryClient } from "lib/queryClient";
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(QueryClientProvider, { client: queryClient, children: _jsx(AuthProvider, { children: _jsxs(BrowserRouter, { future: {
                    v7_startTransition: true,
                    v7_relativeSplatPath: true
                }, children: [_jsx(App, {}), _jsx(Toaster, { richColors: true, position: "top-right" })] }) }) }) }));
