import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarCheck,
  ClipboardList,
  UserCheck,
  Users,
} from "lucide-react";
import { canManageInstitution, hasInstitutionAccess } from "@phit-erp/shared";
import { useAuth } from "features/auth/AuthProvider";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { api, unwrap } from "lib/api";
import { AttendanceManager } from "./AttendanceManager";
import { DailyAttendanceManager } from "./DailyAttendanceManager";
import { EmployeeAttendancePanel } from "./EmployeeAttendancePanel";

type AttendanceTab =
  | "daily"
  | "subject"
  | "teacher"
  | "staff";

type EmpPerms = {
  teacher: {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
    approve: boolean;
    export: boolean;
    print: boolean;
  };
  staff: {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
    approve: boolean;
    export: boolean;
    print: boolean;
  };
};

/**
 * Attendance Management hub:
 * - Student daily + subject (existing)
 * - Teacher attendance (new)
 * - Staff attendance (new)
 * Laboratory / Field attendance remain in their own modules.
 */
export const AttendanceHub = () => {
  const { user } = useAuth();
  const hasInstitutionRead = hasInstitutionAccess(user?.role ?? "");
  const canWriteAdmin = canManageInstitution(user?.role ?? "");
  const isTeacher = user?.role === "TEACHER";
  const isStaff = user?.role === "COLLEGE_STAFF";
  const isStudent = user?.role === "STUDENT";

  const permsQuery = useQuery({
    queryKey: ["employee-attendance", "permissions"],
    queryFn: () =>
      unwrap<EmpPerms>(api.get("/employee-attendance/permissions")),
    enabled: !isStudent,
  });

  const perms = permsQuery.data;
  const showTeacher =
    canWriteAdmin ||
    Boolean(perms?.teacher.view) ||
    isTeacher;
  const showStaff =
    canWriteAdmin ||
    Boolean(perms?.staff.view) ||
    isStaff;

  const defaultTab: AttendanceTab =
    isTeacher && !canWriteAdmin && !hasInstitutionRead
      ? "teacher"
      : isStaff && !canWriteAdmin && !hasInstitutionRead
        ? "staff"
        : "daily";

  const [activeTab, setActiveTab] = useState<AttendanceTab>(defaultTab);

  const tabs = useMemo(() => {
    const list: Array<{
      id: AttendanceTab;
      label: string;
      icon: typeof CalendarCheck;
    }> = [];

    // Student classroom attendance — teachers + admins
    if (hasInstitutionRead || isTeacher || canWriteAdmin) {
      list.push({
        id: "daily",
        label: "Student Daily",
        icon: CalendarCheck,
      });
      list.push({
        id: "subject",
        label: "Student Subject-wise",
        icon: ClipboardList,
      });
    }

    if (showTeacher) {
      list.push({
        id: "teacher",
        label: "Teacher Attendance",
        icon: UserCheck,
      });
    }
    if (showStaff) {
      list.push({
        id: "staff",
        label: "Staff Attendance",
        icon: Users,
      });
    }

    return list;
  }, [
    hasInstitutionRead,
    isTeacher,
    canWriteAdmin,
    showTeacher,
    showStaff,
  ]);

  // Ensure active tab is valid when permissions load
  const safeTab =
    tabs.find((t) => t.id === activeTab)?.id ?? tabs[0]?.id ?? "daily";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Management"
        description="Student classroom attendance, teacher attendance, and staff attendance. Laboratory and field postings stay in their own modules."
      />

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Button
              key={tab.id}
              variant={safeTab === tab.id ? "default" : "outline"}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon className="mr-2 h-4 w-4" />
              {tab.label}
            </Button>
          );
        })}
      </div>

      {safeTab === "daily" ? (
        <DailyAttendanceManager
          hasInstitutionRead={hasInstitutionRead}
          canWriteAdmin={canWriteAdmin}
          isTeacher={isTeacher}
        />
      ) : null}

      {safeTab === "subject" ? <AttendanceManager embedded /> : null}

      {safeTab === "teacher" ? (
        <EmployeeAttendancePanel
          category="TEACHER"
          canTake={canWriteAdmin || Boolean(perms?.teacher.create)}
          canEdit={canWriteAdmin || Boolean(perms?.teacher.edit)}
          canUnlock={canWriteAdmin || Boolean(perms?.teacher.approve)}
          canExport={
            canWriteAdmin ||
            Boolean(perms?.teacher.export) ||
            Boolean(perms?.teacher.print)
          }
          selfOnly={
            Boolean(isTeacher) &&
            !canWriteAdmin &&
            !Boolean(perms?.teacher.view) &&
            !Boolean(perms?.teacher.create)
          }
        />
      ) : null}

      {safeTab === "staff" ? (
        <EmployeeAttendancePanel
          category="STAFF"
          canTake={canWriteAdmin || Boolean(perms?.staff.create)}
          canEdit={canWriteAdmin || Boolean(perms?.staff.edit)}
          canUnlock={canWriteAdmin || Boolean(perms?.staff.approve)}
          canExport={
            canWriteAdmin ||
            Boolean(perms?.staff.export) ||
            Boolean(perms?.staff.print)
          }
          selfOnly={
            Boolean(isStaff) &&
            !canWriteAdmin &&
            !Boolean(perms?.staff.view) &&
            !Boolean(perms?.staff.create)
          }
        />
      ) : null}
    </div>
  );
};
