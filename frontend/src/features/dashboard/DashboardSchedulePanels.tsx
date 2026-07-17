import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExamRecord, ExamRoutineRecord } from "@phit-erp/shared";
import { BookOpen, CalendarDays, ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { WeeklyTimetableGrid } from "features/timetable/WeeklyTimetableGrid";
import {
  buildWeeklyMatrix,
  idOf,
  nameOf,
  type TimetableSlotRow,
} from "features/timetable/timetableMatrixUtils";
import { useAuth } from "features/auth/AuthProvider";
import { useIsCollege } from "hooks/useInstitutionType";
import { api, unwrap } from "lib/api";

type YearOption = { _id: string; name: string; batchId?: string; level?: number };
type BatchOption = { _id: string; name: string };

const isProgramYear = (year: YearOption) => {
  if ((year.name ?? "").toLowerCase() === "ended") return false;
  if (year.level != null && year.level >= 4) return false;
  return true;
};

/**
 * Dashboard widgets: class weekly timetable + exam routine tables.
 * - Admin / teacher / staff: all batches/years (filterable)
 * - Student: only their enrolled batch/year (API-scoped)
 */
export const DashboardSchedulePanels = () => {
  const { user } = useAuth();
  const isCollege = useIsCollege();
  const isStudent = user?.role === "STUDENT";
  const isParent = user?.role === "PARENT";
  const canBrowseAll = !isStudent && !isParent;

  const [batchFilter, setBatchFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");

  const batchesQuery = useQuery({
    queryKey: ["batches", "dashboard-schedule"],
    queryFn: () => unwrap<BatchOption[]>(api.get("/academics/batches")),
    enabled: canBrowseAll && isCollege,
    staleTime: 60_000,
  });

  const yearsQuery = useQuery({
    queryKey: ["years", "dashboard-schedule", batchFilter],
    queryFn: () =>
      unwrap<YearOption[]>(
        api.get("/academics/years", {
          params: batchFilter ? { batchId: batchFilter } : undefined,
        }),
      ),
    enabled: canBrowseAll && isCollege,
    staleTime: 60_000,
  });

  const timetableParams = useMemo(() => {
    if (isStudent || isParent) return undefined;
    const params: Record<string, string> = {};
    if (isCollege) {
      if (batchFilter) params.batchId = batchFilter;
      if (yearFilter) params.yearId = yearFilter;
    }
    return Object.keys(params).length ? params : undefined;
  }, [batchFilter, isCollege, isParent, isStudent, yearFilter]);

  const timetableQuery = useQuery({
    queryKey: ["timetable", "dashboard", timetableParams, user?.role],
    queryFn: () =>
      unwrap<TimetableSlotRow[]>(
        api.get("/timetable", { params: timetableParams }),
      ),
    enabled: Boolean(user),
    staleTime: 60_000,
  });

  const routinesQuery = useQuery({
    queryKey: ["exam-routines", "dashboard", yearFilter, user?.role],
    queryFn: () =>
      unwrap<
        Array<
          ExamRoutineRecord & {
            subjectName?: string;
            yearName?: string;
            batchName?: string;
            examId: string;
          }
        >
      >(
        api.get("/exams/routines", {
          params: yearFilter && canBrowseAll ? { yearId: yearFilter } : undefined,
        }),
      ),
    enabled: Boolean(user),
    staleTime: 60_000,
  });

  const examsQuery = useQuery({
    queryKey: ["exams", "dashboard-routine-labels"],
    queryFn: () => unwrap<ExamRecord[]>(api.get("/exams")),
    enabled: Boolean(user),
    staleTime: 60_000,
  });

  const slots = timetableQuery.data ?? [];
  const routines = routinesQuery.data ?? [];
  const exams = examsQuery.data ?? [];
  const examNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const exam of exams) {
      map.set(exam._id, exam.name);
    }
    return map;
  }, [exams]);

  const batches = batchesQuery.data ?? [];
  const years = useMemo(
    () =>
      (yearsQuery.data ?? [])
        .filter(isProgramYear)
        .sort((a, b) => (a.level ?? 0) - (b.level ?? 0)),
    [yearsQuery.data],
  );

  const timetableTables = useMemo(() => {
    if (isStudent || isParent || !isCollege) {
      const title = isStudent
        ? "My class timetable"
        : isParent
          ? "Linked children timetable"
          : "Weekly timetable";
      return [
        {
          key: "scope",
          title,
          slots,
        },
      ];
    }

    // Group by batch + year for admin/teacher/staff
    const byKey = new Map<
      string,
      { title: string; slots: TimetableSlotRow[]; level: number }
    >();

    for (const slot of slots) {
      const batchId = idOf(slot.batchId);
      const yearId = idOf(slot.yearId);
      const key = `${batchId || "b"}-${yearId || "y"}`;
      const batchName = nameOf(slot.batchId, "");
      const yearName = nameOf(slot.yearId, "Year");
      const title =
        batchName && yearName
          ? `${yearName} · ${batchName}`
          : yearName || batchName || "Timetable";
      const existing = byKey.get(key);
      if (existing) {
        existing.slots.push(slot);
      } else {
        const yearMeta = years.find((y) => y._id === yearId);
        byKey.set(key, {
          title,
          slots: [slot],
          level: yearMeta?.level ?? 99,
        });
      }
    }

    // Prefer known year order when filter empty — show empty years only if no slots at all
    if (byKey.size === 0 && years.length > 0) {
      return years.map((y) => {
        const batch = batches.find((b) => b._id === (y.batchId ?? batchFilter));
        return {
          key: y._id,
          title: batch ? `${y.name} · ${batch.name}` : y.name,
          slots: [] as TimetableSlotRow[],
        };
      });
    }

    return Array.from(byKey.entries())
      .map(([key, value]) => ({ key, title: value.title, slots: value.slots, level: value.level }))
      .sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));
  }, [batchFilter, batches, isCollege, isParent, isStudent, slots, years]);

  const routineTables = useMemo(() => {
    const byYear = new Map<
      string,
      {
        title: string;
        level: number;
        rows: Array<
          ExamRoutineRecord & {
            subjectName?: string;
            yearName?: string;
            examId: string;
          }
        >;
      }
    >();

    for (const row of routines) {
      const yid = row.yearId || "__all__";
      const title =
        row.yearName ||
        (isStudent ? "My exam routine" : "Exam routine");
      const existing = byYear.get(yid);
      if (existing) {
        existing.rows.push(row);
      } else {
        byYear.set(yid, {
          title,
          level: row.yearLevel ?? 99,
          rows: [row],
        });
      }
    }

    return Array.from(byYear.entries())
      .map(([key, value]) => ({
        key,
        title: value.title,
        rows: [...value.rows].sort((a, b) =>
          a.examDateBs === b.examDateBs
            ? a.startTime.localeCompare(b.startTime)
            : a.examDateBs.localeCompare(b.examDateBs),
        ),
        level: value.level,
      }))
      .sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));
  }, [isStudent, routines]);

  const loading = timetableQuery.isLoading || routinesQuery.isLoading;

  if (loading) {
    return (
      <Card className="border-slate-200/80 shadow-sm">
        <CardContent className="py-8">
          <LoadingState />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters for institution-wide view */}
      {canBrowseAll && isCollege ? (
        <Card className="border-slate-200/80 shadow-sm">
          <CardContent className="flex flex-wrap items-end gap-3 py-4">
            <div className="min-w-[10rem]">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Batch
              </p>
              <Select
                value={batchFilter}
                onChange={(e) => {
                  setBatchFilter(e.target.value);
                  setYearFilter("");
                }}
              >
                <option value="">All batches</option>
                {batches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-[10rem]">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Year
              </p>
              <Select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
              >
                <option value="">All years</option>
                {years
                  .filter((y) => !batchFilter || y.batchId === batchFilter)
                  .map((y) => (
                    <option key={y._id} value={y._id}>
                      {y.name}
                    </option>
                  ))}
              </Select>
            </div>
            <p className="text-xs text-slate-500">
              Showing class timetables and exam routines for the selected scope.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Class timetable */}
      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-brand-700" />
            {isStudent ? "My class timetable" : "Class timetable"}
          </CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link to="/timetable">
              <BookOpen className="mr-1.5 h-4 w-4" />
              Open full timetable
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {timetableTables.every((t) => t.slots.length === 0) ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              {isStudent
                ? "Your year timetable has not been published yet."
                : "No class timetable slots found for this scope."}
            </p>
          ) : (
            timetableTables.map((table) => {
              if (table.slots.length === 0) return null;
              const matrix = buildWeeklyMatrix(table.slots, {
                saturdayIsHoliday: true,
              });
              return (
                <div key={table.key} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {table.title}
                    </h3>
                    <Badge className="bg-slate-100 text-slate-700">
                      {table.slots.length} period
                      {table.slots.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <WeeklyTimetableGrid matrix={matrix} compact />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Exam routine */}
      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-brand-700" />
            {isStudent ? "My exam routine" : "Exam routine"}
          </CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link to="/exams">Open exams</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {routineTables.length === 0 ||
          routineTables.every((t) => t.rows.length === 0) ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              {isStudent
                ? "No published exam routine for your batch/year yet."
                : "No exam routine rows found for this scope."}
            </p>
          ) : (
            routineTables.map((table) => (
              <div key={table.key} className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  {table.title}
                </h3>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <Table>
                    <TableHead>
                      <tr>
                        <Th>Exam</Th>
                        <Th>Date (BS)</Th>
                        <Th>Day</Th>
                        <Th>Subject</Th>
                        <Th>Time</Th>
                        <Th>Hall</Th>
                        <Th>Invigilator</Th>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {table.rows.map((row) => (
                        <tr key={row._id}>
                          <Td className="text-xs font-medium text-slate-700">
                            {examNameById.get(row.examId) ?? "Exam"}
                          </Td>
                          <Td className="whitespace-nowrap text-sm">
                            {row.examDateBs}
                          </Td>
                          <Td className="text-sm">{row.day}</Td>
                          <Td className="text-sm font-medium">
                            {row.subjectName ?? "Subject"}
                            {row.subjectCode ? (
                              <span className="ml-1 text-xs text-slate-500">
                                ({row.subjectCode})
                              </span>
                            ) : null}
                          </Td>
                          <Td className="whitespace-nowrap text-sm">
                            {row.startTime}–{row.endTime}
                          </Td>
                          <Td className="text-sm">{row.examHall || "—"}</Td>
                          <Td className="text-sm">{row.invigilator || "—"}</Td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};
