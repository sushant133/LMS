import { hasInstitutionAccess } from "@phit-erp/shared";
import { Navigate, useLocation } from "react-router-dom";
import { AcademicManagementHub } from "features/academic-management/AcademicManagementHub";
import { useAuth } from "features/auth/AuthProvider";
import { userIsTeacher } from "lib/teacherRole";
import { isDualRoleTeacher } from "lib/workspace";

export const AcademicManagementPage = () => {
  const { user } = useAuth();
  const location = useLocation();
  const isAdminHub = location.pathname.startsWith("/academic-management-view");
  const mayUseAdminHub =
    hasInstitutionAccess(user?.role ?? "") || isDualRoleTeacher(user);

  if (isAdminHub && userIsTeacher(user) && !mayUseAdminHub) {
    return <Navigate to="/academic-management" replace />;
  }
  if (location.pathname === "/academic-management" && !userIsTeacher(user)) {
    return <Navigate to="/academic-management-view" replace />;
  }
  return <AcademicManagementHub />;
};