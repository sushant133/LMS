import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Printer,
  Users,
} from "lucide-react";
import type {
  AttendanceRegisterCellDetail,
  AttendanceRegisterResponse,
  AttendanceRegisterTab,
  BatchRecord,
  ClassRecord,
  SectionRecord,
  YearRecord,
} from "@phit-erp/shared";
import { toast } from "sonner";
import { PageHeader } from "components/shared/PageHeader";
import { LoadingState } from "components/shared/LoadingState";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { useIsCollege } from "hooks/useInstitutionType";
import {
  filterSectionsByClass,
  filterYearsByBatch,
  getAcademicLabels,
} from "lib/academicStructureUtils";
import { api, unwrap } from "lib/api";
import { useAuth } from "features/auth/AuthProvider";
import { appConfig } from "lib/config";
import { cn, parseErrorMessage } from "lib/utils";
import {
  buildRegisterCsv,
  cellClass,
  downloadAttendanceRegisterPdf,
  downloadTextFile,
  openAttendanceRegisterPrint,
  shiftMonthBs,
} from "./attendanceRegisterUtils";

type Meta = {
  todayBs: string;
  defaultMonthBs: string;
  canStudentRegister: boolean;
  canTeacherRegister: boolean;
  canStaffRegister: boolean;
  batches: BatchRecord[];
  years: YearRecord[];
  classes: ClassRecord[];
  sections: SectionRecord[];
  departments: string[];
  legend: Array<{ status: string; code: string; label: string }>;
  monthNames: string[];
};

const tabToPath = (tab: AttendanceRegisterTab): string => {
  if (tab === "TEACHER") return "/attendance-register/teachers";
  if (tab === "STAFF") return "/attendance-register/staff";
  return "/attendance-register/students";
};

type AttendanceRegisterManagerProps = {
  /** When true, hide top page header (used inside Attendance Management hub). */
  embedded?: boolean;
};

export const AttendanceRegisterManager = ({
  embedded = false,
}: AttendanceRegisterManagerProps) => {
  const { user } = useAuth();
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");

  const metaQuery = useQuery({
    queryKey: ["attendance-register", "meta"],
    queryFn: () => unwrap<Meta>(api.get("/attendance-register/meta")),
  });

  const meta = metaQuery.data;
  const [tab, setTab] = useState<AttendanceRegisterTab>("STUDENT");
  const [monthBs, setMonthBs] = useState("");
  const [batchId, setBatchId] = useState("");
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [academicStatus, setAcademicStatus] = useState("ACTIVE");
  const [department, setDepartment] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<AttendanceRegisterCellDetail | null>(
    null,
  );
  const [exportingPdf, setExportingPdf] = useState(false);

  // Seed month from meta once
  const effectiveMonth = monthBs || meta?.defaultMonthBs || "";

  const yearsForBatch = useMemo(
    () => filterYearsByBatch(meta?.years ?? [], batchId),
    [meta?.years, batchId],
  );
  const sectionsForClass = useMemo(
    () => filterSectionsByClass(meta?.sections ?? [], classId),
    [meta?.sections, classId],
  );

  const registerQuery = useQuery({
    queryKey: [
      "attendance-register",
      tab,
      effectiveMonth,
      batchId,
      yearId,
      classId,
      sectionId,
      academicStatus,
      department,
      search,
    ],
    queryFn: () => {
      const params: Record<string, string> = { monthBs: effectiveMonth };
      if (tab === "STUDENT") {
        if (batchId) params.batchId = batchId;
        if (yearId) params.yearId = yearId;
        if (classId) params.classId = classId;
        if (sectionId) params.sectionId = sectionId;
        if (academicStatus) params.academicStatus = academicStatus;
        if (search.trim()) params.search = search.trim();
      } else {
        if (department) params.department = department;
        if (search.trim()) params.search = search.trim();
      }
      return unwrap<AttendanceRegisterResponse>(
        api.get(tabToPath(tab), { params }),
      );
    },
    enabled: Boolean(effectiveMonth) && Boolean(meta),
  });

  const data = registerQuery.data;

  const tabs = useMemo(() => {
    const list: Array<{ id: AttendanceRegisterTab; label: string }> = [];
    if (meta?.canStudentRegister !== false) {
      list.push({ id: "STUDENT", label: "Student Register" });
    }
    if (meta?.canTeacherRegister) {
      list.push({ id: "TEACHER", label: "Teacher Register" });
    }
    if (meta?.canStaffRegister) {
      list.push({ id: "STAFF", label: "Staff Register" });
    }
    if (list.length === 0) {
      list.push({ id: "STUDENT", label: "Student Register" });
    }
    return list;
  }, [meta]);

  const openCell = async (personId: string, dateBs: string) => {
    try {
      const cell = await unwrap<AttendanceRegisterCellDetail>(
        api.get("/attendance-register/cell-detail", {
          params: { tab, personId, dateBs },
        }),
      );
      setDetail(cell);
    } catch (e) {
      toast.error(parseErrorMessage(e));
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const csv = buildRegisterCsv(data);
    downloadTextFile(
      csv,
      `attendance-register-${tab.toLowerCase()}-${data.monthBs}.csv`,
      "text/csv;charset=utf-8",
    );
    toast.success("CSV downloaded");
  };

  const exportExcel = async () => {
    if (!data) return;
    try {
      const XLSX = await import("xlsx");
      const dayHeaders = data.days.map((d) => String(d.dayOfMonth));
      const aoa: (string | number)[][] = [
        [
          "SN",
          "Name",
          "Code",
          "Roll",
          "Department",
          "Designation",
          "Group",
          "Subgroup",
          ...dayHeaders,
          "Present",
          "Absent",
          "Leave",
          "Late",
          "Holiday",
          "%",
        ],
      ];
      for (const row of data.rows) {
        aoa.push([
          row.sn,
          row.fullName,
          row.code ?? "",
          row.rollNumber ?? "",
          row.department ?? "",
          row.designation ?? "",
          row.batchName ?? row.className ?? "",
          row.yearName ?? row.sectionName ?? "",
          ...data.days.map((d) => row.cells[d.dateBs]?.code ?? ""),
          row.summary.present,
          row.summary.absent,
          row.summary.leave,
          row.summary.late,
          row.summary.holiday,
          row.summary.percentage,
        ]);
      }
      const sheet = XLSX.utils.aoa_to_sheet(aoa);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "Register");
      XLSX.writeFile(
        book,
        `attendance-register-${tab.toLowerCase()}-${data.monthBs}.xlsx`,
      );
      toast.success("Excel downloaded");
    } catch (e) {
      toast.error(parseErrorMessage(e));
    }
  };

  const printOptions = () => ({
    appName: appConfig.appName || "Attendance Register",
    preparedBy: user?.fullName ?? "—",
    tabLabel:
      tab === "TEACHER" ? "Teachers" : tab === "STAFF" ? "Staff" : "Students",
  });

  /** Browser print (Save as PDF from dialog). */
  const printRegister = () => {
    if (!data || data.rows.length === 0) {
      toast.error("Register not ready to print");
      return;
    }
    try {
      openAttendanceRegisterPrint(data, printOptions());
      toast.success("Print dialog opening — use Save as PDF if needed");
    } catch (e) {
      toast.error(parseErrorMessage(e) || "Could not open print dialog");
    }
  };

  /** Download landscape PDF of the full register. */
  const downloadRegisterPdf = async () => {
    if (!data || data.rows.length === 0) {
      toast.error("Register not ready for PDF");
      return;
    }
    setExportingPdf(true);
    try {
      const filename = `attendance-register-${tab.toLowerCase()}-${data.monthBs}.pdf`;
      await downloadAttendanceRegisterPdf(data, printOptions(), filename);
      toast.success("Register PDF downloaded");
    } catch (e) {
      toast.error(parseErrorMessage(e) || "Could not generate register PDF");
    } finally {
      setExportingPdf(false);
    }
  };

  if (metaQuery.isLoading) return <LoadingState />;

  const exportActions = (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!data}
        onClick={() => void exportExcel()}
      >
        <FileSpreadsheet className="mr-1.5 h-4 w-4" />
        Excel
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!data}
        onClick={exportCsv}
      >
        <Download className="mr-1.5 h-4 w-4" />
        CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!data || data.rows.length === 0}
        onClick={printRegister}
      >
        <Printer className="mr-1.5 h-4 w-4" />
        Print
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!data || data.rows.length === 0 || exportingPdf}
        onClick={() => void downloadRegisterPdf()}
      >
        <Download className="mr-1.5 h-4 w-4" />
        {exportingPdf ? "PDF…" : "PDF"}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {embedded ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Attendance Register
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Traditional monthly register — read-only view of existing attendance
              (does not change marking).
            </p>
          </div>
          {exportActions}
        </div>
      ) : (
        <PageHeader
          title="Attendance Register"
          description="Traditional monthly attendance register. Read-only view of existing student, teacher, and staff attendance — does not change marking."
          action={exportActions}
        />
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Button
            key={t.id}
            type="button"
            size="sm"
            variant={tab === t.id ? "default" : "outline"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <FormField label="Month (BS)">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 w-10 shrink-0 px-0"
                onClick={() =>
                  setMonthBs(shiftMonthBs(effectiveMonth || "2082-01", -1))
                }
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                value={effectiveMonth}
                onChange={(e) => setMonthBs(e.target.value)}
                placeholder="YYYY-MM"
                className="text-center"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 w-10 shrink-0 px-0"
                onClick={() =>
                  setMonthBs(shiftMonthBs(effectiveMonth || "2082-01", 1))
                }
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </FormField>
          <FormField label="Go to current">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setMonthBs(meta?.defaultMonthBs ?? "")}
            >
              Current month
            </Button>
          </FormField>

          {tab === "STUDENT" ? (
            <>
              {isCollege ? (
                <>
                  <FormField label={labels.primary}>
                    <Select
                      value={batchId}
                      onChange={(e) => {
                        setBatchId(e.target.value);
                        setYearId("");
                      }}
                    >
                      <option value="">All {labels.primaryPlural}</option>
                      {(meta?.batches ?? []).map((b) => (
                        <option key={b._id} value={b._id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label={labels.secondary}>
                    <Select
                      value={yearId}
                      onChange={(e) => setYearId(e.target.value)}
                    >
                      <option value="">All {labels.secondaryPlural}</option>
                      {yearsForBatch.map((y) => (
                        <option key={y._id} value={y._id}>
                          {y.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </>
              ) : (
                <>
                  <FormField label={labels.primary}>
                    <Select
                      value={classId}
                      onChange={(e) => {
                        setClassId(e.target.value);
                        setSectionId("");
                      }}
                    >
                      <option value="">All {labels.primaryPlural}</option>
                      {(meta?.classes ?? []).map((c) => (
                        <option key={c._id} value={c._id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label={labels.secondary}>
                    <Select
                      value={sectionId}
                      onChange={(e) => setSectionId(e.target.value)}
                    >
                      <option value="">All {labels.secondaryPlural}</option>
                      {sectionsForClass.map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </>
              )}
              <FormField label="Student status">
                <Select
                  value={academicStatus}
                  onChange={(e) => setAcademicStatus(e.target.value)}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="ALL">All</option>
                  <option value="PASSED_OUT">Passed out</option>
                  <option value="ALUMNI">Alumni</option>
                </Select>
              </FormField>
            </>
          ) : (
            <FormField label="Department">
              <Select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">All departments</option>
                {(meta?.departments ?? []).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </FormField>
          )}

          <FormField label="Search">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                tab === "STUDENT" ? "Name / admission no." : "Name / code"
              }
            />
          </FormField>
        </CardContent>
      </Card>

      {/* Stats */}
      {data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatChip
            label={tab === "STUDENT" ? "Total students" : "Total people"}
            value={data.stats.totalPeople}
          />
          <StatChip label="Present today" value={data.stats.presentToday} tone="green" />
          <StatChip label="Absent today" value={data.stats.absentToday} tone="red" />
          <StatChip label="Leave today" value={data.stats.leaveToday} tone="blue" />
          <StatChip
            label="OD / Field today"
            value={data.stats.officialDutyToday + data.stats.fieldDutyToday}
          />
          <StatChip
            label="Today %"
            value={`${data.stats.attendancePercentToday}%`}
            tone="brand"
          />
        </div>
      ) : null}

      {/* Note */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-600">Note:</span>
        {(data?.legend ?? meta?.legend ?? []).map((item) => (
          <span
            key={item.status}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
              cellClass({ code: item.code, status: item.status, dateBs: "" }),
            )}
          >
            <strong>{item.code}</strong> = {item.label}
          </span>
        ))}
      </div>

      {registerQuery.isLoading ? (
        <LoadingState />
      ) : registerQuery.isError ? (
        <EmptyState
          title="Could not load register"
          description={parseErrorMessage(registerQuery.error)}
        />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState
          title="No rows for this filter"
          description="Adjust batch/year or month. Register only shows people with existing profiles; attendance codes come from existing daily sheets."
        />
      ) : (
        <>
          {/* Screen grid */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Users className="h-5 w-5 text-brand-700" />
                {data.monthLabel}
                {data.scopeLabel ? (
                  <span className="text-sm font-normal text-slate-500">
                    · {data.scopeLabel}
                  </span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[70vh] overflow-auto">
                <table className="min-w-max border-collapse text-xs">
                  <thead className="sticky top-0 z-20 bg-slate-100">
                    <tr>
                      <th className="sticky left-0 z-30 border border-slate-200 bg-slate-100 px-2 py-1">
                        SN
                      </th>
                      <th className="sticky left-8 z-30 min-w-[10rem] border border-slate-200 bg-slate-100 px-2 py-1 text-left">
                        Name
                      </th>
                      {tab === "STUDENT" ? (
                        <>
                          <th className="border border-slate-200 px-2 py-1">Roll</th>
                          <th className="border border-slate-200 px-2 py-1">
                            {labels.primary}
                          </th>
                        </>
                      ) : (
                        <>
                          <th className="border border-slate-200 px-2 py-1">Dept</th>
                          <th className="border border-slate-200 px-2 py-1">Desig.</th>
                        </>
                      )}
                      {data.days.map((d) => (
                        <th
                          key={d.dateBs}
                          className={cn(
                            "min-w-[2rem] border border-slate-200 px-1 py-1",
                            d.isSaturday && "bg-slate-200",
                          )}
                          title={`${d.weekday} ${d.dateBs}`}
                        >
                          <div className="font-bold">{d.dayOfMonth}</div>
                          <div className="text-[9px] font-medium text-slate-500">
                            {d.weekdayShort}
                          </div>
                        </th>
                      ))}
                      <th className="border border-slate-200 px-2 py-1">P</th>
                      <th className="border border-slate-200 px-2 py-1">A</th>
                      <th className="border border-slate-200 px-2 py-1">L</th>
                      <th className="border border-slate-200 px-2 py-1">Late</th>
                      <th className="border border-slate-200 px-2 py-1">H</th>
                      <th className="border border-slate-200 px-2 py-1">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.personId} className="hover:bg-slate-50/80">
                        <td className="sticky left-0 z-10 border border-slate-200 bg-white px-2 py-1 text-center font-medium">
                          {row.sn}
                        </td>
                        <td className="sticky left-8 z-10 max-w-[12rem] truncate border border-slate-200 bg-white px-2 py-1 text-left font-semibold">
                          {row.fullName}
                        </td>
                        {tab === "STUDENT" ? (
                          <>
                            <td className="border border-slate-200 px-2 py-1 text-center">
                              {row.rollNumber ?? "—"}
                            </td>
                            <td className="border border-slate-200 px-2 py-1">
                              {row.batchName ?? row.className ?? "—"}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="border border-slate-200 px-2 py-1">
                              {row.department || "—"}
                            </td>
                            <td className="border border-slate-200 px-2 py-1">
                              {row.designation || "—"}
                            </td>
                          </>
                        )}
                        {data.days.map((d) => {
                          const cell = row.cells[d.dateBs];
                          const code = cell?.code;
                          return (
                            <td
                              key={d.dateBs}
                              className={cn(
                                "border border-slate-200 px-0.5 py-0.5 text-center",
                                d.isSaturday && "bg-slate-100",
                              )}
                            >
                              {code ? (
                                <button
                                  type="button"
                                  className={cn(
                                    "inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded px-1 text-[10px] font-bold",
                                    cellClass(cell),
                                    d.isSaturday && code === "H" && "opacity-80",
                                  )}
                                  onClick={() =>
                                    void openCell(row.personId, d.dateBs)
                                  }
                                  title={`${d.dateBs} · ${cell?.status ?? ""}`}
                                >
                                  {d.isSaturday && !code ? "H" : code}
                                </button>
                              ) : (
                                <span
                                  className={cn(
                                    "text-slate-300",
                                    d.isSaturday && "font-medium text-slate-400",
                                  )}
                                >
                                  {d.isSaturday ? "H" : "·"}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="border border-slate-200 px-1 py-1 text-center tabular-nums">
                          {row.summary.present}
                        </td>
                        <td className="border border-slate-200 px-1 py-1 text-center tabular-nums">
                          {row.summary.absent}
                        </td>
                        <td className="border border-slate-200 px-1 py-1 text-center tabular-nums">
                          {row.summary.leave}
                        </td>
                        <td className="border border-slate-200 px-1 py-1 text-center tabular-nums">
                          {row.summary.late}
                        </td>
                        <td className="border border-slate-200 px-1 py-1 text-center tabular-nums">
                          {row.summary.holiday}
                        </td>
                        <td className="border border-slate-200 px-1 py-1 text-center font-semibold tabular-nums">
                          {row.summary.percentage}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

        </>
      )}

      {/* Cell detail modal */}
      {detail ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4"
          onClick={() => setDetail(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Attendance detail"
          >
            <h3 className="text-lg font-semibold text-slate-900">
              Attendance detail
            </h3>
            <p className="mt-1 text-sm text-slate-500">{detail.personName}</p>
            <dl className="mt-4 space-y-2 text-sm">
              <DetailRow label="Date (BS)" value={detail.dateBs} />
              <DetailRow
                label="Status"
                value={
                  detail.code
                    ? `${detail.code} (${detail.status ?? "—"})`
                    : "Not marked"
                }
              />
              <DetailRow label="Check in" value={detail.checkInTime || "—"} />
              <DetailRow label="Check out" value={detail.checkOutTime || "—"} />
              <DetailRow label="Marked by" value={detail.markedByName || "—"} />
              <DetailRow label="Source" value={detail.source || "—"} />
              <DetailRow label="Location" value={detail.locationLabel || "—"} />
              <DetailRow label="Remarks" value={detail.remarks || "—"} />
            </dl>
            <Button
              type="button"
              className="mt-5 w-full"
              onClick={() => setDetail(null)}
            >
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const StatChip = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "green" | "red" | "blue" | "brand";
}) => (
  <div
    className={cn(
      "rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm",
      tone === "green" && "border-emerald-200 bg-emerald-50",
      tone === "red" && "border-red-200 bg-red-50",
      tone === "blue" && "border-blue-200 bg-blue-50",
      tone === "brand" && "border-brand-200 bg-brand-50",
    )}
  >
    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
      {label}
    </p>
    <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{value}</p>
  </div>
);

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
    <dt className="text-slate-500">{label}</dt>
    <dd className="text-right font-medium text-slate-900">{value}</dd>
  </div>
);
