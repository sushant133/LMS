import { useQuery } from "@tanstack/react-query";
import {
  canParentAccessPath,
  isParentPortalModuleEnabled,
  normalizeParentPortalAccess,
  type ParentPortalAccessMap,
  type ParentPortalAccessResponse,
  type ParentPortalModuleKey,
} from "@phit-erp/shared";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";

/**
 * School-level parent portal section access (admin-configured).
 * For non-parents returns all-enabled defaults and does not fetch.
 */
export const useParentPortalAccess = () => {
  const { user } = useAuth();
  const isParent = user?.role === "PARENT";
  const isAdmin =
    user?.role === "SUPER_ADMIN" || user?.role === "COLLEGE_ADMIN";

  const query = useQuery({
    queryKey: ["parent-portal-access"],
    queryFn: () =>
      unwrap<ParentPortalAccessResponse>(api.get("/parent/portal-access")),
    enabled: Boolean(user && (isParent || isAdmin)),
    staleTime: 60_000,
  });

  const modules: ParentPortalAccessMap = normalizeParentPortalAccess(
    query.data?.modules,
  );

  return {
    ...query,
    modules,
    meta: query.data?.meta ?? [],
    isModuleEnabled: (key: ParentPortalModuleKey) =>
      isParentPortalModuleEnabled(modules, key),
    canAccessPath: (pathname: string) => canParentAccessPath(modules, pathname),
  };
};
