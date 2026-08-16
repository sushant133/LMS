import { useEffect, useLayoutEffect } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "features/auth/AuthProvider";
import { setNativeSystemBarStyle } from "lib/platform";
import { resetAppShell } from "lib/resetAppShell";

export const AuthLayout = () => {
  const { authEpoch } = useAuth();

  useLayoutEffect(() => {
    resetAppShell();
  }, [authEpoch]);

  useEffect(() => {
    setNativeSystemBarStyle("dark");
  }, []);

  return (
    <div className="min-h-screen w-full">
      <Outlet />
    </div>
  );
};