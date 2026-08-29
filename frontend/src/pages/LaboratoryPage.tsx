import { Navigate } from "react-router-dom";
import { LoadingState } from "components/shared/LoadingState";
import { LaboratoryManager } from "features/laboratory/LaboratoryManager";
import { useAuth } from "features/auth/AuthProvider";
import { useTeacherLabAccess } from "hooks/useTeacherLabAccess";
import { getRoleRedirectPath } from "lib/auth";
import { normalizeUserRole } from "@phit-erp/shared";
import { useCanManageGrantedModule } from "hooks/useModuleAccess";
import { isDualRoleTeacher, useWorkspaceMode } from "lib/workspace";

/**
 * Admins / lab staff always enter the module.
 * Teachers only if admin assigned ACTIVE lab row(s) (or legacy in-charge).
 */
export const LaboratoryPage = () => {
  const { user } = useAuth();
  const workspace = useWorkspaceMode();
  const role = user ? normalizeUserRole(user.role) : null;
  const staffGranted = useCanManageGrantedModule("laboratory");
  const isTeacher = role === "TEACHER" && workspace !== "admin";
  const labAccessQuery = useTeacherLabAccess(isTeacher);

  if (
    workspace === "admin" &&
    role === "TEACHER" &&
    !isDualRoleTeacher(user) &&
    !staffGranted
  ) {
    return (
      <Navigate
        to="/laboratory"
        replace
      />
    );
  }

  if (isTeacher) {
    if (labAccessQuery.isLoading) {
      return <LoadingState />;
    }
    if (!labAccessQuery.data?.hasLaboratoryAccess) {
      return (
        <Navigate
          to={getRoleRedirectPath("TEACHER") ?? "/dashboard/teacher"}
          replace
        />
      );
    }
  }

  return <LaboratoryManager />;
};
