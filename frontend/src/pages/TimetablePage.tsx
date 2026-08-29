import { hasInstitutionAccess } from "@phit-erp/shared";
import { Navigate, useLocation } from "react-router-dom";
import { TimetableManager } from "features/timetable/TimetableManager";
import { useAuth } from "features/auth/AuthProvider";
import { useCanManageGrantedModule } from "hooks/useModuleAccess";
import { userIsTeacher } from "lib/teacherRole";
import { isDualRoleTeacher } from "lib/workspace";

export const TimetablePage = () => {
  const { user } = useAuth();
  const location = useLocation();
  const isAdminHub = location.pathname.startsWith("/timetable-view");
  const staffGranted = useCanManageGrantedModule("timetable");
  const mayUseAdminHub =
    hasInstitutionAccess(user?.role ?? "") ||
    user?.role === "PRINCIPAL" ||
    isDualRoleTeacher(user) ||
    (!userIsTeacher(user) && staffGranted);

  if (isAdminHub && userIsTeacher(user) && !mayUseAdminHub) {
    return <Navigate to="/timetable" replace />;
  }
  if (
    location.pathname === "/timetable" &&
    !userIsTeacher(user) &&
    user?.role !== "STUDENT"
  ) {
    return <Navigate to="/timetable-view" replace />;
  }
  return <TimetableManager />;
};