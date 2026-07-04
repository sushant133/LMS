import { Users } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { AccountantsStaffPanel } from "features/college-staff/AccountantsStaffPanel";
import { CollegeStaffManager } from "features/college-staff/CollegeStaffManager";
import { ModuleStaffPanel } from "features/college-staff/ModuleStaffPanel";
import { COLLEGE_STAFF_TABS, type CollegeStaffTabId, isGenericStaffTab } from "features/college-staff/collegeStaffTabs";
import { TeachersManager } from "features/teachers/TeachersManager";
import { cn } from "lib/utils";

const DEFAULT_TAB: CollegeStaffTabId = "teachers";

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
        description="Manage teaching and non-teaching employees from one place. Teachers continue to use the existing teacher system unchanged."
      />

      <div className="flex flex-wrap gap-2">
        {COLLEGE_STAFF_TABS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={tab === item.id ? "default" : "outline"}
            className={cn(tab === item.id && "bg-emerald-600 hover:bg-emerald-700")}
            onClick={() => setTab(item.id)}
          >
            <Users className="mr-2 h-4 w-4" />
            {item.label}
          </Button>
        ))}
      </div>

      {tab === "teachers" ? <TeachersManager embedded /> : null}
      {tab === "accountants" ? <AccountantsStaffPanel /> : null}
      {tab === "librarians" ? (
        <ModuleStaffPanel title="Librarian" apiBase="/library/staff" queryKey="library-staff" />
      ) : null}
      {tab === "laboratory" ? (
        <ModuleStaffPanel title="Laboratory Staff" apiBase="/laboratory/staff" queryKey="laboratory-staff" />
      ) : null}
      {isGenericStaffTab(tab) && activeTabMeta.category ? (
        <CollegeStaffManager category={activeTabMeta.category} title={activeTabMeta.label} />
      ) : null}
    </PageContent>
  );
};