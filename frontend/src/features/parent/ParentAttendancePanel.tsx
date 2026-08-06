import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarCheck,
  ClipboardList,
  DoorOpen,
  Search,
  X,
} from "lucide-react";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { cn, parseErrorMessage } from "lib/utils";

type AttendanceStatus =
  | "PRESENT"
  | "ABSENT"
  | "LEAVE"
  | "LATE"
  | "MEDICAL_LEAVE"
  | "EARLY_LEAVE";

type AttendanceRow = {
  kind: "DAILY" | "SUBJECT";
  recordId: string;
  studentId: string;
  studentName: string;
  dateBs: string;
  status: AttendanceStatus | string;
  subjectName: string;
  periodNumber?: number;
  remarks?: string;
};

/** Dedicated early-leave records from StudentEarlyLeave (always kept even without daily sheet). */
type EarlyLeaveRow = {
  kind: "EARLY_LEAVE";
  recordId: string;
  studentId: string;
  studentName: string;
  dateBs: string;
  status: "EARLY_LEAVE" | string;
  subjectName: string;
  periodLabel?: string;
  leftAfterPeriod?: number;
  remarks?: string;
  reason?: string;
  leftAtTime?: string;
  approvedBy?: string;
  extraRemarks?: string;
};

type ChildSummary = {
  studentId: string;
  fullName: string;
  rollNumber?: number;
  admissionNumber?: string;
  attendanceRate: number;
  totalMarks: number;
  presentMarks: number;
  earlyLeaveCount?: number;
};

type ParentAttendanceResponse = {
  children: ChildSummary[];
  daily: AttendanceRow[];
  subject: AttendanceRow[];
  earlyLeave: EarlyLeaveRow[];
  filters?: {
    dateBs?: string;
    fromDateBs?: string;
    toDateBs?: string;
  };
};

const statusStyles: Record<string, string> = {
  PRESENT: "bg-emerald-100 text-emerald-800",
  ABSENT: "bg-rose-100 text-rose-800",
  LATE: "bg-amber-100 text-amber-800",
  LEAVE: "bg-sky-100 text-sky-800",
  MEDICAL_LEAVE: "bg-violet-100 text-violet-800",
  EARLY_LEAVE: "bg-orange-100 text-orange-900",
};

const StatusBadge = ({ status }: { status: string }) => (
  <Badge className={statusStyles[status] ?? "bg-slate-100 text-slate-700"}>
    {String(status).replace(/_/g, " ")}
  </Badge>
);

type Tab = "daily" | "subject" | "earlyLeave";

interface ParentAttendancePanelProps {
  /** When true, hide the page header (embedded in Parent Portal). */
  embedded?: boolean;
}

export const ParentAttendancePanel = ({
  embedded = false,
}: ParentAttendancePanelProps) => {
  const [tab, setTab] = useState<Tab>("daily");
  const [childFilter, setChildFilter] = useState("");
  /** Applied filters (sent to API) */
  const [fromDateBs, setFromDateBs] = useState("");
  const [toDateBs, setToDateBs] = useState("");
  const [exactDateBs, setExactDateBs] = useState("");
  /** Draft fields before Apply */
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [draftExact, setDraftExact] = useState("");
  /** Free-text search (date / subject / status / name) — client side */
  const [searchText, setSearchText] = useState("");

  const hasDateFilter = Boolean(exactDateBs || fromDateBs || toDateBs);

  const attendanceQuery = useQuery({
    queryKey: [
      "parent-children-attendance",
      exactDateBs,
      fromDateBs,
      toDateBs,
    ],
    queryFn: () => {
      const params: Record<string, string> = { limit: "200" };
      if (exactDateBs.trim()) {
        params.dateBs = exactDateBs.trim();
      } else {
        if (fromDateBs.trim()) params.fromDateBs = fromDateBs.trim();
        if (toDateBs.trim()) params.toDateBs = toDateBs.trim();
      }
      return unwrap<ParentAttendanceResponse>(
        api.get("/parent/attendance", { params }),
      );
    },
  });

  const data = attendanceQuery.data;
  const children = data?.children ?? [];

  const applyDateFilters = () => {
    // Exact date takes priority when set
    if (draftExact.trim()) {
      setExactDateBs(draftExact.trim());
      setFromDateBs("");
      setToDateBs("");
      return;
    }
    if (draftFrom && draftTo && draftFrom > draftTo) {
      // keep as-is; API will also reject — show soft client message via empty
      setFromDateBs(draftFrom);
      setToDateBs(draftTo);
      setExactDateBs("");
      return;
    }
    setExactDateBs("");
    setFromDateBs(draftFrom.trim());
    setToDateBs(draftTo.trim());
  };

  const clearDateFilters = () => {
    setDraftExact("");
    setDraftFrom("");
    setDraftTo("");
    setExactDateBs("");
    setFromDateBs("");
    setToDateBs("");
    setSearchText("");
  };

  const filterAttendanceRows = (rows: AttendanceRow[]) => {
    let next = rows;
    if (childFilter) {
      next = next.filter((r) => r.studentId === childFilter);
    }
    const q = searchText.trim().toLowerCase();
    if (q) {
      next = next.filter((r) => {
        const hay = [
          r.dateBs,
          r.studentName,
          r.subjectName,
          r.status,
          r.remarks ?? "",
          r.periodNumber != null ? String(r.periodNumber) : "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return next;
  };

  const filterEarlyLeaveRows = (rows: EarlyLeaveRow[]) => {
    let next = rows;
    if (childFilter) {
      next = next.filter((r) => r.studentId === childFilter);
    }
    const q = searchText.trim().toLowerCase();
    if (q) {
      next = next.filter((r) => {
        const hay = [
          r.dateBs,
          r.studentName,
          r.periodLabel ?? r.subjectName,
          r.status,
          r.reason ?? r.remarks ?? "",
          r.leftAtTime ?? "",
          r.approvedBy ?? "",
          r.extraRemarks ?? "",
          r.leftAfterPeriod != null ? String(r.leftAfterPeriod) : "",
          "early leave",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return next;
  };

  const dailyRows = useMemo(
    () => filterAttendanceRows(data?.daily ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closes over childFilter/searchText
    [data?.daily, childFilter, searchText],
  );

  const subjectRows = useMemo(
    () => filterAttendanceRows(data?.subject ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.subject, childFilter, searchText],
  );

  const earlyLeaveRows = useMemo(
    () => filterEarlyLeaveRows(data?.earlyLeave ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.earlyLeave, childFilter, searchText],
  );

  const filterSummary = useMemo(() => {
    if (exactDateBs) return `Date: ${exactDateBs}`;
    if (fromDateBs || toDateBs) {
      return `From ${fromDateBs || "…"} to ${toDateBs || "…"}`;
    }
    return null;
  }, [exactDateBs, fromDateBs, toDateBs]);

  const tabTitle =
    tab === "daily"
      ? "Daily attendance"
      : tab === "subject"
        ? "Subject-wise attendance"
        : "Early leave records";

  if (attendanceQuery.isLoading) {
    return <LoadingState />;
  }

  if (attendanceQuery.isError) {
    return (
      <EmptyState
        title="Could not load attendance"
        description={
          parseErrorMessage(attendanceQuery.error) ||
          "Please try again, or contact the college if this continues."
        }
      />
    );
  }

  if (children.length === 0) {
    return (
      <EmptyState
        title="No linked children"
        description="Ask the college administrator to link your parent account to your child’s student profile. After linking, daily attendance, subject attendance, and early leave records will appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      {!embedded ? (
        <PageHeader
          title="Student attendance"
          description="View your children’s daily attendance, subject-wise attendance, and early leave records. Filter by date range or search by date, subject, status, or reason."
        />
      ) : (
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Student attendance
          </h2>
          <p className="text-sm text-slate-500">
            Daily, subject-wise, and early leave records for your linked
            children. Use date filters or search below.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {children.map((child) => (
          <Card key={child.studentId} className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{child.fullName}</CardTitle>
              <p className="text-xs text-slate-500">
                {child.admissionNumber
                  ? `Adm. ${child.admissionNumber}`
                  : null}
                {child.rollNumber != null ? ` · Roll ${child.rollNumber}` : null}
              </p>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="text-slate-500">
                Attendance rate
                {hasDateFilter ? " (filtered)" : ""}
              </p>
              <p className="text-2xl font-semibold text-slate-900">
                {child.attendanceRate}%
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {child.presentMarks} present / late of {child.totalMarks}{" "}
                marked sessions
              </p>
              {(child.earlyLeaveCount ?? 0) > 0 ? (
                <p className="mt-2 text-xs font-medium text-orange-800">
                  {child.earlyLeaveCount} early leave
                  {child.earlyLeaveCount === 1 ? "" : "s"}
                  {hasDateFilter ? " in this range" : " on record"}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Date filters */}
      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filter by date</CardTitle>
          <p className="text-xs text-slate-500">
            Choose a single BS date, or a from–to range. Exact date overrides
            the range when both are set.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Exact date (BS)">
              <NepaliDateField
                value={draftExact}
                onChange={(v) => {
                  setDraftExact(v);
                  if (v) {
                    setDraftFrom("");
                    setDraftTo("");
                  }
                }}
                placeholder="Single day"
              />
            </FormField>
            <FormField label="From date (BS)">
              <NepaliDateField
                value={draftFrom}
                onChange={(v) => {
                  setDraftFrom(v);
                  if (v) setDraftExact("");
                }}
                placeholder="Range start"
              />
            </FormField>
            <FormField label="To date (BS)">
              <NepaliDateField
                value={draftTo}
                onChange={(v) => {
                  setDraftTo(v);
                  if (v) setDraftExact("");
                }}
                placeholder="Range end"
              />
            </FormField>
            <FormField label="Search">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Date, subject, status, reason…"
                />
              </div>
            </FormField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={applyDateFilters}>
              Apply date filter
            </Button>
            {hasDateFilter || searchText ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={clearDateFilters}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Clear filters
              </Button>
            ) : null}
            {filterSummary ? (
              <Badge className="bg-sky-100 text-sky-900">{filterSummary}</Badge>
            ) : null}
            {attendanceQuery.isFetching ? (
              <span className="text-xs text-slate-500">Updating…</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={tab === "daily" ? "default" : "outline"}
            onClick={() => setTab("daily")}
          >
            <CalendarCheck className="mr-1.5 h-4 w-4" />
            Daily attendance
            <span className="ml-1.5 tabular-nums text-xs opacity-80">
              ({dailyRows.length})
            </span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "subject" ? "default" : "outline"}
            onClick={() => setTab("subject")}
          >
            <ClipboardList className="mr-1.5 h-4 w-4" />
            Subject-wise
            <span className="ml-1.5 tabular-nums text-xs opacity-80">
              ({subjectRows.length})
            </span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "earlyLeave" ? "default" : "outline"}
            onClick={() => setTab("earlyLeave")}
          >
            <DoorOpen className="mr-1.5 h-4 w-4" />
            Early leave
            <span className="ml-1.5 tabular-nums text-xs opacity-80">
              ({earlyLeaveRows.length})
            </span>
          </Button>
        </div>
        {children.length > 1 ? (
          <div className="min-w-[12rem]">
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Child
            </label>
            <Select
              value={childFilter}
              onChange={(e) => setChildFilter(e.target.value)}
            >
              <option value="">All children</option>
              {children.map((c) => (
                <option key={c.studentId} value={c.studentId}>
                  {c.fullName}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {tabTitle}
            {filterSummary ? (
              <span className="ml-2 text-sm font-normal text-slate-500">
                · {filterSummary}
              </span>
            ) : null}
          </CardTitle>
          {tab === "earlyLeave" ? (
            <p className="text-xs text-slate-500">
              Official early leave records kept for your child — when they left
              campus before the end of the day, including reason and time.
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {tab === "earlyLeave" ? (
            earlyLeaveRows.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-slate-500">
                No early leave records
                {hasDateFilter || searchText
                  ? " match your date filter or search."
                  : " yet for your linked children."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[720px]">
                  <TableHead>
                    <tr>
                      <Th>Date (BS)</Th>
                      <Th>Student</Th>
                      <Th>Left after</Th>
                      <Th>Time</Th>
                      <Th>Status</Th>
                      <Th>Reason</Th>
                      <Th>Approved by</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {earlyLeaveRows.map((row, index) => (
                      <tr
                        key={`early-${row.recordId}-${row.studentId}-${index}`}
                        className="bg-orange-50/40"
                      >
                        <Td className="whitespace-nowrap font-medium">
                          {row.dateBs}
                        </Td>
                        <Td>{row.studentName}</Td>
                        <Td>
                          {row.periodLabel || row.subjectName || "Early leave"}
                        </Td>
                        <Td className="whitespace-nowrap tabular-nums">
                          {row.leftAtTime || "—"}
                        </Td>
                        <Td>
                          <StatusBadge status="EARLY_LEAVE" />
                        </Td>
                        <Td className="max-w-[14rem]">
                          <span className="line-clamp-2 text-slate-700">
                            {row.reason || row.remarks || "—"}
                          </span>
                          {row.extraRemarks ? (
                            <span className="mt-0.5 block text-xs text-slate-500 line-clamp-1">
                              {row.extraRemarks}
                            </span>
                          ) : null}
                        </Td>
                        <Td className="text-slate-600">
                          {row.approvedBy || "—"}
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : dailyRows.length === 0 && tab === "daily" ? (
            <p className="px-6 pb-6 text-sm text-slate-500">
              No daily records
              {hasDateFilter || searchText
                ? " match your date filter or search."
                : " yet for your linked children."}
            </p>
          ) : subjectRows.length === 0 && tab === "subject" ? (
            <p className="px-6 pb-6 text-sm text-slate-500">
              No subject-wise records
              {hasDateFilter || searchText
                ? " match your date filter or search."
                : " yet for your linked children."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHead>
                  <tr>
                    <Th>Date (BS)</Th>
                    <Th>Student</Th>
                    <Th>
                      {tab === "daily" ? "Session / subject" : "Subject"}
                    </Th>
                    {tab === "daily" ? <Th>Period</Th> : null}
                    <Th>Status</Th>
                    {tab === "daily" ? <Th>Remarks</Th> : null}
                  </tr>
                </TableHead>
                <TableBody>
                  {(tab === "daily" ? dailyRows : subjectRows).map(
                    (row, index) => (
                      <tr
                        key={`${row.kind}-${row.recordId}-${row.studentId}-${index}`}
                        className={cn(
                          row.status === "ABSENT" && "bg-rose-50/40",
                          row.status === "EARLY_LEAVE" && "bg-orange-50/40",
                        )}
                      >
                        <Td className="whitespace-nowrap font-medium">
                          {row.dateBs}
                        </Td>
                        <Td>{row.studentName}</Td>
                        <Td>{row.subjectName}</Td>
                        {tab === "daily" ? (
                          <Td className="tabular-nums">
                            {row.periodNumber ?? "—"}
                          </Td>
                        ) : null}
                        <Td>
                          <StatusBadge status={row.status} />
                        </Td>
                        {tab === "daily" ? (
                          <Td className="max-w-[12rem] truncate text-slate-600">
                            {row.remarks || "—"}
                          </Td>
                        ) : null}
                      </tr>
                    ),
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
