import { useMemo, useState } from "react";
import { CalendarCheck, ClipboardList } from "lucide-react";
import { canManageInstitution, hasInstitutionAccess } from "@phit-erp/shared";
import { useAuth } from "features/auth/AuthProvider";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { AttendanceManager } from "./AttendanceManager";
import { DailyAttendanceManager } from "./DailyAttendanceManager";

type AttendanceTab = "daily" | "subject";

export const AttendanceHub = () => {
  const { user } = useAuth();
  const hasInstitutionRead = hasInstitutionAccess(user?.role ?? "");
  const canWriteAdmin = canManageInstitution(user?.role ?? "");
  const isTeacher = user?.role === "TEACHER";
  const [activeTab, setActiveTab] = useState<AttendanceTab>(
    isTeacher ? "daily" : "daily",
  );

  const tabs = useMemo(
    () =>
      [
        {
          id: "daily" as const,
          label: "Daily Attendance",
          icon: CalendarCheck,
        },
        {
          id: "subject" as const,
          label: "Subject-wise Attendance",
          icon: ClipboardList,
        },
      ] as const,
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Manage the official daily attendance register and subject-wise attendance from one place."
      />

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "outline"}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon className="mr-2 h-4 w-4" />
              {tab.label}
            </Button>
          );
        })}
      </div>

      {activeTab === "daily" ? (
        <DailyAttendanceManager
          hasInstitutionRead={hasInstitutionRead}
          canWriteAdmin={canWriteAdmin}
          isTeacher={isTeacher}
        />
      ) : null}
      {activeTab === "subject" ? <AttendanceManager embedded /> : null}
    </div>
  );
};
