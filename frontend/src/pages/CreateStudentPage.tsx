import { Navigate } from "react-router-dom";
import { CreateStudentManager } from "features/students/CreateStudentManager";
import { useIsGrantedAdmin } from "hooks/useModuleAccess";

export const CreateStudentPage = () => {
  const canManage = useIsGrantedAdmin("students");

  if (!canManage) {
    return <Navigate to="/my-students/list" replace />;
  }

  return <CreateStudentManager />;
};
