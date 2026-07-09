import { useEffect } from "react";
import { normalizeUserRole, type UserRole } from "@phit-erp/shared";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { PageLoadingState } from "components/shared/LoadingState";
import { getRoleRedirectPath } from "lib/auth";
import { redirectToLogin } from "lib/redirectToLogin";
import { hasProtectedRouteAccess } from "lib/roles";
import { useAuth } from "./AuthProvider";

interface ProtectedRouteProps {
  roles?: UserRole[];
}

export const ProtectedRoute = ({ roles }: ProtectedRouteProps) => {
  const { user, loading, loggingOut } = useAuth();
  const location = useLocation();

  const shouldRedirectToLogin = !loading && !loggingOut && !user;

  useEffect(() => {
    if (!shouldRedirectToLogin || location.pathname === "/login") {
      return;
    }

    redirectToLogin();
  }, [location.pathname, shouldRedirectToLogin]);

  if (!user) {
    return loading || loggingOut ? <PageLoadingState /> : null;
  }

  const normalizedRole = normalizeUserRole(user.role);

  if (roles && !hasProtectedRouteAccess(normalizedRole, roles)) {
    const fallback = getRoleRedirectPath(user.role);
    if (!fallback || fallback === location.pathname) {
      return <PageLoadingState />;
    }
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
};
