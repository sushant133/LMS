import { Navigate } from "react-router-dom";
import { LoadingState } from "components/shared/LoadingState";
import { LaboratoryManager } from "features/laboratory/LaboratoryManager";
import { useAuth } from "features/auth/AuthProvider";
import { useTeacherLabAccess } from "hooks/useTeacherLabAccess";
import { getRoleRedirectPath } from "lib/auth";
import { normalizeUserRole } from "@phit-erp/shared";

/**
 * Admins / lab staff always enter the module.
 * Teachers only if admin assigned ACTIVE lab row(s) (or legacy in-charge).
 */
export const LaboratoryPage = () => {
  const { user } = useAuth();
  const role = user ? normalizeUserRole(user.role) : null;
  const isTeacher = role === "TEACHER";
  const labAccessQuery = useTeacherLabAccess(isTeacher);

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
