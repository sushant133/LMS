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

  // Only hard-redirect when we know there is no session (not while bootstrapping or logging out).
  const shouldRedirectToLogin = !loading && !loggingOut && !user;

  useEffect(() => {
    if (!shouldRedirectToLogin || location.pathname === "/login") {
      return;
    }

    // Small delay avoids fighting an in-flight login that just set the session.
    const timer = window.setTimeout(() => {
      redirectToLogin();
    }, 50);

    return () => window.clearTimeout(timer);
  }, [location.pathname, shouldRedirectToLogin]);

  if (loading || loggingOut) {
    return <PageLoadingState />;
  }

  if (!user) {
    // Effect will send the user to /login; keep layout blank to avoid flash.
    return <PageLoadingState />;
  }

  const normalizedRole = normalizeUserRole(user.role);

  if (
    roles &&
    !hasProtectedRouteAccess(normalizedRole, roles, user.secondaryRoles)
  ) {
    const fallback = getRoleRedirectPath(user.role);
    if (!fallback || fallback === location.pathname) {
      return <PageLoadingState />;
    }
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
};
