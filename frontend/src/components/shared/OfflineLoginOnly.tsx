import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useOnlineStatus } from "hooks/useOnlineStatus";

/**
 * When the device is offline, the app is restricted to the login page only.
 * All other routes redirect to /login. No offline data or app shell is shown.
 */
export const OfflineLoginOnly = ({ children }: PropsWithChildren) => {
  const online = useOnlineStatus();
  const location = useLocation();

  if (!online && location.pathname !== "/login") {
    return <Navigate to="/login" replace state={{ offline: true }} />;
  }

  return <>{children}</>;
};
