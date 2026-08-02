import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
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
      ? "border-brand-300 bg-brand-200 text-brand-900 shadow-sm"
      : "border-brand-100 bg-brand-50 text-brand-700 hover:border-brand-200 hover:bg-brand-100",
  );

export const StudentsLayout = () => {
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const canManage = useIsTenantAdmin();
  const location = useLocation();

  return (
    <div className="space-y-6">
      <PageHeader
        title={canManage ? "Student Management" : "My Students"}
        description={
          canManage
            ? "Admissions, BS dates, Nepal address data, guardian details, total fee and scholarship."
            : `Students in your assigned ${labels.primaryPlural.toLowerCase()} and ${labels.secondaryPlural.toLowerCase()}. Contact the college admin to register new students.`
        }
      />

      {canManage ? (
        <div className="flex gap-2 rounded-2xl border border-brand-100 bg-brand-50 p-1.5">
          <NavLink to="/students/create" className={tabClass}>
            <UserPlus className="h-4 w-4 shrink-0" />
            Create Student
          </NavLink>
          <NavLink
            to={{ pathname: "/students/list", search: location.search }}
            className={tabClass}
          >
            <Users className="h-4 w-4 shrink-0" />
            Students List
          </NavLink>
        </div>
      ) : null}

      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
};

/** Keep dashboard query (?yearName=, ?status=) when redirecting /students → /students/list */
export const StudentsIndexRedirect = () => {
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: "list", search: location.search }}
      replace
    />
  );
};
