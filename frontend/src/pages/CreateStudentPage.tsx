import { Navigate } from "react-router-dom";
import { CreateStudentManager } from "features/students/CreateStudentManager";
import { useAuth } from "features/auth/AuthProvider";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";
import { isDualRoleTeacher, useWorkspaceMode } from "lib/workspace";

export const CreateStudentPage = () => {
  const { user } = useAuth();
  const workspace = useWorkspaceMode();
  const canManage =
    useIsTenantAdmin() ||
    (workspace === "admin" && isDualRoleTeacher(user));

  if (!canManage) {
    return <Navigate to="/my-students/list" replace />;
  }

  return <CreateStudentManager />;
};
