import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  BookOpen,
  CalendarCheck,
  ClipboardList,
  LogOut,
  UserCheck,
  Users,
} from "lucide-react";
import { canManageInstitution, hasInstitutionAccess } from "@phit-erp/shared";
import { useAuth } from "features/auth/AuthProvider";
import { useIsGrantedAdmin } from "hooks/useModuleAccess";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { api, unwrap } from "lib/api";
import { userIsTeacher } from "lib/teacherRole";
import { AttendanceRegisterManager } from "features/attendance-register/AttendanceRegisterManager";
import { ParentAttendancePanel } from "features/parent/ParentAttendancePanel";
import { AttendanceManager } from "./AttendanceManager";
import { DailyAttendanceManager } from "./DailyAttendanceManager";
import { EarlyLeavePanel } from "./EarlyLeavePanel";
import { EmployeeAttendancePanel } from "./EmployeeAttendancePanel";

type AttendanceTab =
  | "daily"
  | "subject"
  | "early-leave"
  | "teacher"
  | "staff"
  | "register";

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
 * - Student daily + subject
 * - Early leave (campus exit before end of day)
 * - Teacher / staff attendance
 * - Traditional Attendance Register
 */
export const AttendanceHub = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasInstitutionRead = hasInstitutionAccess(user?.role ?? "");
  const grantedAttendanceAdmin = useIsGrantedAdmin("attendance");
  const grantedDailyAttendanceAdmin = useIsGrantedAdmin("daily-attendance");
  const canWriteAdmin =
    canManageInstitution(user?.role ?? "") ||
    grantedAttendanceAdmin ||
    grantedDailyAttendanceAdmin;
  const isTeacher = userIsTeacher(user);
  const isStaff = user?.role === "COLLEGE_STAFF";
  const isStudent = user?.role === "STUDENT";
  const isParent = user?.role === "PARENT";
  // Also treat secondary PARENT-only sessions (rare)
  const isParentOnly =
    isParent &&
    !canWriteAdmin &&
    !hasInstitutionRead &&
    !isTeacher &&
    !isStaff;

  const permsQuery = useQuery({
    queryKey: ["employee-attendance", "permissions"],
    queryFn: () =>
      unwrap<EmpPerms>(api.get("/employee-attendance/permissions")),
    enabled: Boolean(user) && !isStudent && !isParentOnly,
  });

  const perms = permsQuery.data;
  /**
   * HR Teacher Attendance sheet:
   * - Institution admins always
   * - Staff with teacher-attendance Module Access (perms.teacher.view)
   */
  const showTeacherHr = canWriteAdmin || Boolean(perms?.teacher.view);
  /**
   * HR Staff Attendance sheet:
   * - Admins always
   * - staff-attendance Module Access grant
   * - COLLEGE_STAFF role
   */
  const showStaff =
    canWriteAdmin || Boolean(perms?.staff.view) || isStaff;

  /** Traditional register */
  const showRegister =
    hasInstitutionRead ||
    canWriteAdmin ||
    isTeacher ||
    showTeacherHr ||
    showStaff ||
    isStudent;

  /**
   * Early Leave — always show for anyone in Attendance Management who is not a
   * pure parent/student self-service view. Admins, teachers, and staff with
   * attendance access all need this tab.
   */
  const showEarlyLeave =
    !isParentOnly &&
    !isStudent &&
    (canWriteAdmin ||
      hasInstitutionRead ||
      isTeacher ||
      isStaff ||
      showTeacherHr ||
      showStaff ||
      // Fallback: if user can open this hub at all as non-parent, show the tab
      Boolean(user));

  // Prefer HR tabs when the user is not a classroom teacher / institution admin
  const defaultTab: AttendanceTab =
    !canWriteAdmin && !hasInstitutionRead && !isTeacher
      ? isStaff
        ? "staff"
        : showEarlyLeave
          ? "early-leave"
          : "teacher"
      : "daily";

  const tabFromUrl = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<AttendanceTab>(() => {
    if (tabFromUrl === "register") return "register";
    if (tabFromUrl === "early-leave") return "early-leave";
    if (
      tabFromUrl === "daily" ||
      tabFromUrl === "subject" ||
      tabFromUrl === "teacher" ||
      tabFromUrl === "staff"
    ) {
      return tabFromUrl;
    }
    return defaultTab;
  });

  useEffect(() => {
    if (tabFromUrl === "register") setActiveTab("register");
    if (tabFromUrl === "early-leave") setActiveTab("early-leave");
  }, [tabFromUrl]);

  const selectTab = (id: AttendanceTab) => {
    setActiveTab(id);
    if (id === "register" || id === "early-leave") {
      setSearchParams({ tab: id }, { replace: true });
    } else if (searchParams.has("tab")) {
      setSearchParams({}, { replace: true });
    }
  };

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
        label: isTeacher && !canWriteAdmin ? "Daily" : "Student Daily",
        icon: CalendarCheck,
      });
      list.push({
        id: "subject",
        label:
          isTeacher && !canWriteAdmin ? "Subject-wise" : "Student Subject-wise",
        icon: ClipboardList,
      });
    }

    // Early Leave — always available in Attendance Management for staff/admin/teacher
    if (showEarlyLeave) {
      list.push({
        id: "early-leave",
        label: "Early Leave",
        icon: LogOut,
      });
    }

    if (showTeacherHr) {
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

    if (showRegister) {
      list.push({
        id: "register",
        label: "Attendance Register",
        icon: BookOpen,
      });
    }

    return list;
  }, [
    hasInstitutionRead,
    isTeacher,
    canWriteAdmin,
    showEarlyLeave,
    showTeacherHr,
    showStaff,
    showRegister,
  ]);

  // Parents: dedicated children attendance (after hooks)
  if (isParentOnly) {
    return <ParentAttendancePanel />;
  }

  const safeTab =
    tabs.find((t) => t.id === activeTab)?.id ?? tabs[0]?.id ?? "daily";

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          isTeacher && !canWriteAdmin
            ? "My Attendance"
            : "Attendance Management"
        }
        description={
          isTeacher && !canWriteAdmin
            ? "Mark daily class attendance or subject-wise periods. Use Early Leave when a student leaves campus early (parents are notified)."
            : "Student daily & subject attendance, Early Leave (with parent notification), teacher/staff attendance, and monthly register."
        }
      />

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Button
              key={tab.id}
              type="button"
              variant={safeTab === tab.id ? "default" : "outline"}
              onClick={() => selectTab(tab.id)}
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

      {safeTab === "early-leave" ? <EarlyLeavePanel /> : null}

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

      {safeTab === "register" ? (
        <AttendanceRegisterManager embedded />
      ) : null}
    </div>
  );
};
