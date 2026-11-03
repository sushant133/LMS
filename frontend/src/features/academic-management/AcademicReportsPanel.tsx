import { useQuery } from "@tanstack/react-query";
import type {
  AcademicManagementFilters,
  AcademicReportResponse,
  AcademicReportType,
} from "@phit-erp/shared";
import { Download, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { LoadingState } from "components/shared/LoadingState";
import { useAuth } from "features/auth/AuthProvider";
import { printSimpleDocument } from "features/accounting/voucherPrint";
import { useIsCollege } from "hooks/useInstitutionType";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";
import { academicListApiParams } from "./academicManagementUtils";

/** Each report with a one-line note on what it shows and which filters it uses. */
const reportOptions: Array<{ id: AcademicReportType; label: string; hint: string }> = [
  { id: "session-plan", label: "Session Plan Report", hint: "Every session plan with units completed and status." },
  { id: "lesson-plan", label: "Lesson Plan Report", hint: "Lesson plans with planned / completed topics. Uses the Month filter." },
  { id: "teacher-lesson-plan", label: "Teacher-wise Lesson Plan", hint: "Lesson plans of the teacher selected in the filters." },
  { id: "teacher-log-book", label: "Teacher-wise Log Book", hint: "Classes logged by the selected teacher. Uses Month and the date range." },
  { id: "monthly-teaching", label: "Monthly Teaching Report", hint: "Classes taken per teacher and subject in each month. Uses Month and the date range." },
  { id: "subject-progress", label: "Subject Progress Report", hint: "Units completed, remaining and delayed per subject." },
  { id: "syllabus-completion", label: "Syllabus Completion Report", hint: "Every syllabus topic with its status and the subject's completion." },
  { id: "faculty-wise", label: "Faculty-wise Report", hint: "Session plans, teachers and average completion per faculty." },
  { id: "year-wise", label: "Year-wise Report", hint: "Session plans, lesson plans and log entries per academic year." },
  { id: "teacher-performance", label: "Teacher Performance Report", hint: "Average syllabus completion, delayed units and classes logged per teacher." },
  { id: "daily-teaching", label: "Daily Teaching Report", hint: "Classes logged on one day — the From date, or today." },
  { id: "pending-log-book", label: "Pending Log Book Report", hint: "Teachers who logged fewer classes than their timetable on one day — the From date, or today." },
  { id: "late-submission", label: "Late Submission Report", hint: "Lesson plan topics past their deadline and not completed." },
  { id: "pending-approvals", label: "Pending Approvals Report", hint: "Session and lesson plans waiting for approval." },
];

interface AcademicReportsPanelProps {
  filters: AcademicManagementFilters;
}

const cellText = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);

export const AcademicReportsPanel = ({
  filters,
}: AcademicReportsPanelProps) => {
  const isCollege = useIsCollege();
  const { user } = useAuth();
  const [reportType, setReportType] =
    useState<AcademicReportType>("session-plan");
  const [exporting, setExporting] = useState(false);

  const reportParams = useMemo(
    () => academicListApiParams(filters, { isCollege }),
    [filters, isCollege],
  );
  const option = reportOptions.find((item) => item.id === reportType);

  /** Teacher-wise reports need a teacher — a signed-in teacher is their own. */
  const needsTeacher =
    reportType === "teacher-lesson-plan" || reportType === "teacher-log-book";
  const missingTeacher =
    needsTeacher && !filters.teacherId && user?.role !== "TEACHER";

  const reportQuery = useQuery({
    queryKey: ["academic-management", "reports", reportType, reportParams],
    queryFn: () =>
      unwrap<AcademicReportResponse>(
        api.get(`/academic-management/reports/${reportType}`, {
          params: reportParams,
        }),
      ),
    enabled: !missingTeacher,
  });

  const report = reportQuery.data;
  const rows = report?.rows ?? [];
  const columns =
    report?.columns ??
    (rows[0] ? Object.keys(rows[0]).map((key) => ({ key, label: key })) : []);

  const downloadCsv = async () => {
    if (missingTeacher) {
      toast.error("Select a teacher in the filters for this report");
      return;
    }
    setExporting(true);
    try {
      const response = await api.get(
        `/academic-management/reports/${reportType}/export`,
        { params: reportParams, responseType: "blob" },
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${reportType}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Report exported");
    } catch (error) {
      toast.error(parseErrorMessage(error) || "Failed to export report");
    } finally {
      setExporting(false);
    }
  };

  const printReport = () => {
    if (!report || rows.length === 0) {
      toast.error("Nothing to print for the selected report and filters");
      return;
    }
    const escape = (value: string) =>
      value.replace(/[&<>"]/g, (ch) =>
        ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&quot;",
      );
    const head = columns.map((column) => `<th>${escape(column.label)}</th>`).join("");
    const body = rows
      .map(
        (row, index) =>
          `<tr><td>${index + 1}</td>${columns
            .map((column) => `<td>${escape(cellText(row[column.key]))}</td>`)
            .join("")}</tr>`,
      )
      .join("");
    const scope = [
      filters.academicYearBs ? `Academic year ${filters.academicYearBs}` : "",
      filters.faculty ? `Faculty ${filters.faculty}` : "",
      filters.month ? `Month ${filters.month}` : "",
      filters.dateFrom || filters.dateTo
        ? `Date ${filters.dateFrom || "…"} to ${filters.dateTo || "…"}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    printSimpleDocument({
      title: report.title,
      subtitle: [scope, `${rows.length} row${rows.length === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join(" · "),
      landscape: columns.length > 6,
      bodyHtml: `<table><thead><tr><th>S.N.</th>${head}</tr></thead><tbody>${body}</tbody></table>`,
    });
  };

  return (
    <div className="space-y-6" id="academic-print-area">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Reports</h2>
          <p className="text-sm text-slate-600">
            Academic planning and teaching reports for the active filters.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={reportType}
            onChange={(event) =>
              setReportType(event.target.value as AcademicReportType)
            }
            className="min-w-[240px]"
          >
            {reportOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            disabled={missingTeacher || rows.length === 0}
            onClick={printReport}
          >
            <Printer className="mr-2 h-4 w-4" />
            Print / PDF
          </Button>
          <Button
            variant="outline"
            disabled={missingTeacher || exporting}
            onClick={() => void downloadCsv()}
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{report?.title ?? option?.label ?? "Report Preview"}</CardTitle>
          {option ? (
            <p className="mt-1 text-sm text-slate-500">{option.hint}</p>
          ) : null}
        </CardHeader>
        <CardContent>
          {missingTeacher ? (
            <p className="text-sm text-slate-500">
              Select a teacher in the filters above to run this report.
            </p>
          ) : reportQuery.isLoading ? (
            <LoadingState />
          ) : reportQuery.isError ? (
            <p className="text-sm text-rose-600">
              {parseErrorMessage(reportQuery.error) ||
                "This report could not be generated. Check the active filters and try again."}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              No records found for the selected report and filters.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                {rows.length} row{rows.length === 1 ? "" : "s"}
              </p>
              <div className="max-h-[70vh] overflow-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <Th className="w-12">S.N.</Th>
                      {columns.map((column) => (
                        <Th key={column.key} className="whitespace-nowrap">
                          {column.label}
                        </Th>
                      ))}
                    </tr>
                  </TableHead>
                  <TableBody>
                    {rows.map((row, index) => (
                      <tr key={index}>
                        <Td className="text-slate-500">{index + 1}</Td>
                        {columns.map((column) => (
                          <Td key={column.key}>{cellText(row[column.key])}</Td>
                        ))}
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
