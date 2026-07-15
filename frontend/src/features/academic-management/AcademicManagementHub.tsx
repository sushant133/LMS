import { useQuery } from "@tanstack/react-query";
import {
  type AcademicLessonPlanRecord,
  type AcademicLogBookEntryRecord,
  type AcademicManagementDashboard,
  type AcademicManagementFilters,
  type AcademicSessionPlanRecord,
  type AcademicSyllabusRecord,
  type BatchRecord,
  type ClassRecord,
  type SectionRecord,
  type SubjectAssignmentRecord,
  type SubjectRecord,
  type YearRecord,
  canManageInstitution,
  hasInstitutionAccess,
} from "@phit-erp/shared";
import {
  BookMarked,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileBarChart,
  LayoutDashboard,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ModuleReadOnlyBanner } from "components/shared/ModuleReadOnlyBanner";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { useAuth } from "features/auth/AuthProvider";
import { useTeacherScope } from "hooks/useTeacherScope";
import { useIsCollege } from "hooks/useInstitutionType";
import { useModuleAccess } from "hooks/useModuleAccess";
import { getCollegeDisplayName } from "lib/auth";
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
import { SyllabusPanel } from "./SyllabusPanel";
import {
  defaultAcademicFilters,
  exportLessonPlansExcel,
  exportLogBookExcel,
  exportSessionPlansExcel,
  exportSyllabiExcel,
  filtersToParams,
} from "./academicManagementUtils";

type Tab =
  | "dashboard"
  | "syllabus"
  | "session-plan"
  | "lesson-plan"
  | "log-book"
  | "reports";

const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "syllabus", label: "Syllabus", icon: BookMarked },
  { id: "session-plan", label: "Session Plan", icon: BookOpen },
  { id: "lesson-plan", label: "Lesson Plan", icon: CalendarDays },
  { id: "log-book", label: "Log Book", icon: ClipboardList },
  { id: "reports", label: "Reports", icon: FileBarChart },
];

const printAreaIdForTab = (tab: Tab): string | null => {
  switch (tab) {
    case "syllabus":
      return "syllabus-print-area";
    case "session-plan":
      return "session-plan-print-area";
    case "lesson-plan":
      return "lesson-plan-print-area";
    case "log-book":
      return "log-book-print-area";
    default:
      return null;
  }
};

export const AcademicManagementHub = () => {
  const { user, availableSchools } = useAuth();
  const isCollege = useIsCollege();
  const isTeacher = user?.role === "TEACHER";
  const isAdmin = canManageInstitution(user?.role ?? "");
  const hasInstitutionRead = hasInstitutionAccess(user?.role ?? "");
  const teacherScopeQuery = useTeacherScope(isTeacher);
  const institutionName = getCollegeDisplayName(availableSchools, user);
  const { canWrite: canWriteAcademic, isReadOnly: academicReadOnly } =
    useModuleAccess("academic-management");

  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [draftFilters, setDraftFilters] = useState<AcademicManagementFilters>(
    defaultAcademicFilters(),
  );
  const [appliedFilters, setAppliedFilters] =
    useState<AcademicManagementFilters>(defaultAcademicFilters());

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      unwrap<{ academicYearBs: string; schoolName?: string }>(
        api.get("/settings"),
      ),
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

  const assignmentsQuery = useQuery({
    queryKey: [
      "academic-management",
      "subject-assignments",
      appliedFilters.academicYearBs,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (appliedFilters.academicYearBs) {
        params.set("academicYearBs", appliedFilters.academicYearBs);
      }
      params.set("status", "ACTIVE");
      return unwrap<SubjectAssignmentRecord[]>(
        api.get(`/academics/subject-assignments?${params.toString()}`),
      );
    },
    // List endpoint is institution-admin only; teachers use own scope + their records
    enabled: hasInstitutionRead,
  });

  /**
   * Academic Management is curriculum-scoped, not student-batch-scoped.
   * Do not send batchId to list APIs (batches only apply to attendance/fees/etc.).
   * yearId is kept for client hierarchy level filtering but omitted from API so
   * plans from every batch of the same year level are returned and merged.
   */
  const academicListParams = useMemo(() => {
    const params = filtersToParams(appliedFilters);
    delete params.batchId;
    if (isCollege) {
      delete params.yearId;
    }
    return params;
  }, [appliedFilters, isCollege]);

  const dashboardQuery = useQuery({
    queryKey: ["academic-management", "dashboard", academicListParams],
    queryFn: () =>
      unwrap<AcademicManagementDashboard>(
        api.get("/academic-management/dashboard", {
          params: academicListParams,
        }),
      ),
    enabled: activeTab === "dashboard",
  });

  const syllabiQuery = useQuery({
    queryKey: ["academic-management", "syllabi", academicListParams],
    queryFn: () =>
      unwrap<AcademicSyllabusRecord[]>(
        api.get("/academic-management/syllabi", {
          params: academicListParams,
        }),
      ),
    enabled: activeTab === "syllabus",
  });

  const sessionPlansQuery = useQuery({
    queryKey: ["academic-management", "session-plans", academicListParams],
    queryFn: () =>
      unwrap<AcademicSessionPlanRecord[]>(
        api.get("/academic-management/session-plans", {
          params: academicListParams,
        }),
      ),
    enabled: activeTab === "session-plan",
  });

  const lessonPlansQuery = useQuery({
    queryKey: ["academic-management", "lesson-plans", academicListParams],
    queryFn: () =>
      unwrap<AcademicLessonPlanRecord[]>(
        api.get("/academic-management/lesson-plans", {
          params: academicListParams,
        }),
      ),
    enabled: activeTab === "lesson-plan",
  });

  const logBookQuery = useQuery({
    queryKey: ["academic-management", "log-book", academicListParams],
    queryFn: () =>
      unwrap<AcademicLogBookEntryRecord[]>(
        api.get("/academic-management/log-book-entries", {
          params: academicListParams,
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

  const years = useMemo(
    () =>
      (yearsQuery.data ?? []).map((item) => ({
        _id: item._id,
        name: item.name,
        level: item.level,
        batchId: item.batchId,
        isActive: item.isActive,
      })),
    [yearsQuery.data],
  );

  const classes = useMemo(
    () =>
      (classesQuery.data ?? []).map((item) => ({
        _id: item._id,
        name: item.name,
        isActive: item.isActive,
      })),
    [classesQuery.data],
  );

  const displayInstitutionName =
    settingsQuery.data?.schoolName || institutionName || "Institution";

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
    if (activeTab === "syllabus") {
      if (!syllabiQuery.data?.length) {
        toast.message("No syllabi to export for the current filters");
        return;
      }
      exportSyllabiExcel(
        syllabiQuery.data,
        `syllabus-${appliedFilters.academicYearBs || "export"}.xlsx`,
      );
      toast.success("Syllabus exported to Excel");
      return;
    }
    if (activeTab === "session-plan") {
      if (!sessionPlansQuery.data?.length) {
        toast.message("No session plans to export for the current filters");
        return;
      }
      exportSessionPlansExcel(
        sessionPlansQuery.data,
        `session-plans-${appliedFilters.academicYearBs || "export"}.xlsx`,
      );
      toast.success("Session Plans exported to Excel");
      return;
    }
    if (activeTab === "lesson-plan") {
      if (!lessonPlansQuery.data?.length) {
        toast.message("No lesson plans to export for the current filters");
        return;
      }
      exportLessonPlansExcel(
        lessonPlansQuery.data,
        `lesson-plans-${appliedFilters.academicYearBs || "export"}.xlsx`,
      );
      toast.success("Lesson Plans exported to Excel");
      return;
    }
    if (activeTab === "log-book") {
      if (!logBookQuery.data?.length) {
        toast.message("No log book entries to export for the current filters");
        return;
      }
      exportLogBookExcel(
        logBookQuery.data,
        `log-book-${appliedFilters.academicYearBs || "export"}.xlsx`,
      );
      toast.success("Log Book exported to Excel");
    }
  };

  const handleExportPdf = () => {
    const printId = printAreaIdForTab(activeTab);
    if (!printId) {
      toast.message("Switch to Syllabus, Session Plan, Lesson Plan, or Log Book to export PDF");
      return;
    }
    void downloadPdfFromElementById(
      printId,
      `${activeTab}-${appliedFilters.academicYearBs || "export"}.pdf`,
    ).then(
      () => toast.success("PDF export started"),
      (error) => toast.error(String(error?.message ?? error)),
    );
  };

  const handlePrint = () => {
    const printId = printAreaIdForTab(activeTab);
    if (!printId) {
      toast.message("Switch to Syllabus, Session Plan, Lesson Plan, or Log Book to print");
      return;
    }
    void printElementById(printId, `${activeTab}-print`);
  };

  const hierarchyProps = {
    years,
    classes,
    assignments: assignmentsQuery.data ?? [],
    isCollege,
    institutionName: displayInstitutionName,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic Management"
        description="Syllabus, session planning, lesson planning, and daily log books with tracking and approvals."
      />

      <ModuleReadOnlyBanner show={academicReadOnly} />

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
          level: item.level,
        }))}
        subjects={subjects.map((item) => ({
          _id: item._id,
          name: item.name,
          code: item.code,
          masterSubjectId: item.masterSubjectId ?? null,
          yearIds: item.yearIds,
        }))}
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
      <div className={cn(activeTab === "syllabus" ? "block" : "hidden")}>
        <SyllabusPanel
          filters={appliedFilters}
          subjects={subjects}
          teacherId={teacherId}
          teachers={teachersQuery.data ?? []}
          writeAccess={canWriteAcademic}
          {...hierarchyProps}
        />
      </div>
      <div className={cn(activeTab === "session-plan" ? "block" : "hidden")}>
        <SessionPlanPanel
          filters={appliedFilters}
          subjects={subjects}
          teacherId={teacherId}
          teachers={teachersQuery.data ?? []}
          writeAccess={canWriteAcademic}
          {...hierarchyProps}
        />
      </div>
      <div className={cn(activeTab === "lesson-plan" ? "block" : "hidden")}>
        <LessonPlanPanel
          filters={appliedFilters}
          subjects={subjects}
          teacherId={teacherId}
          teachers={teachersQuery.data ?? []}
          writeAccess={canWriteAcademic}
          {...hierarchyProps}
        />
      </div>
      <div className={cn(activeTab === "log-book" ? "block" : "hidden")}>
        <LogBookPanel
          filters={appliedFilters}
          teacherId={teacherId}
          isTeacher={isTeacher}
          subjects={subjects}
          teachers={teachersQuery.data ?? []}
          writeAccess={canWriteAcademic}
          {...hierarchyProps}
        />
      </div>
      <div className={cn(activeTab === "reports" ? "block" : "hidden")}>
        <AcademicReportsPanel filters={appliedFilters} />
      </div>
    </div>
  );
};
