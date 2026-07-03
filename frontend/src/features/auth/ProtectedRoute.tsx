import type { UserRole } from "@nepal-school-erp/shared";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { PageLoadingState } from "components/shared/LoadingState";
import { roleRedirectMap } from "lib/auth";
import { useAuth } from "./AuthProvider";

interface ProtectedRouteProps {
  roles?: UserRole[];
}

export const ProtectedRoute = ({ roles }: ProtectedRouteProps) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (!user) {
    if (loading) {
      return <PageLoadingState />;
    }

    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={roleRedirectMap[user.role]} replace />;
  }

  return <Outlet />;
};