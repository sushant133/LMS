import { useQuery } from "@tanstack/react-query";
import {
  type AcademicLessonPlanRecord,
  type AcademicLogBookEntryRecord,
  type AcademicManagementDashboard,
  type AcademicManagementFilters,
  type AcademicSessionPlanRecord,
  type BatchRecord,
  type ClassRecord,
  type SectionRecord,
  type SubjectRecord,
  type YearRecord,
  canManageInstitution,
  hasInstitutionAccess,
} from "@phit-erp/shared";
import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileBarChart,
  LayoutDashboard,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { useAuth } from "features/auth/AuthProvider";
import { useTeacherScope } from "hooks/useTeacherScope";
import { useIsCollege } from "hooks/useInstitutionType";
import { api, unwrap } from "lib/api";
import { downloadPdfFromElementById, printElementById } from "lib/printUtils";
import { cn } from "lib/utils";
import { toast } from "sonner";
import { AcademicManagementDashboardPanel } from "./AcademicManagementDashboard";
import { AcademicManagementFilterBar } from "./AcademicManagementFilterBar";
import { LessonPlanPanel } from "./LessonPlanPanel";
import { LogBookPanel } from "./LogBookPanel";
import { AcademicReportsPanel } from "./AcademicReportsPanel";
import { SessionPlanPanel } from "./SessionPlanPanel";
import {
  defaultAcademicFilters,
  exportLessonPlansExcel,
  exportLogBookExcel,
  exportSessionPlansExcel,
  filtersToParams,
} from "./academicManagementUtils";

type Tab =
  "dashboard" | "session-plan" | "lesson-plan" | "log-book" | "reports";

const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "session-plan", label: "Session Plan", icon: BookOpen },
  { id: "lesson-plan", label: "Lesson Plan", icon: CalendarDays },
  { id: "log-book", label: "Log Book", icon: ClipboardList },
  { id: "reports", label: "Reports", icon: FileBarChart },
];

export const AcademicManagementHub = () => {
  const { user } = useAuth();
  const isCollege = useIsCollege();
  const isTeacher = user?.role === "TEACHER";
  const isAdmin = canManageInstitution(user?.role ?? "");
  const hasInstitutionRead = hasInstitutionAccess(user?.role ?? "");
  const teacherScopeQuery = useTeacherScope(isTeacher);

  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [draftFilters, setDraftFilters] = useState<AcademicManagementFilters>(
    defaultAcademicFilters(),
  );
  const [appliedFilters, setAppliedFilters] =
    useState<AcademicManagementFilters>(defaultAcademicFilters());

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => unwrap<{ academicYearBs: string }>(api.get("/settings")),
  });

  const classesQuery = useQuery({
    queryKey: ["academics", "classes"],
    queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")),
    enabled: !isCollege,
  });

  const sectionsQuery = useQuery({
    queryKey: ["academics", "sections"],
    queryFn: () => unwrap<SectionRecord[]>(api.get("/academics/sections")),
    enabled: !isCollege,
  });

  const batchesQuery = useQuery({
    queryKey: ["academics", "batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    enabled: isCollege,
  });

  const yearsQuery = useQuery({
    queryKey: ["academics", "years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    enabled: isCollege,
  });

  const subjectsQuery = useQuery({
    queryKey: ["academics", "subjects"],
    queryFn: () => unwrap<SubjectRecord[]>(api.get("/academics/subjects")),
  });

  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () =>
      unwrap<Array<{ _id: string; user: { fullName: string } }>>(
        api.get("/teachers"),
      ),
    enabled: hasInstitutionRead,
  });

  const dashboardQuery = useQuery({
    queryKey: ["academic-management", "dashboard", appliedFilters],
    queryFn: () =>
      unwrap<AcademicManagementDashboard>(
        api.get("/academic-management/dashboard", {
          params: filtersToParams(appliedFilters),
        }),
      ),
    enabled: activeTab === "dashboard",
  });

  const sessionPlansQuery = useQuery({
    queryKey: ["academic-management", "session-plans", appliedFilters],
    queryFn: () =>
      unwrap<AcademicSessionPlanRecord[]>(
        api.get("/academic-management/session-plans", {
          params: filtersToParams(appliedFilters),
        }),
      ),
    enabled: activeTab === "session-plan",
  });

  const lessonPlansQuery = useQuery({
    queryKey: ["academic-management", "lesson-plans", appliedFilters],
    queryFn: () =>
      unwrap<AcademicLessonPlanRecord[]>(
        api.get("/academic-management/lesson-plans", {
          params: filtersToParams(appliedFilters),
        }),
      ),
    enabled: activeTab === "lesson-plan",
  });

  const logBookQuery = useQuery({
    queryKey: ["academic-management", "log-book", appliedFilters],
    queryFn: () =>
      unwrap<AcademicLogBookEntryRecord[]>(
        api.get("/academic-management/log-book-entries", {
          params: filtersToParams(appliedFilters),
        }),
      ),
    enabled: activeTab === "log-book",
  });

  useEffect(() => {
    if (!settingsQuery.data?.academicYearBs) return;
    setDraftFilters((current) =>
      current.academicYearBs
        ? current
        : {
            ...current,
            academicYearBs: settingsQuery.data.academicYearBs,
            session: settingsQuery.data.academicYearBs,
          },
    );
    setAppliedFilters((current) =>
      current.academicYearBs
        ? current
        : {
            ...current,
            academicYearBs: settingsQuery.data.academicYearBs,
            session: settingsQuery.data.academicYearBs,
          },
    );
  }, [settingsQuery.data?.academicYearBs]);

  const teacherId = teacherScopeQuery.data?.scope.teacherId;
  const subjects = useMemo(() => {
    const all = subjectsQuery.data ?? [];
    if (!isTeacher || !teacherScopeQuery.data) return all;
    return all.filter((subject) =>
      teacherScopeQuery.data.scope.subjectIds.includes(subject._id),
    );
  }, [isTeacher, subjectsQuery.data, teacherScopeQuery.data]);

  const handleSearch = () => setAppliedFilters({ ...draftFilters });
  const handleReset = () => {
    const reset = {
      ...defaultAcademicFilters(),
      academicYearBs: settingsQuery.data?.academicYearBs ?? "",
      session: settingsQuery.data?.academicYearBs ?? "",
    };
    setDraftFilters(reset);
    setAppliedFilters(reset);
  };

  const handleExportExcel = () => {
    if (activeTab === "reports") {
      toast.message("Use Export CSV in the Reports tab");
      return;
    }
    if (activeTab === "session-plan" && sessionPlansQuery.data) {
      exportSessionPlansExcel(sessionPlansQuery.data, "session-plans.xlsx");
      return;
    }
    if (activeTab === "lesson-plan" && lessonPlansQuery.data) {
      exportLessonPlansExcel(lessonPlansQuery.data, "lesson-plans.xlsx");
      return;
    }
    if (activeTab === "log-book" && logBookQuery.data) {
      exportLogBookExcel(logBookQuery.data, "log-book.xlsx");
    }
  };

  const handleExportPdf = () => {
    void downloadPdfFromElementById(
      "academic-print-area",
      "academic-management-report.pdf",
    );
  };

  const handlePrint = () => {
    void printElementById("academic-print-area", "academic-management-print");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic Management"
        description="Unified session planning, lesson planning, and daily log books with syllabus tracking and approvals."
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

      <AcademicManagementFilterBar
        filters={draftFilters}
        onChange={setDraftFilters}
        onSearch={handleSearch}
        onReset={handleReset}
        onExportExcel={handleExportExcel}
        onExportPdf={handleExportPdf}
        onPrint={handlePrint}
        activeTab={activeTab}
        classes={(classesQuery.data ?? []).map((item) => ({
          _id: item._id,
          name: item.name,
        }))}
        sections={(sectionsQuery.data ?? []).map((item) => ({
          _id: item._id,
          name: item.name,
          classId: item.classId,
        }))}
        batches={(batchesQuery.data ?? []).map((item) => ({
          _id: item._id,
          name: item.name,
        }))}
        years={(yearsQuery.data ?? []).map((item) => ({
          _id: item._id,
          name: item.name,
          batchId: item.batchId,
        }))}
        subjects={subjects.map((item) => ({ _id: item._id, name: item.name }))}
        teachers={teachersQuery.data ?? []}
        academicYearBs={settingsQuery.data?.academicYearBs ?? ""}
        showTeacherFilter={isAdmin}
      />

      <div className={cn(activeTab === "dashboard" ? "block" : "hidden")}>
        <AcademicManagementDashboardPanel
          data={dashboardQuery.data}
          loading={dashboardQuery.isLoading}
        />
      </div>
      <div className={cn(activeTab === "session-plan" ? "block" : "hidden")}>
        <SessionPlanPanel
          filters={appliedFilters}
          subjects={subjects}
          teacherId={teacherId}
          teachers={teachersQuery.data ?? []}
        />
      </div>
      <div className={cn(activeTab === "lesson-plan" ? "block" : "hidden")}>
        <LessonPlanPanel
          filters={appliedFilters}
          subjects={subjects}
          teacherId={teacherId}
          teachers={teachersQuery.data ?? []}
        />
      </div>
      <div className={cn(activeTab === "log-book" ? "block" : "hidden")}>
        <LogBookPanel
          filters={appliedFilters}
          teacherId={teacherId}
          isTeacher={isTeacher}
          subjects={subjects}
          teachers={teachersQuery.data ?? []}
        />
      </div>
      <div className={cn(activeTab === "reports" ? "block" : "hidden")}>
        <AcademicReportsPanel filters={appliedFilters} />
      </div>
    </div>
  );
};
