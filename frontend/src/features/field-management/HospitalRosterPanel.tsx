import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adToBs, bsToAd, getTodayBs } from "@munatech/nepali-datepicker";
import {
  type BatchRecord,
  type CollegeStaffRecord,
  type DutyShiftRecord,
  type FieldDutyRosterStudent,
  type FieldHospitalRecord,
  type HospitalDepartmentRecord,
  type HospitalRosterCell,
  type HospitalRosterRecord,
  type HospitalRosterSummary,
  type RosterDutyCodeRecord,
  type YearRecord,
} from "@phit-erp/shared";
import {
  Building2,
  CalendarDays,
  ClipboardList,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Printer,
  Tag,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { Textarea } from "components/ui/textarea";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import {
  buildPrintInstitutionHeaderHtml,
  getPrintInstitutionBranding,
  PRINT_INSTITUTION_HEADER_CSS,
} from "lib/printBranding";
import { cn, parseErrorMessage } from "lib/utils";

type SubTab =
  | "rosters"
  | "builder"
  | "summary"
  | "hospitals"
  | "departments"
  | "shifts"
  | "codes";

const todayBsString = (): string => {
  const d = getTodayBs();
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
};

/** Offset a BS YYYY-MM-DD by N calendar days. */
const offsetBsDate = (dateBs: string, offsetDays: number): string => {
  const parts = dateBs.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return dateBs;
  try {
    const ad = bsToAd(y, m, d);
    const js = new Date(ad.year, ad.month - 1, ad.day, 12, 0, 0);
    js.setDate(js.getDate() + offsetDays);
    const bs = adToBs(js.getFullYear(), js.getMonth() + 1, js.getDate());
    return `${bs.year}-${String(bs.month).padStart(2, "0")}-${String(bs.day).padStart(2, "0")}`;
  } catch {
    return dateBs;
  }
};

/** Inclusive day count between two BS dates (same day → 1). */
const countInclusiveDays = (startBs: string, endBs: string): number => {
  const sp = startBs.split("-").map(Number);
  const ep = endBs.split("-").map(Number);
  if (sp.length < 3 || ep.length < 3) return 0;
  try {
    const sAd = bsToAd(sp[0]!, sp[1]!, sp[2]!);
    const eAd = bsToAd(ep[0]!, ep[1]!, ep[2]!);
    const s = Date.UTC(sAd.year, sAd.month - 1, sAd.day);
    const e = Date.UTC(eAd.year, eAd.month - 1, eAd.day);
    if (e < s) return 0;
    return Math.floor((e - s) / 86_400_000) + 1;
  } catch {
    return 0;
  }
};

const compareRollNo = (
  a: { rollNumber?: number; fullName?: string },
  b: { rollNumber?: number; fullName?: string },
) => {
  const ar = a.rollNumber;
  const br = b.rollNumber;
  const aHas = typeof ar === "number" && Number.isFinite(ar);
  const bHas = typeof br === "number" && Number.isFinite(br);
  if (aHas && bHas && ar !== br) return ar - br;
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  return (a.fullName || "").localeCompare(b.fullName || "", undefined, {
    sensitivity: "base",
  });
};

const rollLabel = (n?: number) =>
  typeof n === "number" && Number.isFinite(n) ? String(n) : "—";

const periodLabel = (r: {
  startDateBs?: string;
  endDateBs?: string;
  monthBs?: string;
  daysInMonth?: number;
}) => {
  if (r.startDateBs && r.endDateBs) {
    if (r.startDateBs === r.endDateBs) return r.startDateBs;
    return `${r.startDateBs} → ${r.endDateBs}`;
  }
  if (r.monthBs) return `Month ${r.monthBs}`;
  return "—";
};

interface Props {
  isAdmin: boolean;
}

const cellKey = (studentId: string, day: number) => `${studentId}:${day}`;

const hospitalNameKey = (name?: string) =>
  (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Unique active hospitals for selects — skips duplicate names and missing status. */
const selectableHospitals = (
  hospitals: FieldHospitalRecord[] | undefined,
  keepId?: string,
): FieldHospitalRecord[] => {
  const rows = Array.isArray(hospitals) ? hospitals : [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const out: FieldHospitalRecord[] = [];
  for (const h of rows) {
    if (!h?._id) continue;
    if (seenIds.has(h._id)) continue;
    const status = String(h.status || "ACTIVE").toUpperCase();
    if (status === "INACTIVE" && h._id !== keepId) continue;
    const nameKey = hospitalNameKey(h.name);
    if (nameKey && seenNames.has(nameKey) && h._id !== keepId) continue;
    seenIds.add(h._id);
    if (nameKey) seenNames.add(nameKey);
    out.push(h);
  }
  return out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
};

const statusBadge = (status: string) => {
  if (status === "LOCKED") return "bg-slate-800 text-white";
  if (status === "PUBLISHED") return "bg-emerald-100 text-emerald-800";
  return "bg-amber-100 text-amber-900";
};

/** Strip empty strings so ObjectId fields never send "" to the API. */
const cleanOptionalId = (value?: string | null): string | undefined => {
  if (!value || !String(value).trim()) return undefined;
  const s = String(value).trim();
  return /^[a-f\d]{24}$/i.test(s) ? s : undefined;
};

const sanitizeCellsForApi = (cells: HospitalRosterCell[]): HospitalRosterCell[] =>
  cells
    .map((c) => {
      const row: HospitalRosterCell = {
        studentId: String(c.studentId),
        day: Number(c.day),
        code: (c.code ?? "").trim(),
        remarks: (c.remarks ?? "").trim(),
      };
      const shiftId = cleanOptionalId(c.shiftId);
      const departmentId = cleanOptionalId(c.departmentId);
      if (shiftId) row.shiftId = shiftId;
      if (departmentId) row.departmentId = departmentId;
      return row;
    })
    .filter((c) => Boolean(c.shiftId || c.departmentId || c.code));

const escapePrintHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type RosterPrintHeader = {
  name: string;
  address?: string;
  preparedBy?: string;
  approvedBy?: string;
  /** Short-form glossary printed under the table, above signatures. */
  note?: string;
  /** When false, omit the Note block. Default true. */
  includeNote?: boolean;
  /** When false, omit the signature block. Default true. */
  includeSignatures?: boolean;
};

const sortByOrder = <T extends { sortOrder?: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100));

/** Glossary of roster short codes → full names (M = Morning, ER = Emergency). */
const buildRosterShortFormNote = (
  entries: Array<{ short?: string; full?: string; sortOrder?: number }>,
): string => {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const row of sortByOrder(entries)) {
    const code = (row.short ?? "").trim();
    const name = (row.full ?? "").trim();
    if (!code || !name) continue;
    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`${code} = ${name}`);
  }
  return parts.join(", ");
};

const rosterMasterShortForms = (
  shifts: DutyShiftRecord[],
  departments: HospitalDepartmentRecord[],
  codes: RosterDutyCodeRecord[],
): Array<{ short?: string; full?: string; sortOrder?: number }> => [
  ...shifts.map((row) => ({
    short: row.shortCode,
    full: row.name,
    sortOrder: row.sortOrder,
  })),
  ...departments.map((row) => ({
    short: row.shortCode,
    full: row.name,
    sortOrder: 1000 + (row.sortOrder ?? 100),
  })),
  ...codes.map((row) => ({
    short: row.code,
    full: row.label,
    sortOrder: 2000 + (row.sortOrder ?? 100),
  })),
];

const rosterShortFormNoteHtml = (noteText?: string): string => {
  const text =
    (noteText ?? "").trim() ||
    "M = Morning, ER = Emergency (edit this note)";
  return `<div class="note">
      <strong>Note:</strong>
      <span class="note-body">${escapePrintHtml(text)}</span>
    </div>`;
};

const rosterSignatureBlockHtml = (header?: RosterPrintHeader): string => {
  if (header?.includeSignatures === false) return "";
  const prepared = (header?.preparedBy ?? "").trim();
  const approved = (header?.approvedBy ?? "").trim();
  return `<div class="sig-block">
      <div class="sig">
        <div class="sig-space"></div>
        <div class="sig-line"></div>
        <div class="sig-role">Prepared By</div>
        <div class="sig-name editable" contenteditable="true" data-placeholder="Type name">${escapePrintHtml(prepared)}</div>
      </div>
      <div class="sig">
        <div class="sig-space"></div>
        <div class="sig-line"></div>
        <div class="sig-role">Approved By</div>
        <div class="sig-name editable" contenteditable="true" data-placeholder="Type name">${escapePrintHtml(approved)}</div>
      </div>
    </div>`;
};

const openRosterPrintWindow = (
  title: string,
  bodyHtml: string,
  header?: RosterPrintHeader,
) => {
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Pop-up blocked — allow pop-ups to print the roster");
    return;
  }
  const headingName = header?.name?.trim();
  const institutionHeader = headingName
    ? buildPrintInstitutionHeaderHtml({
        branding: {
          name: headingName,
          address: header?.address?.trim() || undefined,
        },
      })
    : buildPrintInstitutionHeaderHtml();
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8"/>
    <title>${escapePrintHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: system-ui, sans-serif; padding: 8mm; color: #0f172a; }
      h1 { font-size: 14px; margin: 8px 0 4px; }
      .meta { font-size: 11px; color: #475569; margin-bottom: 8px; }
      table { width: 100%; border-collapse: collapse; font-size: 8px; }
      th, td { border: 1px solid #94a3b8; padding: 2px 3px; }
      th { background: #f1f5f9; font-weight: 600; }
      td.student { text-align: left; white-space: nowrap; font-weight: 600; }
      th.sn, td.sn { text-align: center; width: 18px; white-space: nowrap; font-weight: 600; }
      td.cell { text-align: center; font-family: ui-monospace, monospace; font-weight: 600; }
      thead { display: table-header-group; }
      tfoot { display: table-row-group; }
      tr { page-break-inside: avoid; break-inside: avoid; }
      td, th { page-break-inside: avoid; break-inside: avoid; }
      .legend { margin-top: 8px; font-size: 10px; color: #334155; }
      .print-footer {
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid #94a3b8;
        background: #fff;
        page-break-inside: avoid;
        break-inside: avoid;
        page-break-before: auto;
      }
      .note {
        margin: 0 0 22px;
        padding: 0 0 12px;
        border-bottom: 1px solid #e2e8f0;
        font-size: 9.5px;
        color: #334155;
        line-height: 1.45;
      }
      .note strong { color: #0f172a; margin-right: 4px; }
      .note-body { font-size: 9.5px; }
      .print-toolbar {
        position: sticky;
        top: 0;
        z-index: 50;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px 14px;
        margin: -8mm -8mm 10px;
        padding: 8px 12px;
        background: #0f172a;
        color: #e2e8f0;
        font-size: 13px;
      }
      .print-toolbar .hint { flex: 1; min-width: 180px; font-size: 12px; color: #cbd5e1; }
      .print-toolbar label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; }
      .print-toolbar button {
        background: #ffffff;
        color: #0f172a;
        border: 0;
        border-radius: 6px;
        padding: 6px 14px;
        font-weight: 600;
        cursor: pointer;
      }
      .editable.is-editing {
        outline: 1px dashed #94a3b8;
        outline-offset: 2px;
        min-width: 2em;
        cursor: text;
        border-radius: 2px;
      }
      .editable.is-editing:empty::before {
        content: attr(data-placeholder);
        color: #94a3b8;
        font-weight: 400;
      }
      .sig-block {
        margin-top: 22px;
        display: flex;
        justify-content: space-around;
        gap: 32px;
        page-break-inside: avoid;
      }
      .sig {
        min-width: 58mm;
        max-width: 90mm;
        text-align: center;
        font-size: 11px;
        color: #334155;
      }
      .sig-space { height: 22px; }
      .sig-line {
        border-top: 1px solid #0f172a;
        margin: 0 6px 4px;
      }
      .sig-role { font-weight: 600; font-size: 11px; color: #0f172a; }
      .sig-name {
        margin-top: 2px;
        min-height: 14px;
        font-size: 11px;
        font-weight: 600;
        color: #0f172a;
      }
      @page {
        size: A4 landscape;
        margin: 8mm;
      }
      @page {
        @top-left { content: none; }
        @top-center { content: none; }
        @top-right { content: none; }
        @bottom-left { content: none; }
        @bottom-center { content: none; }
        @bottom-right { content: none; }
      }
      @media print {
        html, body { height: auto; }
        body { padding: 0; }
        .print-toolbar, .no-print { display: none !important; }
        .editable.is-editing { outline: none !important; }
        .editable.is-editing:empty::before { content: none !important; }
        .print-footer {
          position: static;
          box-shadow: none;
        }
      }
      ${PRINT_INSTITUTION_HEADER_CSS}
    </style>
    </head><body>
    <div class="print-toolbar no-print">
      <label>
        <input type="checkbox" id="roster-edit-toggle" checked />
        Edit texts
      </label>
      <span class="hint">Click highlighted text to edit. In the print dialog, turn off <strong>Headers and footers</strong> so the page address is not saved on the PDF.</span>
      <button type="button" id="roster-print-btn">Print / Save as PDF</button>
    </div>
    ${institutionHeader}
    ${bodyHtml}
    <div class="print-footer">
      ${header?.includeNote === false ? "" : rosterShortFormNoteHtml(header?.note)}
      ${rosterSignatureBlockHtml(header)}
    </div>
    <script>
      (function () {
        var EDIT_SEL = [
          ".print-inst-name",
          ".print-inst-name-np",
          ".print-inst-address",
          "h1",
          ".meta",
          ".legend",
          ".note",
          ".note-body",
          ".sig-name",
          "td.student",
        ].join(",");

        function setEditing(on) {
          document.querySelectorAll(EDIT_SEL).forEach(function (el) {
            el.classList.add("editable");
            if (!el.getAttribute("data-placeholder")) {
              el.setAttribute("data-placeholder", "Click to edit");
            }
            el.setAttribute("contenteditable", on ? "true" : "false");
            if (on) el.classList.add("is-editing");
            else el.classList.remove("is-editing");
          });
        }

        var toggle = document.getElementById("roster-edit-toggle");
        var btn = document.getElementById("roster-print-btn");
        if (toggle) {
          toggle.addEventListener("change", function () { setEditing(toggle.checked); });
          setEditing(toggle.checked);
        } else {
          setEditing(true);
        }
        if (btn) {
          btn.addEventListener("click", function () {
            try { window.focus(); window.print(); } catch (e) {}
          });
        }
      })();
    </script>
    </body></html>`);
  win.document.close();
  win.document.title = title;
  // window.open("") is about:blank — Chrome prints that URL in the PDF footer
  // unless Headers and footers is off. Point the tab at this app instead.
  try {
    const path = `${window.location.pathname}${window.location.search}` || "/";
    win.history.replaceState({}, title, path);
  } catch {
    /* ignore if the print tab cannot change its URL */
  }
};

export const HospitalRosterPanel = ({ isAdmin }: Props) => {
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState<SubTab>("rosters");
  const [activeRosterId, setActiveRosterId] = useState<string | null>(null);

  const hospitalsQuery = useQuery({
    queryKey: ["field-duty", "hospitals"],
    queryFn: () =>
      unwrap<FieldHospitalRecord[]>(api.get("/field-duty/hospitals")),
  });
  const departmentsQuery = useQuery({
    queryKey: ["field-duty", "departments"],
    queryFn: () =>
      unwrap<HospitalDepartmentRecord[]>(api.get("/field-duty/departments")),
  });
  const shiftsQuery = useQuery({
    queryKey: ["field-duty", "shifts"],
    queryFn: () => unwrap<DutyShiftRecord[]>(api.get("/field-duty/shifts")),
  });
  const dutyCodesQuery = useQuery({
    queryKey: ["field-duty", "duty-codes"],
    queryFn: () =>
      unwrap<RosterDutyCodeRecord[]>(api.get("/field-duty/duty-codes")),
  });
  const rostersQuery = useQuery({
    queryKey: ["field-duty", "hospital-rosters"],
    queryFn: () =>
      unwrap<HospitalRosterRecord[]>(api.get("/field-duty/hospital-rosters")),
  });
  const batchesQuery = useQuery({
    queryKey: ["academics", "batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
    enabled: isAdmin,
  });
  const yearsQuery = useQuery({
    queryKey: ["academics", "years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
    enabled: isAdmin,
  });
  const staffQuery = useQuery({
    queryKey: ["college-staff", "ACTIVE"],
    queryFn: () =>
      unwrap<CollegeStaffRecord[]>(
        api.get("/college-staff", { params: { status: "ACTIVE" } }),
      ),
    enabled: isAdmin,
  });

  const rosterQuery = useQuery({
    queryKey: ["field-duty", "hospital-rosters", activeRosterId],
    queryFn: () =>
      unwrap<HospitalRosterRecord>(
        api.get(`/field-duty/hospital-rosters/${activeRosterId}`),
      ),
    enabled: Boolean(activeRosterId),
  });

  const summaryQuery = useQuery({
    queryKey: ["field-duty", "hospital-rosters", activeRosterId, "summary"],
    queryFn: () =>
      unwrap<HospitalRosterSummary>(
        api.get(`/field-duty/hospital-rosters/${activeRosterId}/summary`),
      ),
    enabled: Boolean(activeRosterId) && subTab === "summary",
  });

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["field-duty"] });
  };

  const openBuilder = (id: string) => {
    setActiveRosterId(id);
    setSubTab("builder");
  };

  const tabs: Array<{ id: SubTab; label: string; icon: typeof CalendarDays }> =
    [
      { id: "rosters", label: "Rosters", icon: CalendarDays },
      { id: "builder", label: "Roster Builder", icon: ClipboardList },
      { id: "summary", label: "Duty Summary", icon: ClipboardList },
      { id: "hospitals", label: "Hospitals", icon: Building2 },
      { id: "departments", label: "Departments", icon: Building2 },
      { id: "shifts", label: "Shifts", icon: CalendarDays },
      { id: "codes", label: "Codes", icon: Tag },
    ];

  return (
    <div className="space-y-4">
      <Card className="border-brand-100 bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]">
        <CardContent className="py-4 text-sm text-slate-600">
          Hospital Roster is an additive clinical duty planner. Existing Community/PHC
          and Hospital Posting attendance workflows are unchanged.
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <Button
              key={t.id}
              size="sm"
              variant={subTab === t.id ? "default" : "outline"}
              onClick={() => setSubTab(t.id)}
            >
              <Icon className="mr-1.5 h-4 w-4" />
              {t.label}
            </Button>
          );
        })}
      </div>

      {subTab === "hospitals" ? (
        <HospitalsManager
          isAdmin={isAdmin}
          hospitals={hospitalsQuery.data ?? []}
          staff={staffQuery.data ?? []}
          loading={hospitalsQuery.isLoading}
          onChanged={invalidate}
        />
      ) : null}

      {subTab === "departments" ? (
        <DepartmentsManager
          isAdmin={isAdmin}
          departments={departmentsQuery.data ?? []}
          loading={departmentsQuery.isLoading}
          onChanged={invalidate}
        />
      ) : null}

      {subTab === "shifts" ? (
        <ShiftsManager
          isAdmin={isAdmin}
          shifts={shiftsQuery.data ?? []}
          loading={shiftsQuery.isLoading}
          onChanged={invalidate}
        />
      ) : null}

      {subTab === "codes" ? (
        <DutyCodesManager
          isAdmin={isAdmin}
          codes={dutyCodesQuery.data ?? []}
          loading={dutyCodesQuery.isLoading}
          onChanged={invalidate}
        />
      ) : null}

      {subTab === "rosters" ? (
        <RostersList
          isAdmin={isAdmin}
          rosters={rostersQuery.data ?? []}
          hospitals={hospitalsQuery.data ?? []}
          batches={batchesQuery.data ?? []}
          years={yearsQuery.data ?? []}
          staff={staffQuery.data ?? []}
          loading={rostersQuery.isLoading}
          onOpen={openBuilder}
          onChanged={invalidate}
        />
      ) : null}

      {subTab === "builder" ? (
        !activeRosterId ? (
          <RosterBuilderPicker
            rosters={rostersQuery.data ?? []}
            hospitals={hospitalsQuery.data ?? []}
            onOpen={openBuilder}
          />
        ) : rosterQuery.isLoading ? (
          <LoadingState />
        ) : rosterQuery.data ? (
          <RosterBuilder
            isAdmin={isAdmin}
            roster={rosterQuery.data}
            shifts={shiftsQuery.data ?? []}
            departments={departmentsQuery.data ?? []}
            dutyCodes={dutyCodesQuery.data ?? []}
            onChanged={async () => {
              await invalidate();
              await rosterQuery.refetch();
            }}
          />
        ) : (
          <EmptyState title="Roster not found" description="It may have been deleted." />
        )
      ) : null}

      {subTab === "summary" ? (
        !activeRosterId ? (
          <EmptyState
            title="Select a roster"
            description="Open a roster first, then view duty summary and clinical record."
          />
        ) : summaryQuery.isLoading ? (
          <LoadingState />
        ) : summaryQuery.data ? (
          <DutySummaryView summary={summaryQuery.data} />
        ) : (
          <EmptyState title="No summary" description="Unable to load duty summary." />
        )
      ) : null}
    </div>
  );
};

// ─── Roster Builder hospital / roster picker ────────────────────────────────

const RosterBuilderPicker = ({
  rosters,
  hospitals,
  onOpen,
}: {
  rosters: HospitalRosterRecord[];
  hospitals: FieldHospitalRecord[];
  onOpen: (id: string) => void;
}) => {
  const hospitalRows = selectableHospitals(hospitals);
  const rosterList = Array.isArray(rosters) ? rosters : [];
  const byHospital = new Map<
    string,
    { hospital: FieldHospitalRecord | null; label: string; rosters: HospitalRosterRecord[] }
  >();

  for (const h of hospitalRows) {
    byHospital.set(h._id, { hospital: h, label: h.name, rosters: [] });
  }
  for (const r of rosterList) {
    const id = r.hospitalId || r._id;
    const existing = byHospital.get(r.hospitalId);
    if (existing) {
      existing.rosters.push(r);
    } else {
      byHospital.set(id, {
        hospital: null,
        label: r.hospitalName || r.name || "Hospital",
        rosters: [r],
      });
    }
  }

  const groups = [...byHospital.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  if (groups.length === 0) {
    return (
      <EmptyState
        title="No hospitals yet"
        description="Add hospitals under the Hospitals tab, or create a Hospital Posting. Then create a roster and open it here."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roster Builder</CardTitle>
        <p className="text-sm text-slate-500">
          Open a roster to edit the student × day grid. Every hospital you created
          is listed here.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.map((g) => (
          <div
            key={g.hospital?._id ?? g.label}
            className="rounded-xl border border-slate-200 px-3 py-3"
          >
            <p className="font-medium text-slate-900">{g.label}</p>
            {g.hospital?.address ? (
              <p className="text-xs text-slate-500">{g.hospital.address}</p>
            ) : null}
            {g.rosters.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                No roster yet for this hospital. Create one on the Rosters tab.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {g.rosters.map((r) => (
                  <div
                    key={r._id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{r.name}</p>
                      <p className="text-xs text-slate-500">
                        {periodLabel(r)}
                        {r.batchName || r.yearName
                          ? ` · ${r.batchName ?? "Batch"} / ${r.yearName ?? "Year"}`
                          : ""}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => onOpen(r._id)}>
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

// ─── Hospitals ──────────────────────────────────────────────────────────────

const HospitalsManager = ({
  isAdmin,
  hospitals,
  staff,
  loading,
  onChanged,
}: {
  isAdmin: boolean;
  hospitals: FieldHospitalRecord[];
  staff: CollegeStaffRecord[];
  loading: boolean;
  onChanged: () => Promise<void>;
}) => {
  const [form, setForm] = useState({
    name: "",
    address: "",
    contact: "",
    coordinatorStaffId: "",
    status: "ACTIVE" as "ACTIVE" | "INACTIVE",
    remarks: "",
  });

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.post("/field-duty/hospitals", {
          ...form,
          coordinatorStaffId: cleanOptionalId(form.coordinatorStaffId),
        }),
      ),
    onSuccess: async () => {
      toast.success("Hospital created");
      setForm({
        name: "",
        address: "",
        contact: "",
        coordinatorStaffId: "",
        status: "ACTIVE",
        remarks: "",
      });
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/field-duty/hospitals/${id}`)),
    onSuccess: async () => {
      toast.success("Hospital deleted");
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (loading) return <LoadingState />;

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Add hospital</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField label="Hospital name *">
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Provincial Hospital Lahan"
              />
            </FormField>
            <FormField label="Address">
              <Input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </FormField>
            <FormField label="Contact">
              <Input
                value={form.contact}
                onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
              />
            </FormField>
            <FormField label="Coordinator">
              <Select
                value={form.coordinatorStaffId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, coordinatorStaffId: e.target.value }))
                }
              >
                <option value="">—</option>
                {staff.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.fullName || s.user?.fullName || s.staffId || s._id}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Status">
              <Select
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    status: e.target.value as "ACTIVE" | "INACTIVE",
                  }))
                }
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </FormField>
            <Button
              disabled={!form.name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus className="mr-1 h-4 w-4" />
              Save hospital
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Hospitals ({hospitals.length})</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHead>
                <tr>
                  <Th>Name</Th>
                  <Th>Address</Th>
                  <Th>Contact</Th>
                  <Th>Coordinator</Th>
                  <Th>Status</Th>
                  {isAdmin ? <Th /> : null}
                </tr>
              </TableHead>
              <TableBody>
                {hospitals.length === 0 ? (
                  <tr>
                    <Td colSpan={isAdmin ? 6 : 5} className="py-8 text-center text-slate-500">
                      No hospitals yet. Add Provincial Hospital Lahan, Gajendra Narayan Hospital, etc.
                    </Td>
                  </tr>
                ) : (
                  hospitals.map((h) => (
                    <tr key={h._id}>
                      <Td className="font-medium">{h.name}</Td>
                      <Td>{h.address || "—"}</Td>
                      <Td>{h.contact || "—"}</Td>
                      <Td>{h.coordinatorName || "—"}</Td>
                      <Td>
                        <Badge
                          className={
                            h.status === "ACTIVE"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-600"
                          }
                        >
                          {h.status}
                        </Badge>
                      </Td>
                      {isAdmin ? (
                        <Td className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (window.confirm(`Delete hospital "${h.name}"?`)) {
                                remove.mutate(h._id);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </Td>
                      ) : null}
                    </tr>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Departments ────────────────────────────────────────────────────────────

const DepartmentsManager = ({
  isAdmin,
  departments,
  loading,
  onChanged,
}: {
  isAdmin: boolean;
  departments: HospitalDepartmentRecord[];
  loading: boolean;
  onChanged: () => Promise<void>;
}) => {
  const [name, setName] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");

  const create = useMutation({
    mutationFn: () =>
      unwrap(api.post("/field-duty/departments", { name, shortCode })),
    onSuccess: async () => {
      toast.success("Department added");
      setName("");
      setShortCode("");
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const update = useMutation({
    mutationFn: () =>
      unwrap(
        api.put(`/field-duty/departments/${editingId}`, {
          name: editName,
          shortCode: editCode,
        }),
      ),
    onSuccess: async () => {
      toast.success("Department updated");
      setEditingId(null);
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/field-duty/departments/${id}`)),
    onSuccess: async () => {
      toast.success("Department deleted");
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Add department</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <FormField label="Name">
              <Input
                className="w-48"
                placeholder="e.g. Emergency"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
            <FormField label="Code">
              <Input
                className="w-28"
                placeholder="ER"
                value={shortCode}
                onChange={(e) => setShortCode(e.target.value.toUpperCase())}
              />
            </FormField>
            <Button
              size="sm"
              disabled={!name.trim() || !shortCode.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Hospital departments ({departments.length})</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[520px]">
              <TableHead>
                <tr>
                  <Th>Code</Th>
                  <Th>Name</Th>
                  <Th>Status</Th>
                  {isAdmin ? <Th className="text-right">Actions</Th> : null}
                </tr>
              </TableHead>
              <TableBody>
                {departments.map((d) => (
                  <tr key={d._id}>
                    <Td className="font-mono font-semibold">
                      {editingId === d._id ? (
                        <Input
                          className="w-24"
                          value={editCode}
                          onChange={(e) =>
                            setEditCode(e.target.value.toUpperCase())
                          }
                        />
                      ) : (
                        d.shortCode
                      )}
                    </Td>
                    <Td>
                      {editingId === d._id ? (
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      ) : (
                        d.name
                      )}
                    </Td>
                    <Td>
                      <Badge
                        className={
                          d.isActive
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }
                      >
                        {d.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </Td>
                    {isAdmin ? (
                      <Td className="text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          {editingId === d._id ? (
                            <>
                              <Button
                                size="sm"
                                disabled={
                                  !editName.trim() ||
                                  !editCode.trim() ||
                                  update.isPending
                                }
                                onClick={() => update.mutate()}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingId(null)}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setEditingId(d._id);
                                  setEditName(d.name);
                                  setEditCode(d.shortCode);
                                }}
                              >
                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-rose-200 text-rose-700"
                                disabled={remove.isPending}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Delete department “${d.shortCode} — ${d.name}”?`,
                                    )
                                  ) {
                                    remove.mutate(d._id);
                                  }
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Shifts ─────────────────────────────────────────────────────────────────

const ShiftsManager = ({
  isAdmin,
  shifts,
  loading,
  onChanged,
}: {
  isAdmin: boolean;
  shifts: DutyShiftRecord[];
  loading: boolean;
  onChanged: () => Promise<void>;
}) => {
  const emptyForm = {
    name: "",
    shortCode: "",
    startTime: "07:00",
    endTime: "13:00",
    dutyHours: 6,
  };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  const create = useMutation({
    mutationFn: () => unwrap(api.post("/field-duty/shifts", form)),
    onSuccess: async () => {
      toast.success("Shift added");
      setForm(emptyForm);
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const update = useMutation({
    mutationFn: () =>
      unwrap(api.put(`/field-duty/shifts/${editingId}`, editForm)),
    onSuccess: async () => {
      toast.success("Shift updated");
      setEditingId(null);
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/field-duty/shifts/${id}`)),
    onSuccess: async () => {
      toast.success("Shift deleted");
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Add shift</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <FormField label="Name">
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </FormField>
            <FormField label="Code">
              <Input
                value={form.shortCode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, shortCode: e.target.value.toUpperCase() }))
                }
              />
            </FormField>
            <FormField label="Start">
              <Input
                type="time"
                className="time-input"
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
              />
            </FormField>
            <FormField label="End">
              <Input
                type="time"
                className="time-input"
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
              />
            </FormField>
            <FormField label="Hours">
              <NumberInput
                min={0}
                max={24}
                step={0.5}
                value={form.dutyHours}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    dutyHours: e.target.valueAsNumber || 0,
                  }))
                }
              />
            </FormField>
            <div className="sm:col-span-2 lg:col-span-5">
              <Button
                disabled={
                  !form.name.trim() || !form.shortCode.trim() || create.isPending
                }
                onClick={() => create.mutate()}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add shift
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Duty shifts ({shifts.length})</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[720px]">
              <TableHead>
                <tr>
                  <Th>Name</Th>
                  <Th>Code</Th>
                  <Th>Time</Th>
                  <Th>Hours</Th>
                  {isAdmin ? <Th className="text-right">Actions</Th> : null}
                </tr>
              </TableHead>
              <TableBody>
                {shifts.map((s) => (
                  <tr key={s._id}>
                    {editingId === s._id ? (
                      <>
                        <Td>
                          <Input
                            value={editForm.name}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, name: e.target.value }))
                            }
                          />
                        </Td>
                        <Td>
                          <Input
                            className="w-20"
                            value={editForm.shortCode}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                shortCode: e.target.value.toUpperCase(),
                              }))
                            }
                          />
                        </Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            <Input
                              type="time"
                              className="time-input w-28"
                              value={editForm.startTime}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  startTime: e.target.value,
                                }))
                              }
                            />
                            <Input
                              type="time"
                              className="time-input w-28"
                              value={editForm.endTime}
                              onChange={(e) =>
                                setEditForm((f) => ({
                                  ...f,
                                  endTime: e.target.value,
                                }))
                              }
                            />
                          </div>
                        </Td>
                        <Td>
                          <NumberInput
                            className="w-20"
                            min={0}
                            max={24}
                            step={0.5}
                            value={editForm.dutyHours}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                dutyHours: e.target.valueAsNumber || 0,
                              }))
                            }
                          />
                        </Td>
                        <Td className="text-right">
                          <div className="inline-flex gap-1">
                            <Button
                              size="sm"
                              disabled={
                                !editForm.name.trim() ||
                                !editForm.shortCode.trim() ||
                                update.isPending
                              }
                              onClick={() => update.mutate()}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </Td>
                      </>
                    ) : (
                      <>
                        <Td>
                          <span
                            className="mr-2 inline-block h-3 w-3 rounded-sm"
                            style={{ background: s.color || "#e2e8f0" }}
                          />
                          {s.name}
                        </Td>
                        <Td className="font-mono font-semibold">{s.shortCode}</Td>
                        <Td>
                          {s.startTime} – {s.endTime}
                        </Td>
                        <Td>{s.dutyHours}</Td>
                        {isAdmin ? (
                          <Td className="text-right">
                            <div className="inline-flex gap-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setEditingId(s._id);
                                  setEditForm({
                                    name: s.name,
                                    shortCode: s.shortCode,
                                    startTime: s.startTime,
                                    endTime: s.endTime,
                                    dutyHours: s.dutyHours,
                                  });
                                }}
                              >
                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-rose-200 text-rose-700"
                                disabled={remove.isPending}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Delete shift “${s.shortCode} — ${s.name}”?`,
                                    )
                                  ) {
                                    remove.mutate(s._id);
                                  }
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </Td>
                        ) : null}
                      </>
                    )}
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Duty codes (Off / Leave / custom) ──────────────────────────────────────

const DutyCodesManager = ({
  isAdmin,
  codes,
  loading,
  onChanged,
}: {
  isAdmin: boolean;
  codes: RosterDutyCodeRecord[];
  loading: boolean;
  onChanged: () => Promise<void>;
}) => {
  const [form, setForm] = useState({
    code: "",
    label: "",
    isLeave: false,
    isOff: false,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    code: "",
    label: "",
    isLeave: false,
    isOff: false,
  });

  const create = useMutation({
    mutationFn: () => unwrap(api.post("/field-duty/duty-codes", form)),
    onSuccess: async () => {
      toast.success("Code added");
      setForm({ code: "", label: "", isLeave: false, isOff: false });
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const update = useMutation({
    mutationFn: () =>
      unwrap(api.put(`/field-duty/duty-codes/${editingId}`, editForm)),
    onSuccess: async () => {
      toast.success("Code updated");
      setEditingId(null);
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/field-duty/duty-codes/${id}`)),
    onSuccess: async () => {
      toast.success("Code deleted");
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <Card className="border-brand-100 bg-[linear-gradient(135deg,_white_0%,_#eef3fb_100%)]">
        <CardContent className="py-3 text-sm text-slate-600">
          Codes are free labels for a cell when not assigning a shift/department
          (e.g. Off, Leave). Create custom codes here — they appear in the Roster
          Builder cell editor like departments and shifts.
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Add code</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <FormField label="Code *">
              <Input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="e.g. Off"
              />
            </FormField>
            <FormField label="Label *">
              <Input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Day off"
              />
            </FormField>
            <FormField label="Counts as">
              <Select
                value={
                  form.isLeave ? "leave" : form.isOff ? "off" : "other"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({
                    ...f,
                    isLeave: v === "leave",
                    isOff: v === "off",
                  }));
                }}
              >
                <option value="other">Other / duty note</option>
                <option value="off">Off day</option>
                <option value="leave">Leave</option>
              </Select>
            </FormField>
            <div className="flex items-end lg:col-span-2">
              <Button
                disabled={
                  !form.code.trim() || !form.label.trim() || create.isPending
                }
                onClick={() => create.mutate()}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add code
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Roster codes ({codes.length})</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[560px]">
              <TableHead>
                <tr>
                  <Th>Code</Th>
                  <Th>Label</Th>
                  <Th>Type</Th>
                  {isAdmin ? <Th className="text-right">Actions</Th> : null}
                </tr>
              </TableHead>
              <TableBody>
                {codes.map((c) => (
                  <tr key={c._id}>
                    {editingId === c._id ? (
                      <>
                        <Td>
                          <Input
                            className="w-24"
                            value={editForm.code}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, code: e.target.value }))
                            }
                          />
                        </Td>
                        <Td>
                          <Input
                            value={editForm.label}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, label: e.target.value }))
                            }
                          />
                        </Td>
                        <Td>
                          <Select
                            value={
                              editForm.isLeave
                                ? "leave"
                                : editForm.isOff
                                  ? "off"
                                  : "other"
                            }
                            onChange={(e) => {
                              const v = e.target.value;
                              setEditForm((f) => ({
                                ...f,
                                isLeave: v === "leave",
                                isOff: v === "off",
                              }));
                            }}
                          >
                            <option value="other">Other</option>
                            <option value="off">Off</option>
                            <option value="leave">Leave</option>
                          </Select>
                        </Td>
                        <Td className="text-right">
                          <div className="inline-flex gap-1">
                            <Button
                              size="sm"
                              disabled={
                                !editForm.code.trim() ||
                                !editForm.label.trim() ||
                                update.isPending
                              }
                              onClick={() => update.mutate()}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </Td>
                      </>
                    ) : (
                      <>
                        <Td className="font-mono font-semibold">{c.code}</Td>
                        <Td>{c.label}</Td>
                        <Td>
                          {c.isLeave ? (
                            <Badge className="bg-amber-100 text-amber-900">Leave</Badge>
                          ) : c.isOff ? (
                            <Badge className="bg-slate-200 text-slate-800">Off</Badge>
                          ) : (
                            <Badge className="bg-sky-100 text-sky-900">Other</Badge>
                          )}
                        </Td>
                        {isAdmin ? (
                          <Td className="text-right">
                            <div className="inline-flex gap-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setEditingId(c._id);
                                  setEditForm({
                                    code: c.code,
                                    label: c.label,
                                    isLeave: Boolean(c.isLeave),
                                    isOff: Boolean(c.isOff),
                                  });
                                }}
                              >
                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-rose-200 text-rose-700"
                                disabled={remove.isPending}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Delete code “${c.code} — ${c.label}”?`,
                                    )
                                  ) {
                                    remove.mutate(c._id);
                                  }
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </Td>
                        ) : null}
                      </>
                    )}
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Rosters list + create ──────────────────────────────────────────────────

type RosterFormState = {
  name: string;
  academicYearBs: string;
  program: string;
  batchId: string;
  yearId: string;
  hospitalId: string;
  startDateBs: string;
  endDateBs: string;
  coordinatorStaffId: string;
  remarks: string;
};

const emptyRosterForm = (): RosterFormState => ({
  name: "",
  academicYearBs: "2083",
  program: "HA",
  batchId: "",
  yearId: "",
  hospitalId: "",
  startDateBs: todayBsString(),
  endDateBs: todayBsString(),
  coordinatorStaffId: "",
  remarks: "",
});

const RostersList = ({
  isAdmin,
  rosters,
  hospitals,
  batches,
  years,
  staff,
  loading,
  onOpen,
  onChanged,
}: {
  isAdmin: boolean;
  rosters: HospitalRosterRecord[];
  hospitals: FieldHospitalRecord[];
  batches: BatchRecord[];
  years: YearRecord[];
  staff: CollegeStaffRecord[];
  loading: boolean;
  onOpen: (id: string) => void;
  onChanged: () => Promise<void>;
}) => {
  const [form, setForm] = useState<RosterFormState>(emptyRosterForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const periodDays = useMemo(
    () => countInclusiveDays(form.startDateBs, form.endDateBs),
    [form.startDateBs, form.endDateBs],
  );

  /**
   * College years are fixed per batch (1st / 2nd / 3rd …).
   * Never show every batch's years together — only years for the selected batch.
   */
  const yearsForBatch = useMemo(() => {
    if (!form.batchId) return [];
    return years
      .filter((y) => {
        const yBatch =
          typeof y.batchId === "string"
            ? y.batchId
            : (y.batchId as { _id?: string } | undefined)?._id ??
              String(y.batchId ?? "");
        return yBatch === form.batchId;
      })
      .slice()
      .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  }, [years, form.batchId]);

  const hospitalChoices = useMemo(
    () => selectableHospitals(hospitals, form.hospitalId),
    [hospitals, form.hospitalId],
  );

  const startEdit = (r: HospitalRosterRecord) => {
    setEditingId(r._id);
    setForm({
      name: r.name ?? "",
      academicYearBs: r.academicYearBs ?? "2083",
      program: r.program ?? "HA",
      batchId: r.batchId ?? "",
      yearId: r.yearId ?? "",
      hospitalId: r.hospitalId ?? "",
      startDateBs: r.startDateBs || todayBsString(),
      endDateBs: r.endDateBs || r.startDateBs || todayBsString(),
      coordinatorStaffId: r.coordinatorStaffId ?? "",
      remarks: r.remarks ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyRosterForm());
  };

  const create = useMutation({
    mutationFn: () => {
      if (!form.startDateBs?.trim() || !form.endDateBs?.trim()) {
        throw new Error("Select From and To dates");
      }
      if (periodDays < 1) {
        throw new Error("To date must be on or after From date");
      }
      if (periodDays > 93) {
        throw new Error("Roster period cannot exceed 93 days");
      }
      return unwrap<HospitalRosterRecord>(
        api.post("/field-duty/hospital-rosters", {
          name: form.name,
          academicYearBs: form.academicYearBs,
          program: form.program,
          batchId: form.batchId,
          yearId: form.yearId,
          hospitalId: form.hospitalId,
          startDateBs: form.startDateBs,
          endDateBs: form.endDateBs,
          coordinatorStaffId: cleanOptionalId(form.coordinatorStaffId),
          remarks: form.remarks,
        }),
      );
    },
    onSuccess: async (row) => {
      toast.success("Roster created — students loaded from batch/year");
      setForm(emptyRosterForm());
      await onChanged();
      if (row?._id) onOpen(row._id);
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const update = useMutation({
    mutationFn: () => {
      if (!editingId) throw new Error("No roster selected");
      if (!form.startDateBs?.trim() || !form.endDateBs?.trim()) {
        throw new Error("Select From and To dates");
      }
      if (periodDays < 1) {
        throw new Error("To date must be on or after From date");
      }
      if (periodDays > 93) {
        throw new Error("Roster period cannot exceed 93 days");
      }
      return unwrap<HospitalRosterRecord>(
        api.put(`/field-duty/hospital-rosters/${editingId}`, {
          name: form.name,
          academicYearBs: form.academicYearBs,
          program: form.program,
          batchId: form.batchId,
          yearId: form.yearId,
          hospitalId: form.hospitalId,
          startDateBs: form.startDateBs,
          endDateBs: form.endDateBs,
          coordinatorStaffId: cleanOptionalId(form.coordinatorStaffId) ?? "",
          remarks: form.remarks,
        }),
      );
    },
    onSuccess: async () => {
      toast.success("Roster updated");
      cancelEdit();
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.delete(`/field-duty/hospital-rosters/${id}`)),
    onSuccess: async (_data, id) => {
      toast.success("Roster deleted");
      if (editingId === id) cancelEdit();
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (loading) return <LoadingState />;

  const formDisabled =
    create.isPending ||
    update.isPending ||
    !form.name.trim() ||
    !form.batchId ||
    !form.yearId ||
    !form.hospitalId ||
    !form.startDateBs ||
    !form.endDateBs ||
    periodDays < 1 ||
    periodDays > 93;

  return (
    <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
      {isAdmin ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>
              {editingId ? "Edit hospital roster" : "Create hospital roster"}
            </CardTitle>
            {editingId ? (
              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                <X className="mr-1 h-3.5 w-3.5" />
                Cancel
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField label="Roster name *">
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Provincial Hospital Lahan – Emergency – Magh 2083"
              />
            </FormField>
            <FormField label="Academic year (BS)">
              <Input
                value={form.academicYearBs}
                onChange={(e) =>
                  setForm((f) => ({ ...f, academicYearBs: e.target.value }))
                }
              />
            </FormField>
            <FormField label="Program">
              <Input
                value={form.program}
                onChange={(e) => setForm((f) => ({ ...f, program: e.target.value }))}
              />
            </FormField>
            <FormField label="Batch *">
              <Select
                value={form.batchId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, batchId: e.target.value, yearId: "" }))
                }
              >
                <option value="">Select batch</option>
                {batches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Year *">
              <Select
                value={form.yearId}
                disabled={!form.batchId}
                onChange={(e) => setForm((f) => ({ ...f, yearId: e.target.value }))}
              >
                <option value="">
                  {form.batchId ? "Select year" : "Select batch first"}
                </option>
                {yearsForBatch.map((y) => (
                  <option key={y._id} value={y._id}>
                    {y.name}
                  </option>
                ))}
              </Select>
              {form.batchId && yearsForBatch.length === 0 ? (
                <p className="mt-1 text-xs text-amber-700">
                  No years found for this batch. Create years under Academics first.
                </p>
              ) : null}
            </FormField>
            <FormField label="Hospital *">
              <Select
                value={form.hospitalId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, hospitalId: e.target.value }))
                }
              >
                <option value="">Select hospital</option>
                {hospitalChoices.map((h) => (
                  <option key={h._id} value={h._id}>
                    {h.name}
                  </option>
                ))}
              </Select>
              {hospitalChoices.length === 0 ? (
                <p className="mt-1 text-xs text-amber-700">
                  No hospitals yet. Add them under Hospital Roster → Hospitals,
                  or create a Hospital Posting — they will appear here.
                </p>
              ) : null}
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="From date (BS) *">
                <NepaliDateField
                  value={form.startDateBs}
                  onChange={(v) => {
                    setForm((f) => {
                      const next = { ...f, startDateBs: v };
                      if (v && f.endDateBs && countInclusiveDays(v, f.endDateBs) < 1) {
                        next.endDateBs = v;
                      }
                      return next;
                    });
                  }}
                />
              </FormField>
              <FormField label="To date (BS) *">
                <NepaliDateField
                  value={form.endDateBs}
                  onChange={(v) => setForm((f) => ({ ...f, endDateBs: v }))}
                />
              </FormField>
            </div>
            <p className="text-xs text-slate-500">
              {periodDays >= 1
                ? `Period: ${periodDays} day${periodDays === 1 ? "" : "s"} (minimum 1 day, maximum 93).`
                : "To date must be on or after From date."}
            </p>
            <FormField label="Coordinator">
              <Select
                value={form.coordinatorStaffId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, coordinatorStaffId: e.target.value }))
                }
              >
                <option value="">—</option>
                {staff.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.fullName || s.user?.fullName || s.staffId || s._id}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Remarks">
              <Textarea
                rows={2}
                value={form.remarks}
                onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              />
            </FormField>
            {editingId ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={formDisabled}
                  onClick={() => update.mutate()}
                >
                  {update.isPending ? "Saving…" : "Save changes"}
                </Button>
                <Button variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                disabled={formDisabled}
                onClick={() => create.mutate()}
              >
                Create roster
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Hospital rosters</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-2">
          {rosters.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No hospital rosters yet.
            </p>
          ) : (
            rosters.map((r) => (
              <div
                key={r._id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-3",
                  editingId === r._id
                    ? "border-brand-300 bg-brand-50/50"
                    : "border-slate-200",
                )}
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{r.name}</p>
                  <p className="text-xs text-slate-500">
                    {r.hospitalName ?? "Hospital"} · {periodLabel(r)}
                    {r.daysInMonth ? ` (${r.daysInMonth}d)` : ""} ·{" "}
                    {r.batchName ?? "Batch"} / {r.yearName ?? "Year"} ·{" "}
                    {(r.studentIds?.length ?? r.students?.length ?? 0)} students
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={statusBadge(r.status)}>{r.status}</Badge>
                  <Button size="sm" variant="secondary" onClick={() => onOpen(r._id)}>
                    Open
                  </Button>
                  {isAdmin && r.status !== "LOCKED" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startEdit(r)}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </Button>
                  ) : null}
                  {isAdmin ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-rose-700 hover:bg-rose-50"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (r.status === "LOCKED") {
                          toast.error(
                            "Unlock the roster first, then delete it.",
                          );
                          return;
                        }
                        if (
                          window.confirm(
                            `Delete roster "${r.name}"? This cannot be undone.`,
                          )
                        ) {
                          remove.mutate(r._id);
                        }
                      }}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Roster builder grid ────────────────────────────────────────────────────

const RosterBuilder = ({
  isAdmin,
  roster,
  shifts,
  departments,
  dutyCodes,
  onChanged,
}: {
  isAdmin: boolean;
  roster: HospitalRosterRecord;
  shifts: DutyShiftRecord[];
  departments: HospitalDepartmentRecord[];
  dutyCodes: RosterDutyCodeRecord[];
  onChanged: () => Promise<void>;
}) => {
  const locked = roster.status === "LOCKED";
  const dayCount = Math.max(1, Math.min(93, roster.daysInMonth || 1));
  const days = Array.from({ length: dayCount }, (_, i) => i + 1);
  const dayDateLabel = useCallback(
    (dayIndex: number) => {
      if (roster.startDateBs) {
        return offsetBsDate(roster.startDateBs, dayIndex - 1);
      }
      return String(dayIndex);
    },
    [roster.startDateBs],
  );
  const students = roster.students ?? [];
  const activeCodes = useMemo(
    () => dutyCodes.filter((c) => c.isActive !== false),
    [dutyCodes],
  );

  const [localCells, setLocalCells] = useState<HospitalRosterCell[]>(
    () => roster.cells ?? [],
  );
  const [selected, setSelected] = useState<{ studentId: string; day: number } | null>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [printPromptOpen, setPrintPromptOpen] = useState(false);
  const [printFields, setPrintFields] = useState({
    hospitalName: "",
    institutionName: "",
    preparedBy: "",
    approvedBy: "",
    includeNote: true,
  });
  const { user } = useAuth();
  /**
   * In-app cell clipboard for Ctrl+C / Ctrl+V on individual student cells
   * (shift, department, code, remarks) — not whole day columns.
   */
  const cellClipboardRef = useRef<{
    shiftId?: string;
    departmentId?: string;
    code?: string;
    remarks?: string;
  } | null>(null);
  const localCellsRef = useRef(localCells);
  localCellsRef.current = localCells;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Re-sync when opening a different roster. When the server revision changes,
  // only apply if there are no local unsaved edits (avoids wiping work mid-type).
  useEffect(() => {
    setLocalCells(roster.cells ?? []);
    setDirty(false);
    setSelected(null);
    cellClipboardRef.current = null;
  }, [roster._id]);

  useEffect(() => {
    if (dirtyRef.current) return;
    setLocalCells(roster.cells ?? []);
  }, [roster.updatedAt]);

  const cellMap = useMemo(() => {
    const m = new Map<string, HospitalRosterCell>();
    for (const c of localCells) {
      m.set(cellKey(c.studentId, c.day), c);
    }
    return m;
  }, [localCells]);

  const shiftById = useMemo(
    () => new Map(shifts.map((s) => [s._id, s])),
    [shifts],
  );
  const deptById = useMemo(
    () => new Map(departments.map((d) => [d._id, d])),
    [departments],
  );

  const cellLabel = useCallback(
    (c?: HospitalRosterCell) => {
      if (!c) return "";
      const parts: string[] = [];
      if (c.shiftId) {
        const s = shiftById.get(c.shiftId);
        if (s) parts.push(s.shortCode);
      }
      if (c.departmentId) {
        const d = deptById.get(c.departmentId);
        if (d) parts.push(d.shortCode);
      }
      if (c.code?.trim()) parts.push(c.code.trim());
      return parts.join("/");
    },
    [shiftById, deptById],
  );

  const cellColor = useCallback(
    (c?: HospitalRosterCell) => {
      if (!c?.shiftId) return undefined;
      return shiftById.get(c.shiftId)?.color || undefined;
    },
    [shiftById],
  );

  const setCell = (studentId: string, day: number, patch: Partial<HospitalRosterCell>) => {
    if (locked || !isAdmin) return;
    setLocalCells((prev) => {
      const key = cellKey(studentId, day);
      const existing = prev.find((c) => cellKey(c.studentId, c.day) === key);
      const rawShift =
        patch.shiftId !== undefined ? patch.shiftId : existing?.shiftId;
      const rawDept =
        patch.departmentId !== undefined
          ? patch.departmentId
          : existing?.departmentId;
      const next: HospitalRosterCell = {
        studentId,
        day,
        shiftId: cleanOptionalId(rawShift),
        departmentId: cleanOptionalId(rawDept),
        code: patch.code !== undefined ? patch.code : existing?.code ?? "",
        remarks: patch.remarks !== undefined ? patch.remarks : existing?.remarks ?? "",
      };
      const empty =
        !next.shiftId && !next.departmentId && !(next.code || "").trim();
      const rest = prev.filter((c) => cellKey(c.studentId, c.day) !== key);
      return empty ? rest : [...rest, next];
    });
    setDirty(true);
  };

  // Ctrl+C / Ctrl+V / Backspace on selected student cell (not when typing in inputs)
  useEffect(() => {
    if (!isAdmin || locked) return;

    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const sel = selectedRef.current;
      if (!sel) return;
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      // Clear selected cell
      if (!mod && (key === "backspace" || key === "delete")) {
        e.preventDefault();
        setCell(sel.studentId, sel.day, {
          shiftId: "",
          departmentId: "",
          code: "",
          remarks: "",
        });
        toast.success("Cell cleared");
        return;
      }

      if (!mod) return;

      if (key === "c") {
        const cell = localCellsRef.current.find(
          (c) => c.studentId === sel.studentId && c.day === sel.day,
        );
        cellClipboardRef.current = {
          shiftId: cell?.shiftId,
          departmentId: cell?.departmentId,
          code: cell?.code ?? "",
          remarks: cell?.remarks ?? "",
        };
        e.preventDefault();
        toast.success("Cell copied — select another cell and press Ctrl+V");
        return;
      }

      if (key === "v") {
        const clip = cellClipboardRef.current;
        if (!clip) {
          toast.message("Nothing copied yet. Select a cell and press Ctrl+C first.");
          return;
        }
        e.preventDefault();
        setCell(sel.studentId, sel.day, {
          shiftId: clip.shiftId ?? "",
          departmentId: clip.departmentId ?? "",
          code: clip.code ?? "",
          remarks: clip.remarks ?? "",
        });
        toast.success("Pasted into selected cell");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, locked, roster._id]);

  const persistCells = async (cells: HospitalRosterCell[]) =>
    unwrap<HospitalRosterRecord>(
      api.put(`/field-duty/hospital-rosters/${roster._id}/cells`, {
        cells: sanitizeCellsForApi(cells),
        replace: true,
      }),
    );

  const saveCells = useMutation({
    mutationFn: (cells: HospitalRosterCell[]) => persistCells(cells),
    onSuccess: async (saved, cells) => {
      toast.success("Roster saved");
      // Only clear dirty if the user did not edit further while the request was in flight.
      const stillMatches =
        JSON.stringify(sanitizeCellsForApi(localCellsRef.current)) ===
        JSON.stringify(sanitizeCellsForApi(cells));
      if (stillMatches) {
        setDirty(false);
        if (saved?.cells) setLocalCells(saved.cells);
      }
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  // Auto-save draft every 25s when dirty (uses ref so latest cells are sent)
  useEffect(() => {
    if (!dirty || locked || !isAdmin) return;
    const t = window.setTimeout(() => {
      if (dirtyRef.current && !locked) {
        saveCells.mutate(localCellsRef.current);
      }
    }, 25000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only re-arm timer on dirty/cells
  }, [dirty, localCells, locked, isAdmin, roster._id]);

  const lockMut = useMutation({
    mutationFn: async () => {
      // Persist unsaved cells with lock so work is never lost.
      const body =
        dirtyRef.current
          ? { cells: sanitizeCellsForApi(localCellsRef.current) }
          : {};
      return unwrap(
        api.post(`/field-duty/hospital-rosters/${roster._id}/lock`, body),
      );
    },
    onSuccess: async () => {
      toast.success("Roster locked");
      setDirty(false);
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const unlockMut = useMutation({
    mutationFn: () =>
      unwrap(api.post(`/field-duty/hospital-rosters/${roster._id}/unlock`)),
    onSuccess: async () => {
      toast.success("Roster unlocked");
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const fillRow = (studentId: string, shiftId: string, departmentId: string) => {
    if (locked || !isAdmin) return;
    const sh = cleanOptionalId(shiftId);
    const dep = cleanOptionalId(departmentId);
    setLocalCells((prev) => {
      const rest = prev.filter((c) => c.studentId !== studentId);
      if (!sh && !dep) return rest;
      const filled = days.map((day) => ({
        studentId,
        day,
        shiftId: sh,
        departmentId: dep,
        code: "",
        remarks: "",
      }));
      return [...rest, ...filled];
    });
    setDirty(true);
  };

  const clearRow = (studentId: string) => {
    if (locked || !isAdmin) return;
    setLocalCells((prev) => prev.filter((c) => c.studentId !== studentId));
    setDirty(true);
  };

  const removeStudentMut = useMutation({
    mutationFn: async (studentId: string) => {
      const remaining = (roster.studentIds ?? [])
        .map(String)
        .filter((id) => id !== studentId);
      // Persist cell grid without this student, then update student list
      // (backend also drops their cells when students are updated).
      await persistCells(
        localCellsRef.current.filter((c) => c.studentId !== studentId),
      );
      return unwrap(
        api.put(`/field-duty/hospital-rosters/${roster._id}/students`, {
          studentIds: remaining,
        }),
      );
    },
    onSuccess: async () => {
      toast.success("Student removed from roster");
      setDirty(false);
      setSelected(null);
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const onRosterIds = useMemo(
    () => new Set((roster.studentIds ?? students.map((s) => s.studentId)).map(String)),
    [roster.studentIds, students],
  );

  const assignableQuery = useQuery({
    queryKey: ["field-duty", "assignable", roster.batchId, roster.yearId],
    queryFn: () =>
      unwrap<FieldDutyRosterStudent[]>(
        api.get("/field-duty/assignable-students", {
          params: {
            batchId: roster.batchId || undefined,
            yearId: roster.yearId || undefined,
          },
        }),
      ),
    enabled: isAdmin && !locked && addOpen && Boolean(roster.batchId && roster.yearId),
  });

  const availableToAdd = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    return (assignableQuery.data ?? []).filter((s) => {
      if (onRosterIds.has(String(s._id))) return false;
      if (!q) return true;
      const hay = `${s.fullName} ${s.admissionNumber ?? ""} ${s.rollNumber ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [assignableQuery.data, onRosterIds, addSearch]);

  const addStudentsMut = useMutation({
    mutationFn: async (idsToAdd: string[]) => {
      const unique = [...new Set(idsToAdd.map(String).filter(Boolean))];
      if (!unique.length) throw new Error("Select at least one student to add");
      // Persist unsaved grid first so refetch does not wipe in-progress work.
      if (dirtyRef.current) {
        await persistCells(localCellsRef.current);
      }
      const current = (roster.studentIds ?? students.map((s) => s.studentId)).map(String);
      const merged = [...current];
      for (const id of unique) {
        if (!merged.includes(id)) merged.push(id);
      }
      return unwrap<HospitalRosterRecord>(
        api.put(`/field-duty/hospital-rosters/${roster._id}/students`, {
          studentIds: merged,
        }),
      );
    },
    onSuccess: async (saved, ids) => {
      toast.success(
        ids.length === 1 ? "Student added to roster" : `${ids.length} students added to roster`,
      );
      setPickedIds([]);
      setAddSearch("");
      setDirty(false);
      if (saved?.cells) setLocalCells(saved.cells);
      await onChanged();
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  const selectedCell = selected
    ? cellMap.get(cellKey(selected.studentId, selected.day))
    : undefined;

  const openPrintPrompt = () => {
    const branding = getPrintInstitutionBranding();
    setPrintFields({
      hospitalName: roster.hospitalName?.trim() || "Hospital",
      institutionName: branding.name?.trim() || "Institution",
      preparedBy:
        roster.preparedByName?.trim() ||
        roster.coordinatorName?.trim() ||
        user?.fullName?.trim() ||
        "",
      approvedBy: roster.approvedByName?.trim() || "",
      includeNote: true,
    });
    setPrintPromptOpen(true);
  };

  const printRoster = (fields: {
    hospitalName: string;
    institutionName: string;
    preparedBy: string;
    approvedBy: string;
    includeNote: boolean;
  }) => {
    const headDays = days
      .map((d) => {
        const date = roster.startDateBs ? dayDateLabel(d).slice(5) : "";
        return `<th>${d}${date ? `<div style="font-weight:400;color:#64748b">${escapePrintHtml(date)}</div>` : ""}</th>`;
      })
      .join("");
    const bodyRows =
      students.length > 0
        ? students
            .map((st, i) => {
              const dayCells = days
                .map((d) => {
                  const label = cellLabel(cellMap.get(cellKey(st.studentId, d)));
                  return `<td class="cell">${escapePrintHtml(label || "")}</td>`;
                })
                .join("");
              const notes = days
                .map((d) => cellMap.get(cellKey(st.studentId, d))?.remarks?.trim())
                .filter(Boolean)
                .slice(0, 3)
                .join("; ");
              const roll =
                st.rollNumber != null ? `R${st.rollNumber}` : st.admissionNumber ?? "";
              return `<tr>
                <td class="sn">${i + 1}</td>
                <td class="student">${escapePrintHtml(st.fullName)}${
                  roll
                    ? `<div style="font-weight:400;color:#64748b">${escapePrintHtml(String(roll))}</div>`
                    : ""
                }</td>
                ${dayCells}
                <td>${escapePrintHtml(notes || "")}</td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="${days.length + 3}">No students in this roster.</td></tr>`;

    const noteText = buildRosterShortFormNote(
      rosterMasterShortForms(shifts, departments, dutyCodes),
    );

    const collegeName = fields.institutionName.trim() || "Institution";
    const hospitalName = fields.hospitalName.trim() || "Hospital";
    openRosterPrintWindow(
      `${roster.name} — Hospital Duty Roster`,
      `<h1>Hospital Duty Roster</h1>
      <div class="meta">
        <strong>${escapePrintHtml(collegeName)}</strong>
        · ${escapePrintHtml(roster.name)}
        · ${escapePrintHtml(periodLabel(roster))} (${dayCount} day${dayCount === 1 ? "" : "s"})
        · ${escapePrintHtml(`${roster.batchName ?? "Batch"} / ${roster.yearName ?? "Year"}`)}
        · ${escapePrintHtml(roster.status)}
        · ${students.length} student(s)
      </div>
      <table>
        <thead>
          <tr>
            <th class="sn">S.N.</th>
            <th>Student</th>
            ${headDays}
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>`,
      {
        name: hospitalName,
        note: noteText,
        includeNote: fields.includeNote !== false,
        preparedBy: fields.preparedBy.trim(),
        approvedBy: fields.approvedBy.trim(),
      },
    );
  };

  const confirmPrintRoster = () => {
    const preparedBy = printFields.preparedBy.trim();
    const approvedBy = printFields.approvedBy.trim();
    setPrintPromptOpen(false);
    if (
      isAdmin &&
      (preparedBy !== (roster.preparedByName ?? "").trim() ||
        approvedBy !== (roster.approvedByName ?? "").trim())
    ) {
      void unwrap(
        api.put(`/field-duty/hospital-rosters/${roster._id}`, {
          preparedByName: preparedBy,
          approvedByName: approvedBy,
        }),
      )
        .then(() => onChanged())
        .catch(() => {
          /* print still proceeds even if names fail to persist */
        });
    }
    printRoster(printFields);
  };

  const printBranding = getPrintInstitutionBranding();
  const institutionName = printBranding.name || "Institution";

  return (
    <div className="space-y-4">
      <div className="hidden border-b border-slate-300 pb-3 text-center print:block">
        <p className="text-base font-bold uppercase tracking-wide text-slate-900">
          {roster.hospitalName || "Hospital"}
        </p>
        <p className="mt-2 text-sm font-semibold text-slate-800">
          Hospital Duty Roster
        </p>
        <p className="mt-1 text-sm text-slate-600">{institutionName}</p>
      </div>
      {printPromptOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4 print:hidden"
          onClick={() => setPrintPromptOpen(false)}
          role="presentation"
        >
          <form
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              confirmPrintRoster();
            }}
            aria-label="Print roster"
          >
            <h3 className="text-lg font-semibold text-slate-900">Print roster</h3>
            <p className="mt-1 text-sm text-slate-500">
              These names print under the signature lines at the bottom of the
              page. You can still edit the hospital name and other text in the
              preview before saving as PDF.
            </p>
            <div className="mt-4 space-y-3">
              <FormField label="Hospital name">
                <Input
                  autoFocus
                  value={printFields.hospitalName}
                  onChange={(e) =>
                    setPrintFields((p) => ({ ...p, hospitalName: e.target.value }))
                  }
                  placeholder="Hospital name on the print heading"
                />
              </FormField>
              <FormField label="Institution name">
                <Input
                  value={printFields.institutionName}
                  onChange={(e) =>
                    setPrintFields((p) => ({
                      ...p,
                      institutionName: e.target.value,
                    }))
                  }
                  placeholder="College / institution name"
                />
              </FormField>
              <FormField label="Prepared by">
                <Input
                  value={printFields.preparedBy}
                  onChange={(e) =>
                    setPrintFields((p) => ({ ...p, preparedBy: e.target.value }))
                  }
                  placeholder="Full name"
                />
              </FormField>
              <FormField label="Approved by">
                <Input
                  value={printFields.approvedBy}
                  onChange={(e) =>
                    setPrintFields((p) => ({ ...p, approvedBy: e.target.value }))
                  }
                  placeholder="Full name"
                />
              </FormField>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={printFields.includeNote}
                  onChange={(e) =>
                    setPrintFields((p) => ({
                      ...p,
                      includeNote: e.target.checked,
                    }))
                  }
                />
                <span>
                  Include note of short forms
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Printed under the table, above signatures — e.g. M = Morning,
                    ER = Emergency.
                  </span>
                </span>
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setPrintPromptOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1">
                <Printer className="mr-1.5 h-4 w-4" />
                Preview & print
              </Button>
            </div>
          </form>
        </div>
      ) : null}
      <Card className="print:shadow-none">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{roster.name}</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              {roster.hospitalName || "Hospital"} · {periodLabel(roster)} ({dayCount} day
              {dayCount === 1 ? "" : "s"}) · {roster.batchName}/{roster.yearName} ·{" "}
              <Badge className={statusBadge(roster.status)}>{roster.status}</Badge>
              {dirty ? (
                <span className="ml-2 text-amber-700">Unsaved changes</span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            {isAdmin && !locked ? (
              <Button
                type="button"
                size="sm"
                variant={addOpen ? "default" : "outline"}
                onClick={() => {
                  setAddOpen((v) => !v);
                  setPickedIds([]);
                  setAddSearch("");
                }}
              >
                <UserPlus className="mr-1 h-3.5 w-3.5" />
                {addOpen ? "Hide add students" : "Add students"}
              </Button>
            ) : null}
            {isAdmin && !locked ? (
              <Button
                type="button"
                size="sm"
                disabled={saveCells.isPending}
                onClick={() => saveCells.mutate(localCellsRef.current)}
              >
                {saveCells.isPending ? "Saving…" : "Save roster"}
              </Button>
            ) : null}
            {isAdmin && !locked ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => lockMut.mutate()}
                disabled={lockMut.isPending || saveCells.isPending}
              >
                <Lock className="mr-1 h-3.5 w-3.5" />
                Lock
              </Button>
            ) : null}
            {isAdmin && locked ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => unlockMut.mutate()}
                disabled={unlockMut.isPending}
              >
                <LockOpen className="mr-1 h-3.5 w-3.5" />
                Unlock
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="outline" onClick={openPrintPrompt}>
              <Printer className="mr-1 h-3.5 w-3.5" />
              Print
            </Button>
          </div>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3">
          {isAdmin && !locked && addOpen ? (
            <Card className="border-brand-200 bg-brand-50/40 print:hidden">
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      Add students from {roster.batchName ?? "this batch"} /{" "}
                      {roster.yearName ?? "year"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Use this if a student was removed by mistake. Only active students
                      not already on this roster are listed.
                    </p>
                  </div>
                  <Input
                    className="w-56"
                    placeholder="Search name, roll, admission…"
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                  />
                </div>
                {assignableQuery.isLoading ? (
                  <LoadingState />
                ) : availableToAdd.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    {(assignableQuery.data ?? []).every((s) => onRosterIds.has(String(s._id))) &&
                    (assignableQuery.data ?? []).length > 0
                      ? "Every active student from this batch and year is already on the roster."
                      : "No matching students found to add."}
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setPickedIds(availableToAdd.map((s) => String(s._id)))
                        }
                      >
                        Select all ({availableToAdd.length})
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPickedIds([])}
                        disabled={pickedIds.length === 0}
                      >
                        Clear selection
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={pickedIds.length === 0 || addStudentsMut.isPending}
                        onClick={() => addStudentsMut.mutate(pickedIds)}
                      >
                        <UserPlus className="mr-1 h-3.5 w-3.5" />
                        {addStudentsMut.isPending
                          ? "Adding…"
                          : `Add selected (${pickedIds.length})`}
                      </Button>
                    </div>
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                      <Table>
                        <TableHead>
                          <tr>
                            <Th className="w-10" />
                            <Th>Roll</Th>
                            <Th>Student</Th>
                            <Th>Admission</Th>
                          </tr>
                        </TableHead>
                        <TableBody>
                          {availableToAdd.map((s) => {
                            const id = String(s._id);
                            const checked = pickedIds.includes(id);
                            return (
                              <tr key={id}>
                                <Td>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      setPickedIds((prev) =>
                                        checked
                                          ? prev.filter((x) => x !== id)
                                          : [...prev, id],
                                      )
                                    }
                                  />
                                </Td>
                                <Td className="text-sm">{s.rollNumber ?? "—"}</Td>
                                <Td className="text-sm font-medium">{s.fullName}</Td>
                                <Td className="text-xs text-slate-500">
                                  {s.admissionNumber || "—"}
                                </Td>
                              </tr>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Grid */}
          <div className="max-h-[min(70vh,720px)] overflow-auto overscroll-contain rounded-xl border border-slate-200 [scrollbar-width:thin]">
            <table className="w-full min-w-[1100px] border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th className="sticky left-0 z-20 w-9 border border-slate-200 bg-slate-50 px-1 py-2 text-center font-semibold text-slate-700">
                    S.N.
                  </th>
                  <th className="sticky left-9 z-20 border border-slate-200 bg-slate-50 px-2 py-2 text-left font-semibold text-slate-700">
                    Student
                  </th>
                  {days.map((d) => (
                    <th
                      key={d}
                      className="border border-slate-200 px-1 py-2 text-center font-semibold text-slate-600"
                      title={dayDateLabel(d)}
                    >
                      <div>{d}</div>
                      {roster.startDateBs ? (
                        <div className="text-[9px] font-normal text-slate-400">
                          {dayDateLabel(d).slice(5)}
                        </div>
                      ) : null}
                    </th>
                  ))}
                  <th className="border border-slate-200 px-2 py-2 text-left font-semibold text-slate-700">
                    Remarks
                  </th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td
                      colSpan={days.length + 3}
                      className="border border-slate-200 px-3 py-8 text-center text-slate-500"
                    >
                      No students in this roster. Use Add students to put them back
                      from this batch and year.
                    </td>
                  </tr>
                ) : (
                  students.map((st, i) => (
                    <tr key={st.studentId}>
                      <td className="sticky left-0 z-10 w-9 border border-slate-200 bg-white px-1 py-1 text-center tabular-nums font-semibold text-slate-700">
                        {i + 1}
                      </td>
                      <td className="sticky left-9 z-10 max-w-[180px] border border-slate-200 bg-white px-2 py-1 font-medium text-slate-900">
                        <div className="truncate" title={st.fullName}>
                          {st.fullName}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {st.rollNumber != null ? `R${st.rollNumber}` : ""}{" "}
                          {st.admissionNumber ?? ""}
                        </div>
                        {isAdmin && !locked ? (
                          <div className="mt-0.5 flex flex-wrap gap-1 print:hidden">
                            <button
                              type="button"
                              className="text-[10px] text-brand-700 underline"
                              onClick={() => {
                                const sh = shifts[0]?._id ?? "";
                                const dep = departments[0]?._id ?? "";
                                fillRow(st.studentId, sh, dep);
                              }}
                            >
                              Fill
                            </button>
                            <button
                              type="button"
                              className="text-[10px] text-amber-700 underline"
                              onClick={() => clearRow(st.studentId)}
                            >
                              Clear days
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-700 underline"
                              disabled={removeStudentMut.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Remove ${st.fullName} from this roster? Their day assignments will be deleted.`,
                                  )
                                ) {
                                  removeStudentMut.mutate(st.studentId);
                                }
                              }}
                            >
                              <UserMinus className="h-3 w-3" />
                              Remove
                            </button>
                          </div>
                        ) : null}
                      </td>
                      {days.map((d) => {
                        const c = cellMap.get(cellKey(st.studentId, d));
                        const active =
                          selected?.studentId === st.studentId && selected.day === d;
                        return (
                          <td
                            key={d}
                            className={cn(
                              "border border-slate-200 px-0.5 py-0.5 text-center",
                              active && "ring-2 ring-brand-400 ring-inset",
                              isAdmin && !locked && "cursor-pointer hover:bg-brand-50",
                            )}
                            style={{ background: cellColor(c) }}
                            onClick={() => {
                              if (!isAdmin || locked) return;
                              setSelected({ studentId: st.studentId, day: d });
                            }}
                          >
                            <span className="font-mono text-[11px] font-semibold">
                              {cellLabel(c) || "·"}
                            </span>
                          </td>
                        );
                      })}
                      <td className="border border-slate-200 px-1 text-[10px] text-slate-500">
                        {(() => {
                          const notes = days
                            .map((d) => cellMap.get(cellKey(st.studentId, d))?.remarks?.trim())
                            .filter(Boolean);
                          return notes.length ? notes.slice(0, 2).join("; ") : "—";
                        })()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Cell editor */}
          {isAdmin && !locked && selected ? (
            <Card className="border-brand-200 bg-brand-50/40 print:hidden">
              <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-4">
                <p className="sm:col-span-2 lg:col-span-4 text-sm font-medium text-slate-800">
                  Editing day {selected.day} —{" "}
                  {students.find((s) => s.studentId === selected.studentId)?.fullName}
                </p>

                <FormField label="Shift">
                  <Select
                    value={selectedCell?.shiftId ?? ""}
                    onChange={(e) =>
                      setCell(selected.studentId, selected.day, {
                        shiftId: e.target.value || "",
                      })
                    }
                  >
                    <option value="">—</option>
                    {shifts
                      .filter((s) => s.isActive)
                      .map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.shortCode} — {s.name}
                        </option>
                      ))}
                  </Select>
                </FormField>
                <FormField label="Department">
                  <Select
                    value={selectedCell?.departmentId ?? ""}
                    onChange={(e) =>
                      setCell(selected.studentId, selected.day, {
                        departmentId: e.target.value || "",
                      })
                    }
                  >
                    <option value="">—</option>
                    {departments
                      .filter((d) => d.isActive)
                      .map((d) => (
                        <option key={d._id} value={d._id}>
                          {d.shortCode} — {d.name}
                        </option>
                      ))}
                  </Select>
                </FormField>
                <FormField label="Code (Off / Leave / …)">
                  <Select
                    value={selectedCell?.code ?? ""}
                    onChange={(e) =>
                      setCell(selected.studentId, selected.day, {
                        code: e.target.value,
                      })
                    }
                  >
                    <option value="">—</option>
                    {activeCodes.map((c) => (
                      <option key={c._id} value={c.code}>
                        {c.code} — {c.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Cell remarks">
                  <Input
                    value={selectedCell?.remarks ?? ""}
                    onChange={(e) =>
                      setCell(selected.studentId, selected.day, {
                        remarks: e.target.value,
                      })
                    }
                  />
                </FormField>
                <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setCell(selected.studentId, selected.day, {
                        // Empty string (not undefined) = explicit clear
                        shiftId: "",
                        departmentId: "",
                        code: "",
                        remarks: "",
                      })
                    }
                  >
                    Clear cell
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setSelected(null)}>
                    Done
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
            <span className="font-semibold text-slate-900">Note: </span>
            {buildRosterShortFormNote(
              rosterMasterShortForms(shifts, departments, dutyCodes),
            ) || "M = Morning, ER = Emergency"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Duty summary / clinical record ─────────────────────────────────────────

const DutySummaryView = ({ summary }: { summary: HospitalRosterSummary }) => {
  const deptCodes = useMemo(() => {
    const set = new Set<string>();
    for (const row of summary.dutySummary) {
      Object.keys(row.byDepartment).forEach((k) => set.add(k));
    }
    summary.departmentLegend.forEach((d) => set.add(d.shortCode));
    return Array.from(set).sort();
  }, [summary]);

  const shiftCodes = useMemo(() => {
    const set = new Set<string>();
    for (const row of summary.dutySummary) {
      Object.keys(row.byShift).forEach((k) => set.add(k));
    }
    summary.shiftLegend.forEach((s) => set.add(s.shortCode));
    return Array.from(set).sort();
  }, [summary]);

  const dutyRows = useMemo(
    () => [...summary.dutySummary].sort(compareRollNo),
    [summary.dutySummary],
  );
  const clinicalRows = useMemo(
    () => [...summary.clinicalRecord].sort(compareRollNo),
    [summary.clinicalRecord],
  );

  const roster = summary.roster;

  const printSection = (title: string, tableHtml: string) => {
    const collegeName =
      getPrintInstitutionBranding().name?.trim() || "Institution";
    const noteText = buildRosterShortFormNote([
      ...summary.shiftLegend.map((s, i) => ({
        short: s.shortCode,
        full: s.name,
        sortOrder: i,
      })),
      ...summary.departmentLegend.map((d, i) => ({
        short: d.shortCode,
        full: d.name,
        sortOrder: 1000 + i,
      })),
      ...(summary.codeLegend ?? []).map((c, i) => ({
        short: c.code,
        full: c.label,
        sortOrder: 2000 + i,
      })),
    ]);
    openRosterPrintWindow(
      `${roster.name} — ${title}`,
      `<style>
        table.summary { font-size: 11px; }
        th.sn, td.sn, th.roll, td.roll { text-align: center; width: 36px; }
      </style>
      <h1>${escapePrintHtml(title)}</h1>
      <div class="meta">
        <strong>${escapePrintHtml(collegeName)}</strong>
        · ${escapePrintHtml(roster.name)}
        · ${escapePrintHtml(periodLabel(roster))}
        ${roster.daysInMonth ? ` · ${roster.daysInMonth} day(s)` : ""}
        ${roster.batchName || roster.yearName ? ` · ${escapePrintHtml(`${roster.batchName ?? "Batch"} / ${roster.yearName ?? "Year"}`)}` : ""}
      </div>
      ${tableHtml}`,
      {
        name: roster.hospitalName || "Hospital",
        note: noteText,
        preparedBy: roster.preparedByName,
        approvedBy: roster.approvedByName,
      },
    );
  };

  const printStudentDuty = () => {
    const rows = dutyRows
      .map(
        (row, i) => `<tr>
          <td class="sn">${i + 1}</td>
          <td class="roll">${escapePrintHtml(rollLabel(row.rollNumber))}</td>
          <td class="student">${escapePrintHtml(row.fullName)}</td>
          <td class="cell">${row.totalDuties}</td>
          <td class="cell">${row.totalDutyHours}</td>
          <td class="cell">${row.workingDays}</td>
          <td class="cell">${row.leaveDays}</td>
          <td class="cell">${row.offDays}</td>
        </tr>`,
      )
      .join("");
    printSection(
      "Student duty summary",
      `<table class="summary">
        <thead>
          <tr>
            <th class="sn">S.N.</th><th class="roll">Roll</th><th>Student</th>
            <th>Total duties</th><th>Duty hours</th>
            <th>Working days</th><th>Leave</th><th>Off</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="8">No duty rows.</td></tr>`}</tbody>
      </table>`,
    );
  };

  const printDepartmentDays = () => {
    const head = deptCodes.map((c) => `<th>${escapePrintHtml(c)}</th>`).join("");
    const rows = dutyRows
      .map((row, i) => {
        const total = Object.values(row.byDepartment).reduce((a, b) => a + b, 0);
        return `<tr>
          <td class="sn">${i + 1}</td>
          <td class="roll">${escapePrintHtml(rollLabel(row.rollNumber))}</td>
          <td class="student">${escapePrintHtml(row.fullName)}</td>
          ${deptCodes
            .map((c) => `<td class="cell">${row.byDepartment[c] ?? 0}</td>`)
            .join("")}
          <td class="cell">${total}</td>
        </tr>`;
      })
      .join("");
    printSection(
      "Department days by student",
      `<table class="summary">
        <thead>
          <tr>
            <th class="sn">S.N.</th><th class="roll">Roll</th><th>Student</th>
            ${head}<th>Dept days</th>
          </tr>
        </thead>
        <tbody>${
          rows ||
          `<tr><td colspan="${deptCodes.length + 4}">No department assignments.</td></tr>`
        }</tbody>
      </table>`,
    );
  };

  const printShiftDays = () => {
    const head = shiftCodes.map((c) => `<th>${escapePrintHtml(c)}</th>`).join("");
    const rows = dutyRows
      .map((row, i) => {
        const total = Object.values(row.byShift).reduce((a, b) => a + b, 0);
        return `<tr>
          <td class="sn">${i + 1}</td>
          <td class="roll">${escapePrintHtml(rollLabel(row.rollNumber))}</td>
          <td class="student">${escapePrintHtml(row.fullName)}</td>
          ${shiftCodes
            .map((c) => `<td class="cell">${row.byShift[c] ?? 0}</td>`)
            .join("")}
          <td class="cell">${total}</td>
          <td class="cell">${row.totalDutyHours}</td>
        </tr>`;
      })
      .join("");
    printSection(
      "Shift days by student",
      `<table class="summary">
        <thead>
          <tr>
            <th class="sn">S.N.</th><th class="roll">Roll</th><th>Student</th>
            ${head}<th>Shift days</th><th>Hours</th>
          </tr>
        </thead>
        <tbody>${
          rows ||
          `<tr><td colspan="${shiftCodes.length + 5}">No shift assignments.</td></tr>`
        }</tbody>
      </table>`,
    );
  };

  const printClinicalRecord = () => {
    const head = deptCodes.map((c) => `<th>${escapePrintHtml(c)}</th>`).join("");
    const rows = clinicalRows
      .map(
        (row, i) => `<tr>
          <td class="sn">${i + 1}</td>
          <td class="roll">${escapePrintHtml(rollLabel(row.rollNumber))}</td>
          <td class="student">${escapePrintHtml(row.fullName)}</td>
          ${deptCodes
            .map((c) => `<td class="cell">${row.byDepartment[c] ?? 0}</td>`)
            .join("")}
          <td class="cell">${row.totalDuties}</td>
        </tr>`,
      )
      .join("");
    printSection(
      "Clinical duty record (departments)",
      `<table class="summary">
        <thead>
          <tr>
            <th class="sn">S.N.</th><th class="roll">Roll</th><th>Student</th>
            ${head}<th>Total duties</th>
          </tr>
        </thead>
        <tbody>${
          rows ||
          `<tr><td colspan="${deptCodes.length + 4}">No clinical duty rows.</td></tr>`
        }</tbody>
      </table>`,
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Student duty summary</CardTitle>
            <p className="text-sm text-slate-500">
              {roster.name} · {periodLabel(roster)}
              {roster.daysInMonth ? ` · ${roster.daysInMonth} day(s)` : ""}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={printStudentDuty}>
            <Printer className="mr-1 h-3.5 w-3.5" />
            Print
          </Button>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[960px]">
              <TableHead>
                <tr>
                  <Th className="w-12 text-center">S.N.</Th>
                  <Th className="w-16 text-center">Roll</Th>
                  <Th>Student</Th>
                  <Th>Total duties</Th>
                  <Th>Duty hours</Th>
                  <Th>Working days</Th>
                  <Th>Leave</Th>
                  <Th>Off</Th>
                </tr>
              </TableHead>
              <TableBody>
                {dutyRows.map((row, i) => (
                  <tr key={row.studentId}>
                    <Td className="text-center tabular-nums">{i + 1}</Td>
                    <Td className="text-center tabular-nums">{rollLabel(row.rollNumber)}</Td>
                    <Td className="font-medium">{row.fullName}</Td>
                    <Td className="tabular-nums">{row.totalDuties}</Td>
                    <Td className="tabular-nums">{row.totalDutyHours}</Td>
                    <Td className="tabular-nums">{row.workingDays}</Td>
                    <Td className="tabular-nums">{row.leaveDays}</Td>
                    <Td className="tabular-nums">{row.offDays}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Department days by student</CardTitle>
            <p className="text-sm text-slate-500">
              How many days each student worked in each department (column = department code).
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={printDepartmentDays}>
            <Printer className="mr-1 h-3.5 w-3.5" />
            Print
          </Button>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[960px]">
              <TableHead>
                <tr>
                  <Th className="w-12 text-center">S.N.</Th>
                  <Th className="w-16 text-center">Roll</Th>
                  <Th>Student</Th>
                  {deptCodes.map((c) => {
                    const name =
                      summary.departmentLegend.find((d) => d.shortCode === c)?.name ??
                      c;
                    return (
                      <Th key={c} className="text-center" title={name}>
                        {c}
                      </Th>
                    );
                  })}
                  <Th className="text-right">Dept days</Th>
                </tr>
              </TableHead>
              <TableBody>
                {dutyRows.map((row, i) => {
                  const deptTotal = Object.values(row.byDepartment).reduce(
                    (a, b) => a + b,
                    0,
                  );
                  return (
                    <tr key={row.studentId}>
                      <Td className="text-center tabular-nums">{i + 1}</Td>
                      <Td className="text-center tabular-nums">
                        {rollLabel(row.rollNumber)}
                      </Td>
                      <Td className="font-medium">{row.fullName}</Td>
                      {deptCodes.map((c) => (
                        <Td key={c} className="text-center tabular-nums">
                          {row.byDepartment[c] ?? 0}
                        </Td>
                      ))}
                      <Td className="text-right font-semibold tabular-nums">
                        {deptTotal}
                      </Td>
                    </tr>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {deptCodes.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">
              No department assignments in this roster yet.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Shift days by student</CardTitle>
            <p className="text-sm text-slate-500">
              How many days each student worked each shift (column = shift code). Separate from
              department counts.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={printShiftDays}>
            <Printer className="mr-1 h-3.5 w-3.5" />
            Print
          </Button>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[960px]">
              <TableHead>
                <tr>
                  <Th className="w-12 text-center">S.N.</Th>
                  <Th className="w-16 text-center">Roll</Th>
                  <Th>Student</Th>
                  {shiftCodes.map((c) => {
                    const sh = summary.shiftLegend.find((s) => s.shortCode === c);
                    return (
                      <Th
                        key={c}
                        className="text-center"
                        title={sh ? `${sh.name} (${sh.dutyHours}h)` : c}
                      >
                        {c}
                      </Th>
                    );
                  })}
                  <Th className="text-right">Shift days</Th>
                  <Th className="text-right">Hours</Th>
                </tr>
              </TableHead>
              <TableBody>
                {dutyRows.map((row, i) => {
                  const shiftTotal = Object.values(row.byShift).reduce(
                    (a, b) => a + b,
                    0,
                  );
                  return (
                    <tr key={row.studentId}>
                      <Td className="text-center tabular-nums">{i + 1}</Td>
                      <Td className="text-center tabular-nums">
                        {rollLabel(row.rollNumber)}
                      </Td>
                      <Td className="font-medium">{row.fullName}</Td>
                      {shiftCodes.map((c) => (
                        <Td key={c} className="text-center tabular-nums">
                          {row.byShift[c] ?? 0}
                        </Td>
                      ))}
                      <Td className="text-right font-semibold tabular-nums">
                        {shiftTotal}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {row.totalDutyHours}
                      </Td>
                    </tr>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {shiftCodes.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">
              No shift assignments in this roster yet.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Clinical duty record (departments)</CardTitle>
            <p className="text-sm text-slate-500">
              Same department matrix as above — compact clinical record view.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={printClinicalRecord}>
            <Printer className="mr-1 h-3.5 w-3.5" />
            Print
          </Button>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[960px]">
              <TableHead>
                <tr>
                  <Th className="w-12 text-center">S.N.</Th>
                  <Th className="w-16 text-center">Roll</Th>
                  <Th>Student</Th>
                  {deptCodes.map((c) => (
                    <Th key={c} className="text-center">
                      {c}
                    </Th>
                  ))}
                  <Th className="text-right">Total duties</Th>
                </tr>
              </TableHead>
              <TableBody>
                {clinicalRows.map((row, i) => (
                  <tr key={row.studentId}>
                    <Td className="text-center tabular-nums">{i + 1}</Td>
                    <Td className="text-center tabular-nums">
                      {rollLabel(row.rollNumber)}
                    </Td>
                    <Td className="font-medium">{row.fullName}</Td>
                    {deptCodes.map((c) => (
                      <Td key={c} className="text-center tabular-nums">
                        {row.byDepartment[c] ?? 0}
                      </Td>
                    ))}
                    <Td className="text-right font-semibold">{row.totalDuties}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
