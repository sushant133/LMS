import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  Megaphone,
  Printer,
  Receipt,
  Sparkles,
  Users,
  Wallet
} from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartBox } from "components/ui/chart-box";
import { useTranslation } from "react-i18next";
import {
  COLLEGE_STAFF_CATEGORY_LABELS,
  hasInstitutionAccess,
  type CollegeStaffCategory,
  type CollegeStaffRecord,
  type DashboardHighlight,
  type DashboardMetric,
  type DashboardNotificationItem,
  type DashboardResponse,
  type NoticeRecord,
  type UserProfile
} from "@phit-erp/shared";
import { useAuth } from "features/auth/AuthProvider";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Select } from "components/ui/select";
import { FormField } from "components/shared/FormField";
import { PageContent } from "components/layout/PageContent";
import { StudentNameLink } from "components/shared/StudentNameLink";
import { api, unwrap } from "lib/api";
import { appConfig } from "lib/config";
import {
  getCollegeDisplayName,
  getUserDisplayTitle,
  getUserRoleSubtitle,
  roleLabelMap,
} from "lib/auth";
import { useIsCollege } from "hooks/useInstitutionType";
import { AcademicCalendarWidgets } from "features/dashboard/AcademicCalendarWidgets";
import { DashboardSchedulePanels } from "features/dashboard/DashboardSchedulePanels";
import { DashboardBannerPopup } from "features/notices/DashboardBannerPopup";
import { useNotificationBadge } from "hooks/useNotificationBadge";
import { applyNotificationReadLocally, invalidateNotificationQueries } from "lib/notificationQueries";
import {
  buildPrintInstitutionHeaderHtml,
  getPrintInstitutionBranding,
  PRINT_INSTITUTION_HEADER_CSS,
} from "lib/printBranding";
import { cn, formatCurrencyNpr } from "lib/utils";

/** Soft premium surfaces — restrained color, fine borders, light elevation */
const panelClass =
  "border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_28px_-12px_rgba(15,23,42,0.12)]";

const INSTITUTION_MIX_COLORS = ["#0f172a", "#475569", "#94a3b8"];

/**
 * Shared categorical order for the demographics donuts, validated for
 * colorblind separation and contrast on white. Hues are assigned in this fixed
 * order and never cycled/re-ranked, so a category keeps its color when filters
 * change the slice count.
 */
const DEMOGRAPHIC_CHART_COLORS = [
  "#2563eb",
  "#ea580c",
  "#059669",
  "#7c3aed",
  "#ca8a04",
  "#e11d48",
];
/** Reserved neutrals — reads as "not a hue with meaning", never a real category. */
const UNSET_CHART_COLOR = "#94a3b8";
const OTHER_CHART_COLOR = "#334155";

/** Male / Female / Other pie colors */
const GENDER_CHART_COLORS: Record<string, string> = {
  Male: "#2563eb",
  Female: "#db2777",
  "Other / Unset": UNSET_CHART_COLOR,
  Other: UNSET_CHART_COLOR,
  male: "#2563eb",
  female: "#db2777",
};

/** Religion palette (stable by index for unknown labels) */
const RELIGION_CHART_COLORS = DEMOGRAPHIC_CHART_COLORS;

const religionColor = (name: string, index: number): string => {
  const fixed: Record<string, string> = {
    Hinduism: "#ea580c",
    Buddhism: "#ca8a04",
    Islam: "#059669",
    Kirat: "#7c3aed",
    Christianity: "#2563eb",
    Prakriti: "#0891b2",
    Bon: "#0c2d6b",
    Sikhism: "#db2777",
    Jainism: "#e11d48",
    Other: OTHER_CHART_COLOR,
    "Prefer not to say": UNSET_CHART_COLOR,
    Unset: UNSET_CHART_COLOR,
  };
  return fixed[name] ?? RELIGION_CHART_COLORS[index % RELIGION_CHART_COLORS.length]!;
};

/** Ethnicity category palette (stable by index for unknown labels) */
const ETHNICITY_CHART_COLORS = DEMOGRAPHIC_CHART_COLORS;

const ethnicityColor = (name: string, index: number): string => {
  const fixed: Record<string, string> = {
    "Brahmin / Chhetri": "#2563eb",
    Dalit: "#db2777",
    "Janajati / Indigenous": "#059669",
    Madhesi: "#ea580c",
    Muslim: "#7c3aed",
    Other: OTHER_CHART_COLOR,
    "Prefer not to say": UNSET_CHART_COLOR,
    Unset: UNSET_CHART_COLOR,
  };
  return fixed[name] ?? ETHNICITY_CHART_COLORS[index % ETHNICITY_CHART_COLORS.length]!;
};

type BreakdownSlice = { name: string; value: number };

type DemoRow = NonNullable<DashboardResponse["studentDemographics"]>[number];

const tallyGenderSlices = (rows: DemoRow[]): BreakdownSlice[] => {
  let male = 0;
  let female = 0;
  let other = 0;
  for (const s of rows) {
    const g = (s.gender ?? "").trim().toLowerCase();
    if (g === "male") male += 1;
    else if (g === "female") female += 1;
    else other += 1;
  }
  return [
    { name: "Male", value: male },
    { name: "Female", value: female },
    ...(other > 0 ? [{ name: "Other / Unset", value: other }] : []),
  ];
};

const tallyReligionSlices = (rows: DemoRow[]): BreakdownSlice[] => {
  const counts = new Map<string, number>();
  for (const s of rows) {
    const religion = (s.religion ?? "").trim() || "Unset";
    counts.set(religion, (counts.get(religion) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, value]) => ({ name, value }));
};

const tallyEthnicitySlices = (rows: DemoRow[]): BreakdownSlice[] => {
  const counts = new Map<string, number>();
  for (const s of rows) {
    const ethnicity = (s.ethnicityCategory ?? "").trim() || "Unset";
    counts.set(ethnicity, (counts.get(ethnicity) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, value]) => ({ name, value }));
};

/** Collapse male/MALE/Male into one Male slice so the donut never shows both. */
const normalizeGenderSlices = (slices: BreakdownSlice[]): BreakdownSlice[] => {
  let male = 0;
  let female = 0;
  let other = 0;
  for (const s of slices) {
    const key = (s.name ?? "").trim().toLowerCase();
    if (key === "male") male += s.value;
    else if (key === "female") female += s.value;
    else other += s.value;
  }
  return [
    { name: "Male", value: male },
    { name: "Female", value: female },
    ...(other > 0 ? [{ name: "Other / Unset", value: other }] : []),
  ];
};

const escapeDemoPrintHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const polarPoint = (cx: number, cy: number, r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const donutSlicePath = (
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  startDeg: number,
  endDeg: number,
): string => {
  const sweep = endDeg - startDeg;
  if (sweep >= 359.9) {
    return `M ${cx + outer} ${cy} A ${outer} ${outer} 0 1 1 ${cx - outer} ${cy} A ${outer} ${outer} 0 1 1 ${cx + outer} ${cy} M ${cx + inner} ${cy} A ${inner} ${inner} 0 1 0 ${cx - inner} ${cy} A ${inner} ${inner} 0 1 0 ${cx + inner} ${cy}`;
  }
  const o1 = polarPoint(cx, cy, outer, startDeg);
  const o2 = polarPoint(cx, cy, outer, endDeg);
  const i2 = polarPoint(cx, cy, inner, endDeg);
  const i1 = polarPoint(cx, cy, inner, startDeg);
  const large = sweep > 180 ? 1 : 0;
  return `M ${o1.x.toFixed(2)} ${o1.y.toFixed(2)} A ${outer} ${outer} 0 ${large} 1 ${o2.x.toFixed(2)} ${o2.y.toFixed(2)} L ${i2.x.toFixed(2)} ${i2.y.toFixed(2)} A ${inner} ${inner} 0 ${large} 0 ${i1.x.toFixed(2)} ${i1.y.toFixed(2)} Z`;
};

const buildDonutSvg = (
  slices: BreakdownSlice[],
  colorFor: (name: string, index: number) => string,
): string => {
  // Keep the original index so colors stay stable per category
  const visible = slices
    .map((s, index) => ({ ...s, color: colorFor(s.name, index) }))
    .filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  if (!total) {
    return `<svg viewBox="0 0 200 200" width="168" height="168"><circle cx="100" cy="100" r="58" fill="none" stroke="#e2e8f0" stroke-width="22"/></svg>`;
  }
  const cx = 100;
  const cy = 100;
  const outer = 58;
  const inner = 34;
  let cursor = -90;
  const paths: string[] = [];
  const labels: string[] = [];
  visible.forEach((slice) => {
    const sweep = (slice.value / total) * 360;
    const start = cursor;
    const end = cursor + sweep;
    const mid = start + sweep / 2;
    paths.push(
      `<path d="${donutSlicePath(cx, cy, outer, inner, start, end)}" fill="${slice.color}" stroke="#fff" stroke-width="1.5"/>`,
    );
    if (slice.value / total >= 0.06) {
      const tip = polarPoint(cx, cy, 78, mid);
      const anchor = tip.x >= cx ? "start" : "end";
      labels.push(
        `<text x="${tip.x.toFixed(1)}" y="${tip.y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="8" font-weight="600" fill="#334155">${escapeDemoPrintHtml(slice.name)} (${slice.value})</text>`,
      );
    }
    cursor = end;
  });
  return `<svg viewBox="0 0 200 200" width="168" height="168" overflow="visible">${paths.join("")}${labels.join("")}
    <text x="100" y="96" text-anchor="middle" font-size="8" fill="#94a3b8" font-weight="600">TOTAL</text>
    <text x="100" y="112" text-anchor="middle" font-size="16" fill="#0f172a" font-weight="700">${total}</text>
  </svg>`;
};

const buildChartPrintColumn = (
  title: string,
  slices: BreakdownSlice[],
  colorFor: (name: string, index: number) => string,
): string => {
  // Keep the original index so colors stay stable per category
  const visible = slices
    .map((s, index) => ({ ...s, color: colorFor(s.name, index) }))
    .filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  const rows = visible
    .map((s) => {
      const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
      return `<tr>
        <td><span class="swatch" style="background:${s.color}"></span>${escapeDemoPrintHtml(s.name)}</td>
        <td class="num">${s.value}</td>
        <td class="num">${pct}%</td>
      </tr>`;
    })
    .join("");
  return `<section class="col">
    <h2>${escapeDemoPrintHtml(title)}</h2>
    <div class="donut">${buildDonutSvg(slices, colorFor)}</div>
    <table>
      <thead><tr><th>Category</th><th>Students</th><th>%</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3">No data</td></tr>`}</tbody>
      <tfoot><tr><th>Total</th><th class="num">${total}</th><th></th></tr></tfoot>
    </table>
  </section>`;
};

const printDemographicsCharts = (opts: {
  scope: string;
  gender: BreakdownSlice[];
  ethnicity: BreakdownSlice[];
  religion: BreakdownSlice[];
}) => {
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Pop-up blocked — allow pop-ups to print the charts");
    return;
  }
  const branding = getPrintInstitutionBranding();
  const header = buildPrintInstitutionHeaderHtml({ branding });
  const title = "Student demographics";
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8"/>
    <title>${escapeDemoPrintHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: system-ui, sans-serif; color: #0f172a; padding: 8mm; }
      h1 { font-size: 15px; margin: 8px 0 2px; text-align: center; }
      .scope { text-align: center; font-size: 11px; color: #475569; margin: 0 0 10px; }
      .grid { display: flex; gap: 10px; align-items: flex-start; }
      .col { flex: 1; min-width: 0; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; }
      .col h2 { font-size: 12px; margin: 0 0 6px; text-align: center; }
      .donut { display: flex; justify-content: center; margin: 0 0 8px; }
      table { width: 100%; border-collapse: collapse; font-size: 9px; }
      th, td { border: 1px solid #e2e8f0; padding: 3px 4px; text-align: left; }
      th { background: #f8fafc; }
      td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
      .swatch { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
      .hint { margin-top: 8px; font-size: 10px; color: #64748b; }
      ${PRINT_INSTITUTION_HEADER_CSS}
      @page { size: A4 landscape; margin: 8mm; }
      @media print {
        body { padding: 0; }
        .no-print { display: none !important; }
      }
    </style>
  </head><body>
    <div class="no-print" style="margin-bottom:10px;display:flex;justify-content:flex-end;gap:8px">
      <button type="button" onclick="window.print()" style="padding:6px 12px;font-weight:600;cursor:pointer">Print / Save as PDF</button>
    </div>
    ${header}
    <h1>${escapeDemoPrintHtml(title)}</h1>
    <p class="scope">${escapeDemoPrintHtml(opts.scope)}</p>
    <div class="grid">
      ${buildChartPrintColumn("Students by Gender", opts.gender, (name) => GENDER_CHART_COLORS[name] ?? "#94a3b8")}
      ${buildChartPrintColumn("Students by Ethnicity", opts.ethnicity, ethnicityColor)}
      ${buildChartPrintColumn("Students by Religion", opts.religion, religionColor)}
    </div>
    <p class="hint">Printed ${new Date().toLocaleString()}</p>
  </body></html>`);
  win.document.close();
  win.document.title = title;
  try {
    const path = `${window.location.pathname}${window.location.search}` || "/";
    win.history.replaceState({}, title, path);
  } catch {
    /* ignore */
  }
};

/** Gender + ethnicity + religion donuts with batch / year (or class / section) filters. */
const StudentDemographicsCharts = ({
  data,
}: {
  data: DashboardResponse;
}) => {
  const isCollege = useIsCollege();
  const [batchId, setBatchId] = useState("");
  const [yearId, setYearId] = useState("");

  const batches = data.chartBatches ?? [];
  const years = data.chartYears ?? [];
  const rows = data.studentDemographics ?? [];

  const yearOptions = useMemo(() => {
    if (!batchId) return years;
    return years.filter((y) => !y.batchId || y.batchId === batchId);
  }, [batchId, years]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (batchId && r.batchId !== batchId) return false;
      if (yearId && r.yearId !== yearId) return false;
      return true;
    });
  }, [batchId, rows, yearId]);

  const genderData = useMemo(
    () => tallyGenderSlices(filteredRows),
    [filteredRows],
  );
  const religionData = useMemo(
    () => tallyReligionSlices(filteredRows),
    [filteredRows],
  );
  const ethnicityData = useMemo(
    () => tallyEthnicitySlices(filteredRows),
    [filteredRows],
  );

  const batchLabel = isCollege ? "Batch" : "Class";
  const yearLabel = isCollege ? "Year" : "Section";
  const batchName = batches.find((b) => b._id === batchId)?.name;
  const yearName = years.find((y) => y._id === yearId)?.name;
  const scopeParts = [
    "Active students",
    batchName ? `${batchLabel}: ${batchName}` : null,
    yearName ? `${yearLabel}: ${yearName}` : null,
    !batchId && !yearId ? "all batches & years" : null,
  ].filter(Boolean);
  const scope = scopeParts.join(" · ");

  const hasAnyDemo =
    rows.length > 0 ||
    (data.genderChart?.length ?? 0) > 0 ||
    (data.religionChart?.length ?? 0) > 0 ||
    (data.ethnicityChart?.length ?? 0) > 0;

  if (!hasAnyDemo) return null;

  /**
   * No filter → use server default charts (active / current running years).
   * With batch/year filter → recompute from full active-student demographics.
   */
  const hasChartFilter = Boolean(batchId || yearId);
  const genderSlices = normalizeGenderSlices(
    hasChartFilter && rows.length > 0
      ? genderData
      : (data.genderChart ?? genderData),
  );
  const religionSlices =
    hasChartFilter && rows.length > 0
      ? religionData
      : (data.religionChart ?? religionData);
  const ethnicitySlices =
    hasChartFilter && rows.length > 0
      ? ethnicityData
      : (data.ethnicityChart ?? ethnicityData);

  const chartScope = hasChartFilter
    ? scope
    : data.genderChartScope ||
      data.ethnicityChartScope ||
      data.religionChartScope ||
      scope;

  const legendBase = "/students/list";

  // Hide filter bar only when we have no batch/year options (non-admin / empty school)
  const showFilters = batches.length > 0 || years.length > 0;

  return (
    <div className="space-y-4">
      {showFilters ? (
        <Card className={cn(panelClass)}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold tracking-tight">
              Student demographics filters
            </CardTitle>
            <p className="text-sm text-slate-500">
              Filter gender, ethnicity, and religion charts by{" "}
              {batchLabel.toLowerCase()} and {yearLabel.toLowerCase()}.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label={batchLabel}>
              <Select
                value={batchId}
                onChange={(e) => {
                  setBatchId(e.target.value);
                  setYearId("");
                }}
              >
                <option value="">All {batchLabel.toLowerCase()}s</option>
                {batches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={yearLabel}>
              <Select
                value={yearId}
                onChange={(e) => setYearId(e.target.value)}
              >
                <option value="">All {yearLabel.toLowerCase()}s</option>
                {yearOptions.map((y) => (
                  <option key={y._id} value={y._id}>
                    {y.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="flex items-end">
              <Button
                size="sm"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={!batchId && !yearId}
                onClick={() => {
                  setBatchId("");
                  setYearId("");
                }}
              >
                Clear filters
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            printDemographicsCharts({
              scope: chartScope,
              gender: genderSlices,
              ethnicity: ethnicitySlices,
              religion: religionSlices,
            })
          }
        >
          <Printer className="mr-1.5 h-3.5 w-3.5" />
          Print all charts
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <BreakdownDonutCard
          title="Students by Gender"
          scope={chartScope}
          icon={<Users className="h-4 w-4 text-slate-600" strokeWidth={1.75} />}
          data={genderSlices}
          colorFor={(name) =>
            GENDER_CHART_COLORS[name] ?? INSTITUTION_MIX_COLORS[0]!
          }
          emptyMessage={
            hasChartFilter
              ? "No active students match this batch/year filter."
              : "No active students with gender recorded yet."
          }
          legendLinkBase={legendBase}
        />
        <BreakdownDonutCard
          title="Students by Ethnicity"
          scope={chartScope}
          icon={
            <Sparkles className="h-4 w-4 text-slate-600" strokeWidth={1.75} />
          }
          data={ethnicitySlices}
          colorFor={ethnicityColor}
          emptyMessage={
            hasChartFilter
              ? "No active students match this batch/year filter."
              : "No active students with ethnicity recorded yet."
          }
        />
        <BreakdownDonutCard
          title="Students by Religion"
          scope={chartScope}
          icon={
            <Sparkles className="h-4 w-4 text-slate-600" strokeWidth={1.75} />
          }
          data={religionSlices}
          colorFor={religionColor}
          emptyMessage={
            hasChartFilter
              ? "No active students match this batch/year filter."
              : "No active students with religion recorded yet."
          }
        />
      </div>
    </div>
  );
};

/**
 * Part-to-whole card: one clean donut (no floating slice labels — those collide
 * and clip) + a ranked legend where each row doubles as a proportion bar, so
 * small categories stay readable and comparable.
 */
const BreakdownDonutCard = ({
  title,
  scope,
  icon,
  data,
  colorFor,
  emptyMessage,
  /** When set, legend rows link to this path with ?gender=Name (for gender chart). */
  legendLinkBase,
}: {
  title: string;
  scope?: string;
  icon: ReactNode;
  data: BreakdownSlice[];
  colorFor: (name: string, index: number) => string;
  emptyMessage: string;
  legendLinkBase?: string;
}) => {
  const total = data.reduce((sum, s) => sum + s.value, 0);
  /** Keep the original index so a category never changes color when others drop out. */
  const slices = data
    .map((s, index) => ({ ...s, color: colorFor(s.name, index) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  const hasData = slices.length > 0 && total > 0;

  return (
    <Card className={cn(panelClass, "flex flex-col")}>
      <CardHeader className="space-y-1 border-slate-100/80 pb-2">
        <CardTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight sm:text-lg">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 bg-slate-50">
            {icon}
          </span>
          {title}
        </CardTitle>
        {scope ? (
          <p className="text-xs font-normal text-slate-500 sm:text-sm">{scope}</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {!hasData ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-slate-500">
            {emptyMessage}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="relative mx-auto w-full max-w-[300px]">
              <ChartBox height={216}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                    <Pie
                      data={slices}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius="98%"
                      innerRadius="68%"
                      startAngle={90}
                      endAngle={-270}
                      /** 2px surface gap between segments, not a border */
                      paddingAngle={slices.length > 1 ? 1.5 : 0}
                      cornerRadius={slices.length > 1 ? 4 : 0}
                      /** Keeps 1% categories visible instead of a hairline */
                      minAngle={slices.length > 1 ? 4 : 0}
                      stroke="#ffffff"
                      strokeWidth={slices.length > 1 ? 2 : 0}
                      isAnimationActive={false}
                    >
                      {slices.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      cursor={false}
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 8px 24px -12px rgba(15,23,42,0.25)",
                        fontSize: 13,
                        padding: "8px 12px",
                      }}
                      itemStyle={{ color: "#0f172a" }}
                      formatter={(value, name) => {
                        const n = typeof value === "number" ? value : Number(value);
                        const pct = total > 0 ? ((n / total) * 100).toFixed(0) : "0";
                        return [
                          `${n} student${n === 1 ? "" : "s"} (${pct}%)`,
                          String(name),
                        ];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </ChartBox>
              {/* Hero figure in the hole — the number the card leads with */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Total
                </span>
                <span className="text-[32px] font-bold leading-none tabular-nums text-slate-900">
                  {total}
                </span>
                <span className="mt-1 text-[11px] font-medium text-slate-500">
                  student{total === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            {/* Ranked legend — each row is also a proportion bar */}
            <div className="flex flex-col gap-2.5">
              {slices.map((entry) => {
                const pct = total > 0 ? (entry.value / total) * 100 : 0;
                const genderParam =
                  entry.name === "Other / Unset" || entry.name === "Other"
                    ? "Other"
                    : entry.name;
                const href = legendLinkBase
                  ? `${legendLinkBase}?gender=${encodeURIComponent(genderParam)}`
                  : undefined;
                const rowClass = "group block rounded-lg px-1 py-0.5 transition";
                const inner = (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="truncate text-[13px] font-medium text-slate-700">
                          {entry.name}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-1.5">
                        <span className="text-[13px] font-semibold tabular-nums text-slate-900">
                          {entry.value}
                        </span>
                        <span className="text-[11px] tabular-nums text-slate-400">
                          {Math.round(pct)}%
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(pct, 1.5)}%`,
                          backgroundColor: entry.color,
                        }}
                      />
                    </div>
                  </>
                );
                return href ? (
                  <Link
                    key={entry.name}
                    to={href}
                    className={cn(rowClass, "hover:bg-slate-50")}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={entry.name} className={rowClass}>
                    {inner}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const statIconMap: Record<string, typeof Users> = {
  Students: Users,
  Teachers: GraduationCap,
  Batches: BookOpen,
  Classes: BookOpen,
  Notices: Megaphone,
  "Unread Alerts": Bell,
  "Enrolled Subjects": BookOpen,
  "Attendance Days": CalendarDays,
  "Visible Notices": Megaphone,
  "Assigned Batches": BookOpen,
  "Assigned Classes": BookOpen,
  "Assigned Subjects": ClipboardList,
  "Linked Children": Users,
  "Children with Fees Due": Wallet,
  "Fee Entries": Receipt,
  "Passed Out": Users,
  Alumni: Users,
};

/**
 * Map dashboard metric labels → routes (with optional query filters).
 * Dynamic year names (e.g. "1st Year") open the student list filtered by year name.
 */
const resolveDashboardStatHref = (label: string): string | undefined => {
  // Always use /students/list so query filters are not dropped by index redirect
  const fixed: Record<string, string> = {
    Students: "/students/list",
    Teachers: "/teachers",
    /** Deep-link into Academic Structure → Batches panel */
    Batches: "/academics?section=batches",
    Classes: "/academics?section=classes",
    Years: "/academics?section=batches",
    Notices: "/notices",
    "Visible Notices": "/notices",
    "Unread Alerts": "/notifications",
    "Enrolled Subjects": "/my-subjects",
    "Attendance Days": "/attendance",
    "Assigned Batches": "/students/list",
    "Assigned Classes": "/students/list",
    "Assigned Subjects": "/academics/subject-assignments",
    "Linked Children": "/parent-portal",
    "Children with Fees Due": "/parent-portal",
    "Fee Entries": "/accounting?tab=fee-records",
    "Passed Out": "/students/list?status=PASSED_OUT",
    Alumni: "/students/list?status=ALUMNI",
  };
  if (fixed[label]) return fixed[label];

  // College year-level counts from admin dashboard (e.g. "1st Year", "2nd Year")
  // Match ACTIVE students in that year — same scope as dashboard counts
  if (/year/i.test(label) && !/^assigned/i.test(label)) {
    return `/students/list?yearName=${encodeURIComponent(label)}&status=ACTIVE`;
  }

  return undefined;
};

const dashboardStatHint = (label: string, href?: string): string | null => {
  if (!href) return null;
  if (label === "Unread Alerts") return "Open notifications →";
  if (label === "Students" || label.startsWith("1st") || label.startsWith("2nd") || label.startsWith("3rd") || /year/i.test(label)) {
    return "View students →";
  }
  if (label === "Passed Out" || label === "Alumni") return "View list →";
  if (label === "Teachers") return "View teachers →";
  if (label === "Batches") return "Open batches →";
  if (label === "Classes") return "Open classes →";
  if (label === "Years") return "Open academic structure →";
  if (label.includes("Notice")) return "Open notices →";
  if (label.includes("Subject")) return "Open →";
  if (label.includes("Attendance")) return "Open attendance →";
  if (label.includes("Children") || label.includes("Parent")) return "Open portal →";
  return "Open →";
};

const highlightToneClass: Record<NonNullable<DashboardHighlight["tone"]>, string> = {
  default: "border-slate-200/80 bg-white",
  info: "border-slate-200/80 bg-slate-50/80",
  success: "border-slate-200/80 bg-white",
  warning: "border-slate-200/90 bg-amber-50/40",
};

const formatNotificationTime = (value?: string): string => {
  if (!value) {
    return "Recently";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
};

/** Live analog wall clock for the dashboard hero (right column under Notice Board). */
const DashboardWallClock = ({ size = 132 }: { size?: number }) => {
  const reactId = useId().replace(/:/g, "");
  const faceGlowId = `clockFaceGlow-${reactId}`;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const hours = now.getHours() % 12;
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  // Standard analog geometry: 0° at 12 o'clock
  const secondDeg = seconds * 6;
  const minuteDeg = minutes * 6 + seconds * 0.1;
  const hourDeg = hours * 30 + minutes * 0.5;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;
  const hourLen = r * 0.42;
  const minuteLen = r * 0.58;
  const secondLen = r * 0.68;

  const handEnd = (deg: number, length: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return {
      x: cx + length * Math.cos(rad),
      y: cy + length * Math.sin(rad),
    };
  };

  const hourTip = handEnd(hourDeg, hourLen);
  const minuteTip = handEnd(minuteDeg, minuteLen);
  const secondTip = handEnd(secondDeg, secondLen);
  const secondTail = handEnd(secondDeg + 180, r * 0.14);

  const ticks = Array.from({ length: 60 }, (_, i) => {
    const deg = i * 6;
    const rad = ((deg - 90) * Math.PI) / 180;
    const major = i % 5 === 0;
    const outer = r - 2;
    const inner = major ? r - 10 : r - 5;
    return {
      key: i,
      x1: cx + outer * Math.cos(rad),
      y1: cy + outer * Math.sin(rad),
      x2: cx + inner * Math.cos(rad),
      y2: cy + inner * Math.sin(rad),
      major,
    };
  });

  const hourLabels = Array.from({ length: 12 }, (_, i) => {
    const n = i === 0 ? 12 : i;
    const deg = i * 30;
    const rad = ((deg - 90) * Math.PI) / 180;
    const lr = r * 0.72;
    return {
      n,
      x: cx + lr * Math.cos(rad),
      y: cy + lr * Math.sin(rad),
    };
  });

  const timeLabel = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      className="relative mx-auto shrink-0 select-none sm:mx-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Current time ${timeLabel}`}
      title={timeLabel}
    >
      {/* Bezel / rim */}
      <div
        className="absolute inset-0 rounded-full shadow-[0_4px_16px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.65)]"
        style={{
          background:
            "radial-gradient(circle at 35% 28%, #f8fafc 0%, #e2e8f0 55%, #cbd5e1 100%)",
          boxShadow:
            "0 6px 18px rgba(15,23,42,0.12), 0 1px 0 rgba(255,255,255,0.7) inset, 0 -1px 0 rgba(15,23,42,0.06) inset",
        }}
      />
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="relative block"
        aria-hidden
      >
        {/* Face */}
        <circle
          cx={cx}
          cy={cy}
          r={r - 5}
          fill="#fafbfc"
          stroke="#94a3b8"
          strokeWidth={1.25}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r - 5}
          fill={`url(#${faceGlowId})`}
          opacity={0.55}
        />
        <defs>
          <radialGradient id={faceGlowId} cx="38%" cy="32%" r="65%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#e2e8f0" stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* Tick marks */}
        {ticks.map((t) => (
          <line
            key={t.key}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.major ? "#0f172a" : "#94a3b8"}
            strokeWidth={t.major ? 1.75 : 0.9}
            strokeLinecap="round"
          />
        ))}

        {/* Hour numerals */}
        {hourLabels.map((h) => (
          <text
            key={h.n}
            x={h.x}
            y={h.y}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#0f172a"
            fontSize={size * 0.095}
            fontWeight={600}
            fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          >
            {h.n}
          </text>
        ))}

        {/* Hour hand */}
        <line
          x1={cx}
          y1={cy}
          x2={hourTip.x}
          y2={hourTip.y}
          stroke="#0f172a"
          strokeWidth={3.2}
          strokeLinecap="round"
        />
        {/* Minute hand */}
        <line
          x1={cx}
          y1={cy}
          x2={minuteTip.x}
          y2={minuteTip.y}
          stroke="#1e293b"
          strokeWidth={2.2}
          strokeLinecap="round"
        />
        {/* Second hand */}
        <line
          x1={secondTail.x}
          y1={secondTail.y}
          x2={secondTip.x}
          y2={secondTip.y}
          stroke="#64748b"
          strokeWidth={1.15}
          strokeLinecap="round"
        />
        {/* Center hub */}
        <circle cx={cx} cy={cy} r={3.6} fill="#0f172a" />
        <circle cx={cx} cy={cy} r={1.5} fill="#f8fafc" />
      </svg>
    </div>
  );
};

const DashboardHero = ({
  title,
  description,
  userName,
  roleLabel,
  roleSubtitle,
  institutionName,
  unreadCount
}: {
  title: string;
  description: string;
  userName: string;
  roleLabel: string;
  /** System role when roleLabel is a leadership designation (e.g. Teacher under Principal). */
  roleSubtitle?: string | null;
  institutionName?: string;
  unreadCount: number;
}) => (
  <section
    className={cn(
      "relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 sm:rounded-[1.75rem] sm:p-6 md:p-8",
      "shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.14)]",
    )}
  >
    {/* Thin premium accent — not a loud gradient wash */}
    <div
      className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-slate-800 via-slate-600 to-slate-400"
      aria-hidden
    />
    <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-slate-100/70 blur-3xl" aria-hidden />
    <div className="pointer-events-none absolute -bottom-24 -left-10 h-48 w-48 rounded-full bg-slate-50 blur-3xl" aria-hidden />
    {/*
      CSS grid keeps the action buttons pinned to the trailing edge.
      Flex + w-full previously allowed the button group to jump left after client navigation.
    */}
    <div className="relative grid min-h-0 gap-4 sm:gap-5 lg:min-h-[10.5rem] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-8">
      <div className="min-w-0 space-y-3 sm:space-y-3.5">
        <div className="flex min-h-7 flex-wrap items-center gap-2">
          <Badge className="shrink-0 border border-slate-800/10 bg-slate-900 text-white">
            {roleLabel}
          </Badge>
          {roleSubtitle ? (
            <Badge className="shrink-0 border border-slate-200 bg-slate-50 font-medium text-slate-600">
              {roleSubtitle}
            </Badge>
          ) : null}
          <Badge
            className={cn(
              "shrink-0 border border-slate-200 bg-slate-50 font-medium text-slate-700 transition-opacity",
              unreadCount > 0 ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            aria-hidden={unreadCount === 0}
          >
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "No unread notifications"}
          </Badge>
        </div>
        <div className="space-y-1.5 sm:space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 sm:text-xs">
            {appConfig.appName}
          </p>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl md:text-[2.15rem] md:leading-tight">
            Welcome back, {userName}
          </h1>
          {institutionName ? (
            <p className="truncate text-xs font-medium text-slate-500 sm:text-sm">
              {institutionName}
            </p>
          ) : null}
          <p className="max-w-2xl text-sm leading-relaxed text-slate-500 line-clamp-3 sm:line-clamp-none">
            {description}
          </p>
        </div>
      </div>
      {/* Right column: action buttons + wall clock under Notice Board (see screenshot marker) */}
      <div className="relative flex w-full shrink-0 flex-col items-stretch gap-4 sm:items-end lg:w-auto lg:justify-self-end lg:pt-1">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <Link
            to="/notifications"
            className={cn(
              "inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:min-w-[9.75rem] sm:flex-none sm:px-4",
            )}
          >
            <Bell className="mr-2 h-4 w-4 shrink-0 text-slate-500" />
            Notifications
          </Link>
          <Link
            to="/notices"
            className={cn(
              "inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 sm:min-w-[9.75rem] sm:flex-none sm:px-4",
            )}
          >
            <Megaphone className="mr-2 h-4 w-4 shrink-0 opacity-90" />
            Notice Board
          </Link>
        </div>
        {/* Extra top margin so the clock sits a little lower under Notice Board */}
        <div className="mt-3 flex justify-center sm:mt-4 sm:justify-end sm:pr-2 lg:mt-5 lg:pr-3">
          <DashboardWallClock size={128} />
        </div>
      </div>
    </div>
  </section>
);

const DashboardHeroSkeleton = () => (
  <section
    className={cn(
      "relative overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white p-6 md:p-8",
      "shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.14)]",
    )}
  >
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-slate-300" aria-hidden />
    <div className="grid min-h-0 gap-5 lg:min-h-[10.5rem] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-8">
      <div className="min-w-0 space-y-3">
        <div className="flex min-h-7 gap-2">
          <div className="h-6 w-36 animate-pulse rounded-full bg-slate-100" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
          <div className="h-9 w-3/4 max-w-lg animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-56 animate-pulse rounded bg-slate-100" />
          <div className="h-16 w-full max-w-2xl animate-pulse rounded bg-slate-50" />
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 justify-self-end lg:pt-1">
        <div className="h-10 w-[9.75rem] animate-pulse rounded-xl bg-slate-100" />
        <div className="h-10 w-[9.75rem] animate-pulse rounded-xl bg-slate-100" />
      </div>
    </div>
  </section>
);

const StatGrid = ({ stats }: { stats: DashboardMetric[] }) => (
  <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
    {stats.map((stat) => {
      const Icon = statIconMap[stat.label] ?? Sparkles;
      const href = resolveDashboardStatHref(stat.label);
      const hint = dashboardStatHint(stat.label, href);
      const content = (
        <Card
          className={cn(
            "h-full min-w-0 overflow-hidden transition duration-200",
            panelClass,
            href
              ? "cursor-pointer hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_8px_30px_-12px_rgba(15,23,42,0.18)]"
              : "hover:border-slate-300",
          )}
        >
          <CardContent className="relative flex min-h-[6.75rem] items-start justify-between gap-4 py-5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                {stat.label}
              </p>
              <p className="mt-2.5 break-words text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
                {stat.value}
              </p>
              {stat.change ? (
                <p className="mt-1.5 text-xs font-medium text-slate-500">{stat.change}</p>
              ) : null}
              {hint ? (
                <p className="mt-2.5 truncate text-xs font-medium text-slate-500">
                  {hint}
                </p>
              ) : null}
            </div>
            <div className="shrink-0 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-slate-600">
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </div>
          </CardContent>
        </Card>
      );

      if (href) {
        return (
          <Link key={stat.label} to={href} className="block min-w-0">
            {content}
          </Link>
        );
      }

      return (
        <div key={stat.label} className="min-w-0">
          {content}
        </div>
      );
    })}
  </div>
);

const HighlightsRow = ({
  highlights,
  onAction
}: {
  highlights: DashboardHighlight[];
  onAction?: (action: NonNullable<DashboardHighlight["action"]>) => void;
}) => {
  if (highlights.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
      {highlights.map((highlight) => {
        const content = (
          <Card
            className={cn(
              "h-full transition duration-200 hover:-translate-y-0.5 hover:border-slate-300",
              panelClass,
              highlightToneClass[highlight.tone ?? "default"],
            )}
          >
            <CardContent className="flex items-center justify-between gap-4 py-5">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  {highlight.label}
                </p>
                <p className="mt-1.5 text-lg font-semibold tracking-tight text-slate-900">
                  {highlight.value}
                </p>
              </div>
              {highlight.href || highlight.action ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-100 bg-slate-50">
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                </span>
              ) : null}
            </CardContent>
          </Card>
        );

        if (highlight.action) {
          return (
            <button
              key={`${highlight.label}-${highlight.value}`}
              type="button"
              className="block w-full text-left"
              onClick={() => onAction?.(highlight.action!)}
            >
              {content}
            </button>
          );
        }

        return highlight.href ? (
          <Link key={`${highlight.label}-${highlight.value}`} to={highlight.href} className="block">
            {content}
          </Link>
        ) : (
          <div key={`${highlight.label}-${highlight.value}`}>{content}</div>
        );
      })}
    </div>
  );
};

const NotificationsPanel = ({
  notifications,
  unreadCount
}: {
  notifications: DashboardNotificationItem[];
  unreadCount: number;
}) => {
  const unreadNotifications = notifications.filter((notification) => !notification.read);

  const markRead = useMutation({
    mutationFn: (id: string) => unwrap(api.put(`/notifications/${id}/read`)),
    onMutate: (id) => {
      applyNotificationReadLocally(id);
    },
    onError: async () => {
      await invalidateNotificationQueries();
    },
    onSettled: async () => {
      await invalidateNotificationQueries();
    }
  });

  const markAllRead = useMutation({
    mutationFn: () => unwrap(api.put("/notifications/read-all")),
    onMutate: () => {
      applyNotificationReadLocally();
    },
    onError: async () => {
      await invalidateNotificationQueries();
    },
    onSettled: async () => {
      await invalidateNotificationQueries();
    }
  });

  return (
    <Card className={cn(panelClass)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 border-slate-100/80">
        <div>
          <CardTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 bg-slate-50">
              <Bell className="h-4 w-4 text-slate-600" strokeWidth={1.75} />
            </span>
            Latest Notifications
          </CardTitle>
          <p className="mt-1.5 text-sm text-slate-500">
            Alerts clear from your inbox after you open them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 ? (
            <Badge className="border border-slate-200 bg-slate-50 font-medium text-slate-700">
              {unreadCount} unread
            </Badge>
          ) : null}
          {unreadCount > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
              Clear all
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {unreadNotifications.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/90 bg-slate-50/40 px-4 py-10 text-center text-sm text-slate-500">
            You&apos;re all caught up. No notifications.
          </div>
        ) : (
          unreadNotifications.map((notification) => (
            <button
              key={notification._id}
              type="button"
              className={cn(
                "w-full rounded-2xl border border-slate-200/90 bg-white px-4 py-3.5 text-left transition",
                "hover:border-slate-300 hover:bg-slate-50/60 hover:shadow-sm",
              )}
              onClick={() => markRead.mutate(notification._id)}
              disabled={markRead.isPending}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold tracking-tight text-slate-900">
                      {notification.title}
                    </p>
                    <Badge className="border border-slate-200 bg-slate-50 text-slate-600">
                      {notification.type}
                    </Badge>
                    <Badge className="border border-slate-800/10 bg-slate-900 text-white">
                      New
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    {notification.message}
                  </p>
                </div>
              </div>
              <p className="mt-2.5 text-xs font-medium text-slate-400">
                {formatNotificationTime(notification.createdAt)}
              </p>
            </button>
          ))
        )}
        <Button asChild variant="outline" className="w-full border-slate-200">
          <Link to="/notifications">View all notifications</Link>
        </Button>
      </CardContent>
    </Card>
  );
};

const NoticesPanel = ({ notices, title }: { notices: NoticeRecord[]; title?: string }) => (
  <Card className={cn(panelClass)}>
    <CardHeader className="border-slate-100/80 bg-white">
      <CardTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 bg-slate-50">
          <Megaphone className="h-4 w-4 text-slate-600" strokeWidth={1.75} />
        </span>
        {title ?? "Notice Board"}
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-2.5 bg-white">
      {notices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200/90 bg-slate-50/40 px-4 py-10 text-center text-sm text-slate-500">
          No notices published right now.
        </div>
      ) : (
        notices.map((notice) => (
          <div
            key={notice._id}
            className="rounded-2xl border border-slate-200/90 bg-slate-50/30 p-4 transition hover:bg-slate-50/70"
          >
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-semibold tracking-tight text-slate-900">
                {notice.title}
              </h3>
              <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-500">
                {notice.publishDateBs}
              </span>
            </div>
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-600">
              {notice.content}
            </p>
          </div>
        ))
      )}
      <Button asChild variant="outline" className="w-full border-slate-200">
        <Link to="/notices">Open notice board</Link>
      </Button>
    </CardContent>
  </Card>
);

const QuickActions = ({ actions }: { actions: Array<{ label: string; href: string }> }) => (
  <div className="flex flex-wrap gap-2">
    {actions.map((action) => (
      <Button
        key={`${action.href}-${action.label}`}
        asChild
        variant="outline"
        size="sm"
        className="rounded-full border-slate-200 bg-white font-medium text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
      >
        <Link to={action.href}>{action.label}</Link>
      </Button>
    ))}
  </div>
);

const baseStaffActions: Array<{ label: string; href: string }> = [
  { label: "Notifications", href: "/notifications" },
  { label: "Academic Calendar", href: "/academic-calendar" },
  { label: "Complains", href: "/complains" }
];

const categoryQuickActions = (
  category?: CollegeStaffCategory | null
): Array<{ label: string; href: string }> => {
  switch (category) {
    case "TRANSPORT":
      return [{ label: "Transport / Routes", href: "/transport" }, ...baseStaffActions];
    case "RECEPTIONIST":
    case "OFFICE_ASSISTANT":
      return [
        { label: "Notices", href: "/notices" },
        { label: "Academic Calendar", href: "/academic-calendar" },
        ...baseStaffActions.filter((a) => a.href !== "/academic-calendar")
      ];
    case "SECURITY_GUARD":
    case "HOUSEKEEPING":
    case "IT_STAFF":
    case "OTHER":
    default:
      return [{ label: "Notices", href: "/notices" }, ...baseStaffActions];
  }
};

const StaffModuleDashboard = ({
  user,
  data,
  statsWithLiveUnread,
  roleLabel,
  roleSubtitle,
  institutionName,
  unreadCount
}: {
  user: UserProfile;
  data: DashboardResponse;
  statsWithLiveUnread: DashboardMetric[];
  roleLabel: string;
  roleSubtitle?: string | null;
  institutionName?: string;
  unreadCount: number;
}) => {
  const staffProfileQuery = useQuery({
    queryKey: ["college-staff-me", user._id],
    queryFn: () => unwrap<CollegeStaffRecord>(api.get("/college-staff/me")),
    enabled: user.role === "COLLEGE_STAFF",
    retry: false,
    staleTime: 60_000
  });

  const staffCategory = staffProfileQuery.data?.category;
  const staffQuickActions: Array<{ label: string; href: string }> =
    user.role === "ACCOUNTANT"
      ? [
          { label: "Fees & Accounts", href: "/accounting" },
          { label: "Notifications", href: "/notifications" },
          { label: "Complains", href: "/complains" }
        ]
      : user.role === "LIBRARY_STAFF"
        ? [
            { label: "Library Management", href: "/library" },
            { label: "Notifications", href: "/notifications" },
            { label: "Complains", href: "/complains" }
          ]
        : user.role === "LABORATORY_STAFF"
          ? [
              { label: "Laboratory Inventory", href: "/laboratory" },
              { label: "Stock Requests", href: "/laboratory" },
              { label: "Notifications", href: "/notifications" },
              { label: "Complains", href: "/complains" }
            ]
          : categoryQuickActions(staffCategory);

  const heroTitle =
    user.role === "ACCOUNTANT"
      ? "Finance Dashboard"
      : user.role === "LIBRARY_STAFF"
        ? "Library Dashboard"
        : user.role === "LABORATORY_STAFF"
          ? "Laboratory Dashboard"
          : staffCategory
            ? `${COLLEGE_STAFF_CATEGORY_LABELS[staffCategory] ?? "Staff"} Dashboard`
            : "Staff Dashboard";

  const heroDescription =
    user.role === "ACCOUNTANT"
      ? "Access fees, accounts, transactions, and financial reports for your institution."
      : user.role === "LIBRARY_STAFF"
        ? "Manage books, issue & return, and library inventory reports."
        : user.role === "LABORATORY_STAFF"
          ? "Manage assigned laboratory inventory, equipment, and stock requests."
          : staffProfileQuery.data
            ? `${staffProfileQuery.data.designation}${
                staffProfileQuery.data.department ? ` · ${staffProfileQuery.data.department}` : ""
              }. Open the modules linked to your staff role below.`
            : "Role-based operational dashboard for college staff. Teachers use a separate Teacher portal.";

  return (
    <PageContent className="space-y-5 sm:space-y-6">
      <DashboardBannerPopup banners={data.banners} />
      <DashboardHero
        title={heroTitle}
        description={heroDescription}
        userName={user.fullName}
        roleLabel={roleLabel}
        roleSubtitle={roleSubtitle}
        institutionName={institutionName}
        unreadCount={unreadCount}
      />
      <StatGrid stats={statsWithLiveUnread} />
      <QuickActions actions={staffQuickActions} />
      <AcademicCalendarWidgets />
      <DashboardSchedulePanels />
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr] xl:gap-6">
        <NotificationsPanel notifications={data.notifications} unreadCount={unreadCount} />
        <NoticesPanel notices={data.notices} />
      </div>
    </PageContent>
  );
};

export const DashboardPage = () => {
  const { t } = useTranslation();
  const { user, activeSchoolId, availableSchools } = useAuth();
  const { unreadCount: liveUnreadCount } = useNotificationBadge();
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", activeSchoolId],
    queryFn: () => unwrap<DashboardResponse>(api.get("/dashboard")),
    enabled: Boolean(user),
    placeholderData: keepPreviousData,
    staleTime: 60_000
  });

  const isInitialDashboardLoad = dashboardQuery.isPending && !dashboardQuery.data;

  if (isInitialDashboardLoad) {
    return (
      <PageContent className="space-y-6">
        <DashboardHeroSkeleton />
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-28 animate-pulse rounded-2xl border border-slate-200/80 bg-white shadow-sm"
            />
          ))}
        </div>
      </PageContent>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <PageContent className="space-y-4">
        <DashboardHero
          title="Dashboard unavailable"
          description="We could not load your dashboard data. Your session may have expired."
          userName={user?.fullName ?? "User"}
          roleLabel={roleLabelMap[user?.role ?? "STUDENT"] ?? "User"}
          unreadCount={0}
        />
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-600">
            Please try logging in again. If the problem persists, contact the system administrator.
          </CardContent>
        </Card>
      </PageContent>
    );
  }

  const data = dashboardQuery.data;
  if (!data || !user) {
    return (
      <PageContent className="space-y-6">
        <DashboardHeroSkeleton />
      </PageContent>
    );
  }

  const institutionName = getCollegeDisplayName(availableSchools, user);
  const roleLabel = getUserDisplayTitle(user);
  const roleSubtitle = getUserRoleSubtitle(user);
  const unreadCount = liveUnreadCount;
  const statsWithLiveUnread = data.stats.map((stat) =>
    stat.label === "Unread Alerts" ? { ...stat, value: liveUnreadCount } : stat
  );

  if (
    user.role === "COLLEGE_STAFF" ||
    user.role === "ACCOUNTANT" ||
    user.role === "LIBRARY_STAFF" ||
    user.role === "LABORATORY_STAFF"
  ) {
    return (
      <StaffModuleDashboard
        user={user}
        data={data}
        statsWithLiveUnread={statsWithLiveUnread}
        roleLabel={roleLabel}
        roleSubtitle={roleSubtitle}
        institutionName={institutionName}
        unreadCount={unreadCount}
      />
    );
  }

  if (user.role === "STUDENT") {
    return (
      <PageContent className="space-y-5 sm:space-y-6">
        <DashboardBannerPopup banners={data.banners} />
        <DashboardHero
          title="Student Dashboard"
          description="Track your subjects, attendance trend, fee status, assignments, and college alerts in one place."
          userName={user.fullName}
          roleLabel={roleLabel}
          roleSubtitle={roleSubtitle}
          institutionName={institutionName}
          unreadCount={unreadCount}
        />
        <StatGrid stats={statsWithLiveUnread} />
        <AcademicCalendarWidgets />
        <DashboardSchedulePanels />
        <HighlightsRow highlights={data.highlights} />
        <QuickActions
          actions={[
            { label: "My Subjects", href: "/my-subjects" },
            { label: "Assignments", href: "/homework-view" },
            { label: "My Fees", href: "/my-fees" },
            { label: "My Library", href: "/my-library" },
            { label: "Exams", href: "/exams" },
            { label: "Timetable", href: "/timetable" }
          ]}
        />
        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <Card className={cn(panelClass)}>
            <CardHeader className="border-slate-100/80">
              <CardTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 bg-slate-50">
                  <BarChart3 className="h-4 w-4 text-slate-600" strokeWidth={1.75} />
                </span>
                Attendance Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.attendanceChart.length === 0 ? (
                <div className="flex h-[300px] items-center justify-center text-sm text-slate-500">
                  Attendance records will appear here once classes are marked.
                </div>
              ) : (
                <ChartBox height={300}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart data={data.attendanceChart}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid #e2e8f0",
                          boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
                          fontSize: 13,
                        }}
                      />
                      <Bar dataKey="present" fill="#0f172a" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="absent" fill="#cbd5e1" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartBox>
              )}
            </CardContent>
          </Card>
          <div className="space-y-6">
            <NotificationsPanel notifications={data.notifications} unreadCount={unreadCount} />
            <NoticesPanel notices={data.notices} />
          </div>
        </div>
      </PageContent>
    );
  }

  if (user.role === "PARENT") {
    return (
      <PageContent className="space-y-5 sm:space-y-6">
        <DashboardBannerPopup banners={data.banners} />
        <DashboardHero
          title="Parent Dashboard"
          description="Monitor your children's attendance, fees, assignments, and college notifications from one professional overview."
          userName={user.fullName}
          roleLabel={roleLabel}
          roleSubtitle={roleSubtitle}
          institutionName={institutionName}
          unreadCount={unreadCount}
        />
        <StatGrid stats={statsWithLiveUnread} />
        <AcademicCalendarWidgets />
        <HighlightsRow highlights={data.highlights} />
        <QuickActions
          actions={[
            { label: "Parent Portal", href: "/parent-portal" },
            { label: "Student attendance", href: "/attendance" },
            { label: "Homework", href: "/homework-view" },
            { label: "Examination", href: "/exams" },
            { label: "Notices", href: "/notices" }
          ]}
        />
        {(data.children ?? []).length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {(data.children ?? []).map((child) => (
              <Link
                key={child.studentId}
                to="/parent-portal"
                className="block"
              >
                <Card
                  className={cn(
                    "h-full transition duration-200 hover:-translate-y-0.5 hover:border-slate-300",
                    panelClass,
                  )}
                >
                  <CardContent className="py-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Linked child
                    </p>
                    <p className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">
                      {child.fullName}
                    </p>
                    <p className="mt-3 text-sm text-slate-600">
                      Fees due:{" "}
                      <span className="font-semibold text-slate-900">
                        {formatCurrencyNpr(child.feesDueNpr)}
                      </span>
                    </p>
                    <p className="mt-2.5 text-xs font-medium text-slate-500">
                      Open parent portal →
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : null}
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <NotificationsPanel notifications={data.notifications} unreadCount={unreadCount} />
          <NoticesPanel notices={data.notices} />
        </div>
      </PageContent>
    );
  }

  const isCollegeAdmin = hasInstitutionAccess(user.role);
  const isTeacher = user.role === "TEACHER";

  // Filter out removed outstanding-fee admin widgets (balances live on student profile / fee records)
  const highlights = (data.highlights ?? []).filter(
    (h) =>
      h.action !== "fee-dues" &&
      !/outstanding student fees/i.test(h.label) &&
      !/students with fee dues/i.test(h.label),
  );

  return (
    <PageContent className="space-y-5 sm:space-y-6">
      <DashboardBannerPopup banners={data.banners} />
      <DashboardHero
        title={`${t("dashboard")} · ${roleLabel}`}
        description={
          isCollegeAdmin
            ? "Institution-wide overview with student volume, attendance trends, notices, and the latest operational alerts."
            : isTeacher
              ? user.designation?.trim()
                ? `Signed in as ${user.designation.trim()}. Your teaching command center for classes, attendance, assignments, exams, and college communication.`
                : "Your teaching command center for classes, attendance, assignments, exams, and college communication."
              : "Role-based overview with attendance trends, notices, and the latest notifications."
        }
        userName={user.fullName}
        roleLabel={roleLabel}
        roleSubtitle={roleSubtitle}
        institutionName={institutionName}
        unreadCount={unreadCount}
      />

      <StatGrid stats={statsWithLiveUnread} />
      <AcademicCalendarWidgets />
      <DashboardSchedulePanels />
      <HighlightsRow highlights={highlights} />

      {isCollegeAdmin ? (
        <QuickActions
          actions={[
            { label: "Students", href: "/students" },
            { label: "Attendance", href: "/attendance-view" },
            { label: "Early Leave", href: "/attendance-view?tab=early-leave" },
            { label: "Accounting", href: "/accounting" },
            { label: "Finance Management", href: "/finance" },
            { label: "Exams & Results", href: "/exams-view" },
            { label: "Timetable", href: "/timetable" },
            { label: "IEMIS Reports", href: "/reports" },
            { label: "Parent Links", href: "/parent-links" }
          ]}
        />
      ) : null}

      {isTeacher ? (
        <QuickActions
          actions={[
            { label: "My Students", href: "/students" },
            { label: "My Timetable", href: "/timetable" },
            { label: "My Assignments", href: "/homework" },
            { label: "My Attendance", href: "/attendance" },
            { label: "My Examinations", href: "/exams" },
            { label: "Academic Plans", href: "/academic-management" },
            { label: "My Library", href: "/my-library" }
          ]}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.55fr]">
        <div className="space-y-6">
          <Card className={cn(panelClass)}>
            <CardHeader className="border-slate-100/80">
              <CardTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 bg-slate-50">
                  <BarChart3 className="h-4 w-4 text-slate-600" strokeWidth={1.75} />
                </span>
                Attendance Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.attendanceChart.length === 0 ? (
                <div className="flex h-[320px] items-center justify-center text-sm text-slate-500">
                  Attendance analytics will appear once records are available for your scope.
                </div>
              ) : (
                <ChartBox height={320}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart data={data.attendanceChart}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid #e2e8f0",
                          boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
                          fontSize: 13,
                        }}
                      />
                      <Bar dataKey="present" fill="#0f172a" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="absent" fill="#cbd5e1" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartBox>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {isCollegeAdmin ? (
              <Card className={cn(panelClass)}>
                <CardHeader className="border-slate-100/80">
                  <CardTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 bg-slate-50">
                      <Wallet className="h-4 w-4 text-slate-600" strokeWidth={1.75} />
                    </span>
                    Fee Collection
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {data.feeChart.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200/90 bg-slate-50/40 px-4 py-8 text-center text-sm text-slate-500">
                      Fee collection summaries will appear after payments are recorded.
                    </div>
                  ) : (
                    data.feeChart.map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"
                      >
                        <span className="text-sm font-medium text-slate-700">
                          BS {item.label}
                        </span>
                        <Badge className="border border-slate-200 bg-white font-semibold text-slate-800">
                          {formatCurrencyNpr(item.amount)}
                        </Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}

            {data.counts.length > 0 ? (
              <Card className={cn(panelClass)}>
                <CardHeader className="border-slate-100/80">
                  <CardTitle className="text-base font-semibold tracking-tight">
                    {isTeacher ? "Teaching Load" : "Institution Mix"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartBox height={280}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <PieChart>
                      <Pie
                        data={data.counts}
                        dataKey="value"
                        nameKey="name"
                        outerRadius={95}
                        stroke="#ffffff"
                        strokeWidth={2}
                        label
                      >
                        {data.counts.map((entry, index) => (
                          <Cell
                            key={entry.name}
                            fill={
                              INSTITUTION_MIX_COLORS[
                                index % INSTITUTION_MIX_COLORS.length
                              ]
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid #e2e8f0",
                          fontSize: 13,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  </ChartBox>
                </CardContent>
              </Card>
            ) : null}

          </div>

          {isCollegeAdmin ? <StudentDemographicsCharts data={data} /> : null}
        </div>

        <div className="space-y-6">
          <NotificationsPanel notifications={data.notifications} unreadCount={unreadCount} />
          <NoticesPanel notices={data.notices} title={t("noticeBoard")} />
        </div>
      </div>
    </PageContent>
  );
};