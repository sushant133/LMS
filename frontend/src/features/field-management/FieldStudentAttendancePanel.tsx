import type { FieldDutyPortalSummary } from "@phit-erp/shared";
import { Hospital } from "lucide-react";
import { EmptyState } from "components/shared/EmptyState";
import { Badge } from "components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { postingTypeLabel, statusClass } from "./fieldUtils";

interface Props {
  data?: FieldDutyPortalSummary;
}

/** Read-only student Field Attendance view. */
export const FieldStudentAttendancePanel = ({ data }: Props) => {
  if (!data) {
    return (
      <EmptyState
        title="No field attendance"
        description="Your field posting attendance will appear here after your coordinator submits it."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Attendance %", value: `${data.attendancePercent}%` },
          { label: "Present", value: data.present },
          { label: "Absent", value: data.absent },
          { label: "Late", value: data.late },
          { label: "Leave", value: data.leave },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500">{c.label}</p>
              <p className="text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.postings && data.postings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My field postings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.postings.map((p) => (
              <div
                key={p.scheduleId}
                className="rounded-xl border border-slate-200 p-3 text-sm"
              >
                <p className="font-medium">
                  {p.siteName}{" "}
                  <span className="text-xs font-normal text-slate-500">
                    ({postingTypeLabel(p.postingType)})
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  Coordinator: {p.coordinatorName ?? "—"}
                  {p.startDateBs ? ` · ${p.startDateBs} → ${p.endDateBs}` : ""}
                  {" · "}
                  {p.attendancePercent}% ({p.present}/{p.total})
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Hospital className="h-4 w-4 text-brand-600" />
            Attendance history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.rows.length === 0 ? (
            <EmptyState
              title="No records yet"
              description="Field attendance history is read-only. Contact your field coordinator if something looks wrong."
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
                      <Td className="text-xs">{postingTypeLabel(row.postingType)}</Td>
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
    </div>
  );
};
