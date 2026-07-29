import { useEffect } from "react";
import {
  normalizeUserRole,
  type ModuleAccessMap,
  type UserRole,
} from "@phit-erp/shared";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { PageLoadingState } from "components/shared/LoadingState";
import { useOnlineStatus } from "hooks/useOnlineStatus";
import { getRoleRedirectPath } from "lib/auth";
import { redirectToLogin } from "lib/redirectToLogin";
import { hasProtectedRouteAccess } from "lib/roles";
import { useAuth } from "./AuthProvider";

interface ProtectedRouteProps {
  roles?: UserRole[];
  /**
   * When true, staff with admin-granted personalFinanceAccess may open the route
   * even if their role is not in the allowed list (or is listed but only for grant).
   */
  allowPersonalFinanceAccess?: boolean;
}

export const ProtectedRoute = ({
  roles,
  allowPersonalFinanceAccess = false,
}: ProtectedRouteProps) => {
  const { user, loading, loggingOut } = useAuth();
  const location = useLocation();
  const online = useOnlineStatus();

  // Only hard-redirect when we know there is no session (not while bootstrapping or logging out).
  const shouldRedirectToLogin = online && !loading && !loggingOut && !user;

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

  // Offline: never render the app shell — only the login page is allowed.
  if (!online) {
    return <Navigate to="/login" replace />;
  }

  if (loading || loggingOut) {
    return <PageLoadingState />;
  }

  if (!user) {
    // Effect will send the user to /login; keep layout blank to avoid flash.
    return <PageLoadingState />;
  }

  const normalizedRole = normalizeUserRole(user.role);
  const hasPersonalFinance =
    allowPersonalFinanceAccess && Boolean(user.personalFinanceAccess);

  if (
    roles &&
    !hasPersonalFinance &&
    !hasProtectedRouteAccess(normalizedRole, roles, user.secondaryRoles, {
      pathname: location.pathname,
      moduleAccess: (user.moduleAccess ?? {}) as ModuleAccessMap,
      moduleAccessConfigured: Boolean(user.moduleAccessConfigured),
    })
  ) {
    const fallback = getRoleRedirectPath(user.role);
    if (!fallback || fallback === location.pathname) {
      return <PageLoadingState />;
    }
    return <Navigate to={fallback} replace />;
  }

  // Staff without grant must not open finance even if role is listed for the route
  if (
    allowPersonalFinanceAccess &&
    location.pathname.startsWith("/finance") &&
    !["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER"].includes(normalizedRole) &&
    !user.personalFinanceAccess
  ) {
    const fallback = getRoleRedirectPath(user.role);
    if (!fallback || fallback === location.pathname) {
      return <PageLoadingState />;
    }
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
};
