import { Navigate } from "react-router-dom";
import { CreateStudentManager } from "features/students/CreateStudentManager";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";

export const CreateStudentPage = () => {
  const canManage = useIsTenantAdmin();

  if (!canManage) {
    return <Navigate to="/students/list" replace />;
  }

  return <CreateStudentManager />;
};