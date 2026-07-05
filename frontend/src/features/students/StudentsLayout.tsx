import { NavLink, Navigate, Outlet } from "react-router-dom";
import { UserPlus, Users } from "lucide-react";
import { PageHeader } from "components/shared/PageHeader";
import { useIsCollege } from "hooks/useInstitutionType";
import { useIsTenantAdmin } from "hooks/useNormalizedRole";
import { getAcademicLabels } from "lib/academicStructureUtils";
import { cn } from "lib/utils";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "inline-flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all",
    isActive
      ? "border-green-300 bg-green-200 text-green-900 shadow-sm"
      : "border-green-100 bg-green-50 text-green-700 hover:border-green-200 hover:bg-green-100"
  );

export const StudentsLayout = () => {
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const canManage = useIsTenantAdmin();

  return (
    <div className="space-y-6">
      <PageHeader
        title={canManage ? "Student Management" : "My Students"}
        description={
          canManage
            ? "Admissions, BS dates, Nepal address data, guardian details, and fee due tracking."
            : `Students in your assigned ${labels.primaryPlural.toLowerCase()} and ${labels.secondaryPlural.toLowerCase()}. Contact the college admin to register new students.`
        }
      />

      {canManage ? (
        <div className="flex gap-2 rounded-2xl border border-green-100 bg-green-50 p-1.5">
          <NavLink to="/students/create" className={tabClass}>
            <UserPlus className="h-4 w-4" />
            Create Student
          </NavLink>
          <NavLink to="/students/list" className={tabClass}>
            <Users className="h-4 w-4" />
            Students List
          </NavLink>
        </div>
      ) : null}

      <Outlet />
    </div>
  );
};

export const StudentsIndexRedirect = () => <Navigate to="/students/list" replace />;