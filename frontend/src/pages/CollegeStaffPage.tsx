import { Users } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { CollegeStaffManager } from "features/college-staff/CollegeStaffManager";
import {
  COLLEGE_STAFF_TABS,
  type CollegeStaffTabId,
} from "features/college-staff/collegeStaffTabs";
import { TeachersManager } from "features/teachers/TeachersManager";
import { cn } from "lib/utils";

const DEFAULT_TAB: CollegeStaffTabId = "all";

export const CollegeStaffPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as CollegeStaffTabId | null) ?? DEFAULT_TAB;
  const tab = COLLEGE_STAFF_TABS.some((item) => item.id === activeTab) ? activeTab : DEFAULT_TAB;

  const setTab = (nextTab: CollegeStaffTabId) => {
    setSearchParams({ tab: nextTab });
  };

  const activeTabMeta = COLLEGE_STAFF_TABS.find((item) => item.id === tab)!;

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="College Staff"
        description="Teachers use the Teacher system. Staff can be created on any role tab (or All Staff). Each tab lists only that role. Edit a person or use Module Access to set read/write permissions. Login credentials are emailed on create."
      />

      <div className="flex flex-wrap gap-2">
        {COLLEGE_STAFF_TABS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={tab === item.id ? "default" : "outline"}
            className={cn(tab === item.id && "bg-brand-600 hover:bg-brand-700")}
            onClick={() => setTab(item.id)}
          >
            <Users className="mr-2 h-4 w-4" />
            {item.label}
          </Button>
        ))}
      </div>

      {tab === "teachers" ? (
        <TeachersManager embedded />
      ) : tab === "reports" ? (
        <CollegeStaffManager title="Staff Reports" showReports />
      ) : (
        <CollegeStaffManager
          listCategory={activeTabMeta.category}
          title={activeTabMeta.label}
          /** Create on every role tab so staff appear in their section after save. */
          showCreateForm
        />
      )}
    </PageContent>
  );
};
