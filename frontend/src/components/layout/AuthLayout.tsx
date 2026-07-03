import { useLayoutEffect } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "features/auth/AuthProvider";
import { resetAppShell } from "lib/resetAppShell";

export const AuthLayout = () => {
  const { authEpoch } = useAuth();

  useLayoutEffect(() => {
    resetAppShell();
  }, [authEpoch]);

  return (
    <div className="min-h-screen w-full">
      <Outlet />
    </div>
  );
};