import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasInstitutionAccess } from "@phit-erp/shared";
import { useAuth } from "features/auth/AuthProvider";
import { api } from "lib/api";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { PageHeader } from "components/shared/PageHeader";
import { toast } from "sonner";

export const ReportsPage = () => {
  const { t } = useTranslation();
  const { user, activeSchoolId } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);

  const canExport = hasInstitutionAccess(user?.role ?? "");

  const downloadExport = async (endpoint: string, label: string) => {
    if (!activeSchoolId) {
      toast.error("Institution context is not available");
      return;
    }

    setLoading(endpoint);
    try {
      const response = await api.get(`/exports/${endpoint}`, {
        responseType: "blob"
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;

      const disposition = response.headers["content-disposition"];
      let filename = `${label.replace(/\s+/g, "_")}_${Date.now()}.csv`;
      if (disposition) {
        const match = disposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }

      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      toast.success(`${label} downloaded successfully`);
    } catch (error: any) {
      toast.error(error?.message || `Failed to download ${label}`);
    } finally {
      setLoading(null);
    }
  };

  if (!canExport) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("reports") || "Reports & IEMIS Compliance"} />
        <Card>
          <CardContent className="py-10 text-center text-slate-600">
            This section is only available to College Administrators and System Administrators.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("reports") || "Reports & IEMIS Compliance"}
        description={
          hasInstitutionAccess(user?.role ?? "")
            ? "Official IEMIS & Flash Report exports for Public Himal Institute of Technology. Use these for mandatory government submissions."
            : "Generate official IEMIS & Flash Report exports for Public Himal Institute of Technology."
        }
      />

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Academic Management</h2>
        <Card>
          <CardHeader>
            <CardTitle>Teaching Documentation Reports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <p>
              Session plans, lesson plans, log books, syllabus completion, teacher performance, pending approvals, and late submission reports are available inside the Academic Management module.
            </p>
            <Button asChild>
              <Link to="/academic-management">Open Academic Management Reports</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Flash I - Core Data */}
      <div>
        <h2 className="text-lg font-semibold mb-3 text-slate-800">Flash I – Input Data</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Student Master */}
          <Card className="border-brand-100">
            <CardHeader>
              <CardTitle className="text-brand-800">Student Master Data</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">Full student roster with disability, ethnicity, and guardian details.</p>
              <Button
                onClick={() => downloadExport("iemis/student-master", "IEMIS_Student_Master")}
                disabled={!!loading}
                className="w-full"
              >
                {loading === "iemis/student-master" ? "Generating..." : "Download Student Master (CSV)"}
              </Button>
            </CardContent>
          </Card>

          {/* Teacher Master - NEW */}
          <Card>
            <CardHeader>
              <CardTitle>Teacher Master Data</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">Teacher qualifications, subjects taught, and salary data for staffing reports.</p>
              <Button
                variant="outline"
                onClick={() => downloadExport("iemis/teacher-master", "IEMIS_Teacher_Master")}
                disabled={!!loading}
                className="w-full"
              >
                {loading === "iemis/teacher-master" ? "Generating..." : "Download Teacher Master (CSV)"}
              </Button>
            </CardContent>
          </Card>

          {/* Infrastructure - NEW */}
          <Card>
            <CardHeader>
              <CardTitle>Infrastructure Report</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">Classrooms, WASH facilities, labs, accessibility, and mid-day meal status.</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => downloadExport("iemis/infrastructure", "IEMIS_Infrastructure")}
                  disabled={!!loading}
                  className="flex-1"
                >
                  {loading === "iemis/infrastructure" ? "..." : "JSON"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => downloadExport("iemis/infrastructure?format=csv", "IEMIS_Infrastructure")}
                  disabled={!!loading}
                  className="flex-1"
                >
                  {loading === "iemis/infrastructure?format=csv" ? "..." : "CSV"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Flash II - Performance */}
      <div>
        <h2 className="text-lg font-semibold mb-3 text-slate-800">Flash II – Performance & Efficiency</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Performance Indicators</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                Average attendance, GPA, exam participation, estimated promotion rate, and identification of low performers.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => downloadExport("iemis/flash-ii", "IEMIS_Flash_II")}
                  disabled={!!loading}
                  className="flex-1"
                >
                  {loading === "iemis/flash-ii" ? "Generating..." : "JSON"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => downloadExport("iemis/flash-ii?format=csv", "IEMIS_Flash_II")}
                  disabled={!!loading}
                  className="flex-1"
                >
                  {loading === "iemis/flash-ii?format=csv" ? "..." : "CSV"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Enrollment Summary (Legacy)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">Gender, class, disability, and ethnicity aggregates (original export).</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => downloadExport("iemis/enrollment-summary", "IEMIS_Enrollment")}
                  disabled={!!loading}
                  className="flex-1"
                >
                  JSON
                </Button>
                <Button
                  variant="outline"
                  onClick={() => downloadExport("iemis/enrollment-summary?format=csv", "IEMIS_Enrollment")}
                  disabled={!!loading}
                  className="flex-1"
                >
                  CSV
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="pt-6 text-sm text-amber-800">
          <strong>Important:</strong> These exports are aligned with current IEMIS requirements from CEHRD. 
          Always cross-check the latest data dictionary and upload templates on <strong>emis.cehrd.gov.np</strong>. 
          All exports are logged in the audit trail for accountability.
        </CardContent>
      </Card>
    </div>
  );
};
