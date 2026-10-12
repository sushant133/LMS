import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ClipboardList,
  FileText,
  GraduationCap,
  RotateCcw,
  ScrollText,
} from "lucide-react";
import {
  canAccessExaminationCollege,
  canAccessExaminationCtevt,
  canAccessExaminationManagement,
  canWriteExaminationCtevt,
  isSystemAdministrator,
  type ModuleAccessMap,
} from "@phit-erp/shared";
import { useLocation } from "react-router-dom";
import { EmptyState } from "components/shared/EmptyState";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { CtevtExamPanel } from "features/exams/CtevtExamPanel";
import { CtevtRegistrationPanel } from "features/exams/CtevtRegistrationPanel";
import { CtevtStudentListsPanel } from "features/exams/CtevtStudentListsPanel";
import { ExamManager } from "features/exams/ExamManager";
import { useAuth } from "features/auth/AuthProvider";
import {
  useHasInstitutionAccess,
  useIsTenantAdmin,
  useNormalizedRole,
} from "hooks/useNormalizedRole";
import { useIsCollege } from "hooks/useInstitutionType";
import { cn } from "lib/utils";

type ExamSection = "college" | "ctevt";
type CtevtSubSection =
  | "registration"
  | "exam"
  | "passed-out"
  | "back-students";

/**
 * Top-level Examination Management shell:
 * - Admin hub (/exams-view): College and/or CTEVT by Module Access
 * - My Work (/exams): teacher/student portal without admin College/CTEVT tabs
 *
 * Module Access (Admin / Super Admin matrix):
 * - Examination — College  → College section
 * - Examination — CTEVT    → CTEVT section
 * - Either / both / none
 */
export const ExaminationManagementHub = () => {
  const { user } = useAuth();
  const location = useLocation();
  const role = useNormalizedRole();
  const isAdmin = useIsTenantAdmin();
  const hasInstitutionRead = useHasInstitutionAccess();
  const isSuperAdmin = isSystemAdministrator(user?.role ?? "");

  const isMyWorkPath =
    location.pathname === "/exams" || location.pathname.startsWith("/exams/");
  const isAdminHubPath =
    location.pathname === "/exams-view" ||
    location.pathname.startsWith("/exams-view/");

  const moduleAccessMap = (user?.moduleAccess ?? {}) as ModuleAccessMap;
  const moduleAccessConfigured = Boolean(user?.moduleAccessConfigured);

  /**
   * Super Admin: always both.
   * Unconfigured matrix (legacy admin): both.
   * Configured matrix: only granted College / CTEVT modules.
   */
  const canCollege = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!moduleAccessConfigured) {
      return isAdmin || hasInstitutionRead;
    }
    return canAccessExaminationCollege(moduleAccessMap);
  }, [
    isSuperAdmin,
    moduleAccessConfigured,
    isAdmin,
    hasInstitutionRead,
    moduleAccessMap,
  ]);

  const canCtevt = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!moduleAccessConfigured) {
      return isAdmin || hasInstitutionRead;
    }
    return canAccessExaminationCtevt(moduleAccessMap);
  }, [
    isSuperAdmin,
    moduleAccessConfigured,
    isAdmin,
    hasInstitutionRead,
    moduleAccessMap,
  ]);

  const canOpenHub = canCollege || canCtevt;

  const isCollege = useIsCollege();
  /** Passed-Out Students issues character certificates, so it needs CTEVT write. */
  const canWriteCtevt =
    isSuperAdmin ||
    (!moduleAccessConfigured && isAdmin) ||
    canWriteExaminationCtevt(moduleAccessMap);
  const canPassedOut = isCollege && canWriteCtevt;
  const canBackStudents = isCollege && canCtevt;

  /** My Work: pure teaching/student portal — no admin College/CTEVT shell. */
  const isTeachingOrPortalRole =
    role === "TEACHER" ||
    role === "STUDENT" ||
    role === "PARENT";

  const showAdminShell =
    isAdminHubPath ||
    (isMyWorkPath &&
      (isAdmin || hasInstitutionRead || isSuperAdmin) &&
      canOpenHub &&
      !isTeachingOrPortalRole);

  const [section, setSection] = useState<ExamSection>("college");
  const [ctevtSub, setCtevtSub] = useState<CtevtSubSection>("registration");

  // Prefer first allowed section when grants change
  useEffect(() => {
    if (canCollege && !canCtevt) setSection("college");
    else if (!canCollege && canCtevt) setSection("ctevt");
    else if (canCollege && section === "ctevt" && !canCtevt) setSection("college");
    else if (canCtevt && section === "college" && !canCollege) setSection("ctevt");
  }, [canCollege, canCtevt, section]);

  // My Work path for teachers/students: ExamManager only
  if (isMyWorkPath && !showAdminShell) {
    return <ExamManager />;
  }

  // Admin hub without any grant
  if (isAdminHubPath && !canOpenHub) {
    return (
      <PageContent className="space-y-6">
        <PageHeader
          title="Examination Management"
          description="College and CTEVT examination workflows."
        />
        <EmptyState
          title="No examination access"
          description="You do not have Examination — College or Examination — CTEVT access. Ask an administrator to grant it under Module Access."
        />
      </PageContent>
    );
  }

  // Staff opened /exams-view with grant(s) — even if role is not COLLEGE_ADMIN
  if (
    isAdminHubPath &&
    moduleAccessConfigured &&
    !isSuperAdmin &&
    !isAdmin &&
    !hasInstitutionRead &&
    !canAccessExaminationManagement(moduleAccessMap)
  ) {
    return (
      <PageContent className="space-y-6">
        <PageHeader title="Examination Management" />
        <EmptyState
          title="Access denied"
          description="Contact the Administrator for Examination Management access."
        />
      </PageContent>
    );
  }

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="Examination Management"
        description="College internal exams & results, and CTEVT examination workflows."
      />

      <div className="flex flex-wrap gap-3">
        {canCollege ? (
          <Button
            type="button"
            size="lg"
            variant={section === "college" ? "default" : "outline"}
            className={cn(
              "min-w-[10rem] px-6 py-6 text-base font-semibold",
              section === "college" && "bg-brand-600 hover:bg-brand-700",
            )}
            onClick={() => setSection("college")}
          >
            <Building2 className="mr-2 h-5 w-5" />
            College
          </Button>
        ) : null}
        {canCtevt ? (
          <Button
            type="button"
            size="lg"
            variant={section === "ctevt" ? "default" : "outline"}
            className={cn(
              "min-w-[10rem] px-6 py-6 text-base font-semibold",
              section === "ctevt" && "bg-brand-600 hover:bg-brand-700",
            )}
            onClick={() => setSection("ctevt")}
          >
            <ScrollText className="mr-2 h-5 w-5" />
            CTEVT
          </Button>
        ) : null}
      </div>

      {section === "college" && canCollege ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">
              College — Exams & Results
            </p>
            <p className="mt-0.5 text-sm text-slate-500">
              Create exams, publish routines, enter marks, review results, and print
              marksheets for college assessments.
            </p>
          </div>
          <ExamManager embedded />
        </div>
      ) : null}

      {section === "ctevt" && canCtevt ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">CTEVT</p>
            <p className="mt-0.5 text-sm text-slate-500">
              CTEVT student registration and examination fee workflows.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              size="lg"
              variant={ctevtSub === "registration" ? "default" : "outline"}
              className={cn(
                "min-w-[10rem] px-6 py-6 text-base font-semibold",
                ctevtSub === "registration" &&
                  "bg-brand-600 hover:bg-brand-700",
              )}
              onClick={() => setCtevtSub("registration")}
            >
              <ClipboardList className="mr-2 h-5 w-5" />
              Registration
            </Button>
            <Button
              type="button"
              size="lg"
              variant={ctevtSub === "exam" ? "default" : "outline"}
              className={cn(
                "min-w-[10rem] px-6 py-6 text-base font-semibold",
                ctevtSub === "exam" && "bg-brand-600 hover:bg-brand-700",
              )}
              onClick={() => setCtevtSub("exam")}
            >
              <FileText className="mr-2 h-5 w-5" />
              Exam
            </Button>
            {canPassedOut ? (
              <Button
                type="button"
                size="lg"
                variant={ctevtSub === "passed-out" ? "default" : "outline"}
                className={cn(
                  "min-w-[10rem] px-6 py-6 text-base font-semibold",
                  ctevtSub === "passed-out" && "bg-brand-600 hover:bg-brand-700",
                )}
                onClick={() => setCtevtSub("passed-out")}
              >
                <GraduationCap className="mr-2 h-5 w-5" />
                Passed-Out Students
              </Button>
            ) : null}
            {canBackStudents ? (
              <Button
                type="button"
                size="lg"
                variant={ctevtSub === "back-students" ? "default" : "outline"}
                className={cn(
                  "min-w-[10rem] px-6 py-6 text-base font-semibold",
                  ctevtSub === "back-students" &&
                    "bg-brand-600 hover:bg-brand-700",
                )}
                onClick={() => setCtevtSub("back-students")}
              >
                <RotateCcw className="mr-2 h-5 w-5" />
                Back Students
              </Button>
            ) : null}
          </div>

          {ctevtSub === "registration" ? (
            <CtevtRegistrationPanel />
          ) : ctevtSub === "passed-out" && canPassedOut ? (
            <CtevtStudentListsPanel view="passed-out" />
          ) : ctevtSub === "back-students" && canBackStudents ? (
            <CtevtStudentListsPanel view="back-students" />
          ) : (
            <CtevtExamPanel />
          )}
        </div>
      ) : null}

      {!canCollege && !canCtevt ? (
        <EmptyState
          title="No examination sections available"
          description="Grant Examination — College and/or Examination — CTEVT in Module Access."
        />
      ) : null}
    </PageContent>
  );
};
