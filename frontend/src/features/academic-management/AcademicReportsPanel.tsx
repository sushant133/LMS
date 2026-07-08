import { useQuery } from "@tanstack/react-query";
import type { AcademicManagementFilters, AcademicReportResponse, AcademicReportType } from "@phit-erp/shared";
import { Download, FileBarChart } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { LoadingState } from "components/shared/LoadingState";
import { api, resolveApiUrl, unwrap } from "lib/api";
import { filtersToParams } from "./academicManagementUtils";

const reportOptions: Array<{ id: AcademicReportType; label: string }> = [
  { id: "session-plan", label: "Session Plan Report" },
  { id: "lesson-plan", label: "Lesson Plan Report" },
  { id: "teacher-lesson-plan", label: "Teacher-wise Lesson Plan" },
  { id: "teacher-log-book", label: "Teacher-wise Log Book" },
  { id: "monthly-teaching", label: "Monthly Teaching Report" },
  { id: "subject-progress", label: "Subject Progress Report" },
  { id: "syllabus-completion", label: "Syllabus Completion Report" },
  { id: "faculty-wise", label: "Faculty-wise Report" },
  { id: "year-wise", label: "Year-wise Report" },
  { id: "teacher-performance", label: "Teacher Performance Report" },
  { id: "daily-teaching", label: "Daily Teaching Report" },
  { id: "pending-log-book", label: "Pending Log Book Report" },
  { id: "late-submission", label: "Late Submission Report" },
  { id: "pending-approvals", label: "Pending Approvals Report" }
];

interface AcademicReportsPanelProps {
  filters: AcademicManagementFilters;
}

export const AcademicReportsPanel = ({ filters }: AcademicReportsPanelProps) => {
  const [reportType, setReportType] = useState<AcademicReportType>("session-plan");

  const reportQuery = useQuery({
    queryKey: ["academic-management", "reports", reportType, filters],
    queryFn: () =>
      unwrap<AcademicReportResponse>(
        api.get(`/academic-management/reports/${reportType}`, { params: filtersToParams(filters) })
      )
  });

  const downloadCsv = async () => {
    try {
      const response = await api.get(`/academic-management/reports/${reportType}/export`, {
        params: filtersToParams(filters),
        responseType: "blob"
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${reportType}_${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Report exported");
    } catch {
      toast.error("Failed to export report");
    }
  };

  const rows = reportQuery.data?.rows ?? [];
  const firstRow = rows[0];
  const headers = firstRow ? Object.keys(firstRow) : [];

  return (
    <div className="space-y-6" id="academic-print-area">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Reports</h2>
          <p className="text-sm text-slate-600">Generate academic planning and teaching documentation reports using the active filters.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={reportType} onChange={(event) => setReportType(event.target.value as AcademicReportType)} className="min-w-[240px]">
            {reportOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
          <Button variant="outline" onClick={() => void downloadCsv()}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={() => window.open(resolveApiUrl(`/academic-management/reports/${reportType}/export?${new URLSearchParams(filtersToParams(filters)).toString()}`), "_blank")}>
            <FileBarChart className="mr-2 h-4 w-4" />
            Open Export
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{reportQuery.data?.title ?? "Report Preview"}</CardTitle>
        </CardHeader>
        <CardContent>
          {reportQuery.isLoading ? (
            <LoadingState />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No records found for the selected report and filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    {headers.map((header) => (
                      <Th key={header}>{header}</Th>
                    ))}
                  </tr>
                </TableHead>
                <TableBody>
                  {rows.slice(0, 100).map((row, index) => (
                    <tr key={index}>
                      {headers.map((header) => (
                        <Td key={header}>{String(row[header] ?? "")}</Td>
                      ))}
                    </tr>
                  ))}
                </TableBody>
              </Table>
              {rows.length > 100 ? <p className="mt-2 text-xs text-slate-500">Showing first 100 of {rows.length} rows. Export CSV for the full report.</p> : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};