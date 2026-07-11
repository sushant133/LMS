import { useMemo, useState } from "react";
import { CalendarCheck, ClipboardList, Hospital } from "lucide-react";
import { canManageInstitution, hasInstitutionAccess } from "@phit-erp/shared";
import { useAuth } from "features/auth/AuthProvider";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { AttendanceManager } from "./AttendanceManager";
import { DailyAttendanceManager } from "./DailyAttendanceManager";
import { FieldDutyManager } from "./FieldDutyManager";

type AttendanceTab = "daily" | "subject" | "field-duty";

export const AttendanceHub = () => {
  const { user } = useAuth();
  const hasInstitutionRead = hasInstitutionAccess(user?.role ?? "");
  const canWriteAdmin = canManageInstitution(user?.role ?? "");
  const isTeacher = user?.role === "TEACHER";
  const [activeTab, setActiveTab] = useState<AttendanceTab>("daily");

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
        {
          id: "field-duty" as const,
          label: "Field / Hospital Duty",
          icon: Hospital,
        },
      ] as const,
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Daily register, subject-wise attendance, and field/hospital duty attendance — each module is independent."
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
      {activeTab === "field-duty" ? <FieldDutyManager /> : null}
    </div>
  );
};
