import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { hasInstitutionAccess } from "@phit-erp/shared";
import { Download } from "lucide-react";
import { useAuth } from "features/auth/AuthProvider";
import { useCanAccessModule } from "hooks/useModuleAccess";
import { api, unwrap } from "lib/api";
import { getPrintInstitutionBranding } from "lib/printBranding";
import { parseErrorMessage } from "lib/utils";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { LoadingState } from "components/shared/LoadingState";
import { PageHeader } from "components/shared/PageHeader";
import { toast } from "sonner";

type CountRow = { category: string; count: number };

interface ReportsAnalytics {
  academicYearBs: string;
  generatedAt: string;
  students: {
    enrolled: number;
    allRecords: number;
    byStatus: CountRow[];
    byGender: CountRow[];
    byGroup: CountRow[];
    byDisability: CountRow[];
    byEthnicity: CountRow[];
    byReligion: CountRow[];
    byCaste: CountRow[];
  };
  staff: { teachers: number; otherStaff: number };
  attendance: { overallRate: number; overallMarks: number; last30DaysRate: number; last30DaysMarks: number };
  results: { results: number; passRate: number; averageGpa: number; passed: number; failed: number; topPerformers: number };
  infrastructure: Record<string, string | number | boolean>;
}

/** Official exports (CSV, opens in Excel). */
const EXPORTS: Array<{ endpoint: string; title: string; description: string; group: string }> = [
  {
    endpoint: "iemis/student-master",
    title: "Student Master Data",
    description: "Every student with batch / year, roll no., gender, disability, ethnicity, religion, caste, guardian, address and status.",
    group: "Flash I – Input Data",
  },
  {
    endpoint: "iemis/teacher-master",
    title: "Teacher Master Data",
    description: "Active teachers with qualification, joining date, subjects taught and salary basis.",
    group: "Flash I – Input Data",
  },
  {
    endpoint: "iemis/infrastructure?format=csv",
    title: "Infrastructure Report",
    description: "Classrooms, toilets, water, electricity, internet, labs, library and accessibility (from Settings).",
    group: "Flash I – Input Data",
  },
  {
    endpoint: "iemis/flash-ii?format=csv",
    title: "Performance Indicators",
    description: "Students enrolled, attendance rate, exam participation, average GPA, pass rate, top and failing results.",
    group: "Flash II – Performance & Efficiency",
  },
  {
    endpoint: "iemis/enrollment-summary?format=csv",
    title: "Enrollment Summary",
    description: "Enrolled students by gender, batch / year, disability, ethnicity, religion and caste.",
    group: "Flash II – Performance & Efficiency",
  },
];

/** Reports that live inside each module. */
const MODULE_REPORTS: Array<{ title: string; description: string; href: string }> = [
  {
    title: "Accounting Reports",
    description: "Trial Balance, Balance Sheet, Income & Expenditure, Cash Flow, ledgers, fee and expense reports.",
    href: "/accounting?tab=reports",
  },
  {
    title: "Academic Management Reports",
    description: "Session / lesson plans, log books, syllabus completion, teacher performance, pending approvals.",
    href: "/academic-management-view?tab=reports",
  },
  {
    title: "Attendance Reports",
    description: "Student daily attendance summary, class-wise, student-wise, defaulters, absentee, leave and late.",
    href: "/attendance?tab=daily&view=reports",
  },
  {
    title: "Examination Results",
    description: "Published results, marksheets and the bulk Internal Assessment Report.",
    href: "/exams-view?section=college&exam=print-results",
  },
];

const pct = (value: number) => `${value.toFixed(value % 1 === 0 ? 0 : 2)}%`;

const CountTable = ({ title, rows, total }: { title: string; rows: CountRow[]; total: number }) => (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-sm">{title}</CardTitle>
    </CardHeader>
    <CardContent>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No data</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {rows.map((row) => (
            <li key={row.category}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-700">{row.category}</span>
                <span className="tabular-nums font-medium text-slate-900">
                  {row.count}
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    {total > 0 ? pct((row.count / total) * 100) : ""}
                  </span>
                </span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${total > 0 ? Math.min(100, (row.count / total) * 100) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </CardContent>
  </Card>
);

const INFRA_LABELS: Record<string, string> = {
  classrooms: "Classrooms",
  usableClassrooms: "Usable classrooms",
  toiletsMale: "Toilets (male)",
  toiletsFemale: "Toilets (female)",
  toiletsDisabled: "Toilets (disabled)",
  drinkingWater: "Drinking water",
  electricity: "Electricity",
  internet: "Internet",
  libraryBooks: "Library books",
  hasScienceLab: "Science lab",
  hasComputerLab: "Computer lab",
  hasPlayground: "Playground",
  hasRamp: "Ramp / accessibility",
  midDayMeal: "Mid-day meal",
};

export const ReportsPage = () => {
  const { user, activeSchoolId } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);
  const grantedReports = useCanAccessModule("reports");
  const canExport = hasInstitutionAccess(user?.role ?? "") || grantedReports;
  const institutionName = getPrintInstitutionBranding().name || "the institution";

  const analyticsQuery = useQuery({
    queryKey: ["reports-analytics", activeSchoolId],
    queryFn: () => unwrap<ReportsAnalytics>(api.get("/exports/analytics")),
    enabled: canExport && Boolean(activeSchoolId),
  });

  const downloadExport = async (endpoint: string, label: string) => {
    if (!activeSchoolId) {
      toast.error("Institution context is not available");
      return;
    }
    setLoading(endpoint);
    try {
      const response = await api.get(`/exports/${endpoint}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      const disposition = String(response.headers["content-disposition"] ?? "");
      const match = disposition.match(/filename="(.+)"/);
      link.setAttribute("download", match?.[1] ?? `${label.replace(/\s+/g, "_")}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`${label} downloaded`);
    } catch (error) {
      // A failed blob request carries the server's JSON message inside the blob
      let message = parseErrorMessage(error);
      const data = (error as { response?: { data?: unknown } })?.response?.data;
      if (data instanceof Blob) {
        try {
          message = (JSON.parse(await data.text()) as { message?: string }).message || message;
        } catch {
          /* keep the generic message */
        }
      }
      toast.error(message || `Failed to download ${label}`);
    } finally {
      setLoading(null);
    }
  };

  if (!canExport) {
    return (
      <div className="space-y-6">
        <PageHeader title="Reports & Analytics" />
        <Card>
          <CardContent className="py-10 text-center text-slate-600">
            This section is available to administrators and staff given Reports access.
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = analyticsQuery.data;
  const exportGroups = [...new Set(EXPORTS.map((item) => item.group))];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Reports & Analytics"
        description={`Key figures for ${institutionName}, official IEMIS / Flash Report exports, and links to every module's reports.`}
      />

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Analytics</h2>
          {data ? (
            <p className="text-xs text-slate-500">
              Academic year {data.academicYearBs} · as of {data.generatedAt}
            </p>
          ) : null}
        </div>

        {analyticsQuery.isLoading ? (
          <LoadingState />
        ) : analyticsQuery.isError || !data ? (
          <Card>
            <CardContent className="py-6 text-sm text-rose-600">
              {parseErrorMessage(analyticsQuery.error) || "Analytics could not be loaded."}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {[
                { label: "Students enrolled", value: data.students.enrolled, hint: `${data.students.allRecords} student records in total` },
                { label: "Teachers", value: data.staff.teachers, hint: "Active teachers" },
                { label: "Other staff", value: data.staff.otherStaff, hint: "Active non-teaching staff" },
                { label: "Attendance (30 days)", value: pct(data.attendance.last30DaysRate), hint: `Overall ${pct(data.attendance.overallRate)}` },
                { label: "Pass rate", value: pct(data.results.passRate), hint: `${data.results.passed} pass · ${data.results.failed} fail` },
                { label: "Average GPA", value: data.results.averageGpa.toFixed(2), hint: `${data.results.topPerformers} results with GPA 3.6+` },
              ].map((tile) => (
                <Card key={tile.label}>
                  <CardContent className="pt-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{tile.label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{tile.value}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{tile.hint}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <CountTable title="Enrolled students by batch / year" rows={data.students.byGroup} total={data.students.enrolled} />
              <CountTable title="Students by status" rows={data.students.byStatus} total={data.students.allRecords} />
              <CountTable title="Enrolled students by gender" rows={data.students.byGender} total={data.students.enrolled} />
              <CountTable title="By ethnicity" rows={data.students.byEthnicity} total={data.students.enrolled} />
              <CountTable title="By caste" rows={data.students.byCaste} total={data.students.enrolled} />
              <CountTable title="By religion" rows={data.students.byReligion} total={data.students.enrolled} />
              <CountTable title="By disability" rows={data.students.byDisability} total={data.students.enrolled} />
              <Card className="md:col-span-1 xl:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Infrastructure (from Settings)</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                    {Object.entries(INFRA_LABELS).map(([key, label]) => {
                      const value = data.infrastructure[key];
                      return (
                        <div key={key} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
                          <dt className="text-slate-600">{label}</dt>
                          <dd className="font-medium tabular-nums text-slate-900">
                            {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? 0)}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  <p className="mt-2 text-xs text-slate-500">
                    Update these in <Link to="/settings" className="text-brand-700 underline">Settings</Link>.
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Module reports</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {MODULE_REPORTS.map((item) => (
            <Card key={item.href}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-600">{item.description}</p>
                <Button asChild variant="outline" className="w-full">
                  <Link to={item.href}>Open</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {exportGroups.map((group) => (
        <section key={group} className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">IEMIS exports — {group}</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {EXPORTS.filter((item) => item.group === group).map((item) => (
              <Card key={item.endpoint}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{item.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-slate-600">{item.description}</p>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={Boolean(loading)}
                    onClick={() => void downloadExport(item.endpoint, item.title)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {loading === item.endpoint ? "Preparing…" : "Download CSV"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}

      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="pt-6 text-sm text-amber-800">
          <strong>Important:</strong> These exports follow the current IEMIS requirements from CEHRD. Always cross-check the
          latest data dictionary and upload templates on <strong>emis.cehrd.gov.np</strong>. Every export is recorded in the
          audit trail.
        </CardContent>
      </Card>
    </div>
  );
};
