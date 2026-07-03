import { jsx as _jsx } from "react/jsx-runtime";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { PageLoadingState } from "components/shared/LoadingState";
import { roleRedirectMap } from "lib/auth";
import { useAuth } from "./AuthProvider";
export const ProtectedRoute = ({ roles }) => {
    const { user, loading } = useAuth();
    const location = useLocation();
    if (!user) {
        if (loading) {
            return _jsx(PageLoadingState, {});
        }
        return _jsx(Navigate, { to: "/login", replace: true, state: { from: location.pathname } });
    }
    if (roles && !roles.includes(user.role)) {
        return _jsx(Navigate, { to: roleRedirectMap[user.role], replace: true });
    }
    return _jsx(Outlet, {});
};
