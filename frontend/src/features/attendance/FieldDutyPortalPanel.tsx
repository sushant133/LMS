import { useQuery } from "@tanstack/react-query";
import type { FieldDutyPortalSummary } from "@phit-erp/shared";
import { Hospital } from "lucide-react";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { LoadingState } from "components/shared/LoadingState";
import { EmptyState } from "components/shared/EmptyState";
import { api, unwrap } from "lib/api";

const statusClass = (status: string) => {
  switch (status) {
    case "PRESENT":
    case "EMERGENCY_DUTY":
      return "bg-emerald-100 text-emerald-800";
    case "ABSENT":
      return "bg-rose-100 text-rose-800";
    case "LATE":
      return "bg-amber-100 text-amber-900";
    case "LEAVE":
      return "bg-sky-100 text-sky-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

interface FieldDutyPortalPanelProps {
  /** Parent portal: pass child student id. Student portal: omit (uses /portal/me). */
  studentId?: string;
  title?: string;
}

export const FieldDutyPortalPanel = ({
  studentId,
  title = "Field Attendance (Community / PHC / Hospital)",
}: FieldDutyPortalPanelProps) => {
  const query = useQuery({
    queryKey: ["field-duty", "portal", studentId ?? "me"],
    queryFn: () =>
      unwrap<FieldDutyPortalSummary>(
        studentId
          ? api.get(`/field-duty/portal/child/${studentId}`)
          : api.get("/field-duty/portal/me"),
      ),
  });

  if (query.isLoading) return <LoadingState />;

  const data = query.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Hospital className="h-4 w-4 text-brand-600" />
          {title}
        </CardTitle>
        {data ? (
          <p className="text-sm text-slate-600">
            Attendance rate:{" "}
            <span className="font-semibold text-slate-900">
              {data.attendancePercent}%
            </span>{" "}
            · Present {data.present} · Absent {data.absent} · Late {data.late} ·
            Leave {data.leave}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        {!data || data.rows.length === 0 ? (
          <EmptyState
            title="No field attendance records"
            description="Community/PHC or Hospital posting attendance will appear here when the field coordinator submits it."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <tr>
                  <Th>Date</Th>
                  <Th>Posting</Th>
                  <Th>Type</Th>
                  <Th>Coordinator</Th>
                  <Th>Status</Th>
                  <Th>Remarks</Th>
                </tr>
              </TableHead>
              <TableBody>
                {data.rows.map((row) => (
                  <tr key={row._id}>
                    <Td className="whitespace-nowrap text-sm">{row.dateBs}</Td>
                    <Td className="text-sm">{row.siteName || row.hospitalName}</Td>
                    <Td className="text-xs">
                      {(row.postingType || "HOSPITAL").replace(/_/g, " ")}
                      {row.department ? ` · ${row.department}` : ""}
                    </Td>
                    <Td className="text-sm">{row.supervisorName ?? "—"}</Td>
                    <Td>
                      <Badge className={statusClass(row.status)}>
                        {row.status.replace(/_/g, " ")}
                      </Badge>
                    </Td>
                    <Td className="text-sm">{row.remarks || "—"}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
