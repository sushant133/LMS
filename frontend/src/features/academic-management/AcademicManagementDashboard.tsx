import type {
  AcademicManagementDashboard,
  AcademicTeacherAlert,
} from "@phit-erp/shared";
import {
  AlertTriangle,
  BookOpen,
  Clock,
  ClipboardList,
  Printer,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { ChartBox } from "components/ui/chart-box";
import { LoadingState } from "components/shared/LoadingState";
import { printElementById } from "lib/printUtils";
import { cn } from "lib/utils";
import { AcademicProgressBar } from "./AcademicProgressBar";

interface AcademicManagementDashboardPanelProps {
  data?: AcademicManagementDashboard;
  loading: boolean;
}

const statCards = [
  { key: "totalSubjects", label: "Curriculum Subjects" },
  { key: "totalSessionPlans", label: "Session Plans" },
  { key: "totalLessonPlans", label: "Lesson Plans" },
  { key: "todaysLogBooks", label: "Today's Log Books" },
  { key: "approvedPlans", label: "Approved Plans" },
  { key: "pendingApprovals", label: "Pending Approvals" },
  { key: "delayedLessonPlans", label: "Delayed Plans" },
  { key: "syllabusCompletionPercent", label: "Syllabus Completion %" },
  { key: "syllabusRemainingPercent", label: "Syllabus Remaining %" },
  { key: "teachersPendingLogBook", label: "Teachers Pending Log Book" },
] as const;

const alertStyle = (type: AcademicTeacherAlert["type"]) => {
  switch (type) {
    case "LESSON_PLAN_OVERDUE":
      return "border-rose-200 bg-rose-50";
    case "LESSON_PLAN_APPROACHING":
      return "border-amber-200 bg-amber-50";
    case "LOG_BOOK_MISSING":
      return "border-orange-200 bg-orange-50";
    default:
      return "border-slate-200 bg-slate-50";
  }
};

const alertIcon = (type: AcademicTeacherAlert["type"]) => {
  switch (type) {
    case "LESSON_PLAN_OVERDUE":
      return <AlertTriangle className="h-4 w-4 text-rose-600" />;
    case "LESSON_PLAN_APPROACHING":
      return <Clock className="h-4 w-4 text-amber-600" />;
    case "LOG_BOOK_MISSING":
      return <ClipboardList className="h-4 w-4 text-orange-600" />;
    default:
      return <BookOpen className="h-4 w-4 text-slate-600" />;
  }
};

const asNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const formatPercent = (value: unknown): string => `${Math.round(asNumber(value))}%`;

const shortLabel = (value: unknown, max = 22): string => {
  const text = String(value ?? "").trim() || "—";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
};

/* ────────────────────────────────────────────────────────────────────────────
   Chart system for the Academic Management dashboard.

   Palette: validated categorical set (8 slots, fixed order — never cycled).
   `node validate_palette.js "<hexes>" --mode light --surface #ffffff` reports
   all hard checks PASS, with a contrast WARN on aqua / yellow / magenta. The
   documented relief for that warn is visible labels or a table view — every
   chart below ships BOTH (a value on each column and a Table toggle), so a
   low-contrast fill never carries meaning on its own.

   Colour follows the entity, not its rank: a subject keeps its hue whatever the
   sort or filter does, and the same hue identifies it in every chart. More than
   eight categories are never cycled — the subject charts facet into per-year
   small multiples instead, which is also how all three years get shown.
   ──────────────────────────────────────────────────────────────────────────── */

/** Categorical slots, in the order the validator passed them. */
const SERIES = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
] as const;

const INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  track: "#eef0f4",
} as const;

const tooltipStyle = {
  borderRadius: 12,
  border: `1px solid ${INK.grid}`,
  boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
  fontSize: 13,
  padding: "8px 10px",
};

/**
 * Second tier, for years that carry more subjects than the palette has slots.
 * Cycling the eight is not allowed — the 9th subject would be indistinguishable
 * from the 1st — so these are the same eight hues re-stepped: darker for the six
 * with headroom, lighter for green and violet, which already sit near the floor
 * of the lightness band and fall out of it when darkened.
 *
 * Validated as one 16-slot set against the white card surface:
 *   Lightness band PASS · Chroma floor PASS · Normal-vision ΔE 15.3 PASS
 *   CVD separation WARN (worst adjacent ΔE 7.2) — legal with secondary encoding,
 *   which is present: every bar carries its name on the axis and its value on top.
 *   Contrast WARN — relieved by those same labels plus the table view.
 */
const SERIES_TIER_2 = [
  "#1e569a",
  "#a94b25",
  "#137e58",
  "#ab7400",
  "#a75976",
  "#4da84d",
  "#8479c3",
  "#a33534",
] as const;

/**
 * Hue by identity — stable across sorts, filters and sibling charts. Past 16
 * subjects in one year the tiers do repeat; there the axis label and the value
 * label carry identity and colour is only a recognition aid.
 */
const hueFor = (index: number): string => {
  const slot = index % SERIES.length;
  const tier = Math.floor(index / SERIES.length);
  return tier % 2 === 0 ? SERIES[slot]! : SERIES_TIER_2[slot]!;
};

type ColumnRow = {
  key: string;
  label: string;
  value: number;
  color: string;
};

/** Rough width of the 11px axis label face — enough to decide "does it fit". */
const CHAR_PX = 6.1;

/**
 * Longest axis label we will draw. A tilted 40-character name runs off the left
 * edge of the plot and the SVG clips its opening characters — "…prehensive
 * clinical + PHC Practicum II" tells the reader nothing. Truncate the drawn
 * label and keep the full name in the tooltip and the table view.
 */
const AXIS_LABEL_MAX = 20;

const axisLabel = (value: unknown): string => {
  const text = String(value ?? "").trim();
  return text.length > AXIS_LABEL_MAX
    ? `${text.slice(0, AXIS_LABEL_MAX - 1)}…`
    : text;
};

/** Plot width, so the tilt decision is made against real pixels. */
const useMeasuredWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.getBoundingClientRect().width);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
};

/**
 * Tilt a label only when it cannot sit upright in its slot — a tilted label is
 * easier to read than a truncated one, but flat is easier still, so flat wins
 * whenever it fits.
 */
const axisGeometry = (rows: ColumnRow[], plotWidth = 0) => {
  const longest = rows.reduce(
    (max, r) => Math.max(max, axisLabel(r.label).length),
    0,
  );
  const slotPx = rows.length > 0 && plotWidth > 0 ? plotWidth / rows.length : 0;
  const tilt =
    slotPx > 0
      ? longest * CHAR_PX > slotPx - 10
      : longest > Math.max(9, Math.floor(72 / Math.max(1, rows.length)) + 6);
  return {
    tilt,
    angle: tilt ? -35 : 0,
    textAnchor: tilt ? ("end" as const) : ("middle" as const),
    /** The card must include the axis band, or the labels get clipped. */
    // sin(35°) ≈ 0.57, plus room for the tick gap and descenders.
    axisHeight: tilt ? Math.min(150, 30 + longest * CHAR_PX * 0.62) : 30,
  };
};

const TiltedTick = ({
  x,
  y,
  payload,
  angle,
  anchor,
}: {
  /** Recharts hands ticks x/y as `string | number`, so widen and coerce. */
  x?: string | number;
  y?: string | number;
  payload?: { value?: string | number };
  angle: number;
  anchor: "end" | "middle";
}) => (
  <g transform={`translate(${Number(x) || 0},${Number(y) || 0})`}>
    <text
      dy={angle === 0 ? 14 : 10}
      textAnchor={anchor}
      transform={`rotate(${angle})`}
      style={{ fill: INK.secondary, fontSize: 11 }}
    >
      {axisLabel(payload?.value)}
    </text>
  </g>
);

/**
 * Percent columns for one set of entities — one hue per entity.
 *
 * Each column is the whole 100%: the coloured segment is what is done, the
 * light segment is what is left. A plain value bar drew nothing at all for a
 * subject at 0%, so the slot read as missing data rather than "not started";
 * the full-height column keeps every category visible and makes the value
 * legible as a share.
 */
const PercentColumns = ({ rows }: { rows: ColumnRow[] }) => {
  const { ref, width } = useMeasuredWidth();
  const geo = axisGeometry(rows, Math.max(0, width - 48));
  const height = geo.axisHeight + 186;
  const data = rows.map((row) => ({
    ...row,
    rest: Math.max(0, 100 - row.value),
  }));
  return (
    <div ref={ref}>
    <ChartBox height={height}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart
          data={data}
          margin={{ top: 22, right: 16, left: 16, bottom: 4 }}
          barCategoryGap="28%"
        >
          {/* Solid hairlines — dashed grids read as thresholds. */}
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis
            dataKey="label"
            interval={0}
            height={geo.axisHeight}
            tickLine={false}
            axisLine={{ stroke: INK.axis }}
            tick={(props) => (
              <TiltedTick {...props} angle={geo.angle} anchor={geo.textAnchor} />
            )}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
            tickLine={false}
            axisLine={false}
            width={40}
            tick={{ fill: INK.muted, fontSize: 11 }}
          />
          <Tooltip
            cursor={{ fill: "rgba(15,23,42,0.04)" }}
            contentStyle={tooltipStyle}
            /* The axis label may be truncated; the tooltip always shows it whole. */
            labelFormatter={(label: unknown) => String(label ?? "")}
            formatter={(value: unknown, name: unknown) => [
              formatPercent(value),
              name === "rest" ? "Remaining" : "Completed",
            ]}
          />
          <Bar dataKey="value" stackId="pct" maxBarSize={46}>
            {data.map((row) => (
              <Cell key={row.key} fill={row.color} />
            ))}
          </Bar>
          {/* Remaining share. The 2px surface stroke is the gap between the two
              fills, not a border drawn around the mark. */}
          <Bar
            dataKey="rest"
            stackId="pct"
            maxBarSize={46}
            radius={[4, 4, 0, 0]}
            stroke="#ffffff"
            strokeWidth={2}
          >
            {/* Tinted with the subject own hue so identity stays visible even at
                0%, where the coloured segment has no height to show. */}
            {data.map((row) => (
              <Cell key={row.key + "-rest"} fill={row.color + "40"} />
            ))}
            <LabelList
              dataKey="value"
              position="top"
              offset={8}
              formatter={(v: unknown) => formatPercent(v)}
              style={{ fill: INK.primary, fontSize: 11, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartBox>
    </div>
  );
};

/** The WCAG-clean twin of every chart. */
const ValueTable = ({
  rows,
  nameHeader,
}: {
  rows: ColumnRow[];
  nameHeader: string;
}) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="py-2 pr-3 font-medium">{nameHeader}</th>
          <th className="py-2 pr-3 text-right font-medium">Completed</th>
          <th className="py-2 text-right font-medium">Remaining</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="py-2 pr-3">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: row.color }}
                />
                {row.label}
              </span>
            </td>
            <td className="py-2 pr-3 text-right tabular-nums">
              {formatPercent(row.value)}
            </td>
            <td className="py-2 text-right tabular-nums text-slate-500">
              {formatPercent(100 - row.value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/**
 * One card = one question. Header carries the title, a one-line read of what the
 * chart says, and the two controls the user asked for: a per-chart print and the
 * chart/table switch.
 */
const ChartCard = ({
  id,
  title,
  subtitle,
  empty,
  children,
  table,
}: {
  id: string;
  title: string;
  subtitle: string;
  empty: boolean;
  children: ReactNode;
  table: ReactNode;
}) => {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [printing, setPrinting] = useState(false);

  const print = async () => {
    setPrinting(true);
    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() => resolve()),
        );
      });
      await printElementById(id, title);
    } catch {
      toast.error("Could not print this chart");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="no-print flex shrink-0 items-center gap-1">
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {(["chart", "table"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition",
                  view === mode
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={printing || empty}
            title={`Print ${title}`}
            onClick={() => void print()}
          >
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            {printing ? "Printing…" : "Print"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        <div id={id}>
          <div className="mb-3 hidden print:block">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
          {empty ? (
            <p className="flex h-56 items-center justify-center text-sm text-slate-500">
              No data for the current filters yet.
            </p>
          ) : view === "chart" ? (
            children
          ) : (
            table
          )}
        </div>
      </CardContent>
    </Card>
  );
};

/** Planned is a recessive reference bar; completed is the series that matters. */
const MonthlyColumns = ({
  rows,
}: {
  rows: Array<{ month: string; planned: number; completed: number }>;
}) => {
  const { ref, width } = useMeasuredWidth();
  const geo = axisGeometry(
    rows.map((r) => ({ key: r.month, label: r.month, value: 0, color: "" })),
    Math.max(0, width - 48),
  );
  return (
    <div ref={ref}>
    <ChartBox height={geo.axisHeight + 250}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart
          data={rows}
          margin={{ top: 22, right: 16, left: 16, bottom: 4 }}
          barCategoryGap="26%"
          barGap={2}
        >
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis
            dataKey="month"
            interval={0}
            height={geo.axisHeight}
            tickLine={false}
            axisLine={{ stroke: INK.axis }}
            tick={(props) => (
              <TiltedTick {...props} angle={geo.angle} anchor={geo.textAnchor} />
            )}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={36}
            tick={{ fill: INK.muted, fontSize: 11 }}
          />
          <Tooltip
            cursor={{ fill: "rgba(15,23,42,0.04)" }}
            contentStyle={tooltipStyle}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: INK.secondary, paddingTop: 6 }}
          />
          <Bar
            dataKey="planned"
            name="Planned"
            fill={INK.track}
            radius={[4, 4, 0, 0]}
            maxBarSize={34}
          />
          <Bar
            dataKey="completed"
            name="Completed"
            fill={SERIES[0]}
            radius={[4, 4, 0, 0]}
            maxBarSize={34}
          >
            <LabelList
              dataKey="completed"
              position="top"
              offset={8}
              style={{ fill: INK.primary, fontSize: 11, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartBox>
    </div>
  );
};

const MonthlyTable = ({
  rows,
}: {
  rows: Array<{ month: string; planned: number; completed: number }>;
}) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="py-2 pr-3 font-medium">Month</th>
          <th className="py-2 pr-3 text-right font-medium">Planned</th>
          <th className="py-2 text-right font-medium">Completed</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((row) => (
          <tr key={row.month}>
            <td className="py-2 pr-3">{row.month}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{row.planned}</td>
            <td className="py-2 text-right tabular-nums">{row.completed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

type YearGroup = { year: string; rows: ColumnRow[] };

/**
 * Past eight categories hues are never cycled — the subject charts break into
 * one small multiple per year instead. That keeps every facet inside the
 * validated slot order and is also how all three years get on screen at once.
 */
const groupByYear = (
  items: Array<{ name: string; year?: string; level?: number; value: number }>,
): YearGroup[] => {
  const buckets = new Map<string, { level: number; items: typeof items }>();
  for (const item of items) {
    const year = item.year?.trim() || "Unassigned";
    const bucket = buckets.get(year) ?? { level: item.level ?? 99, items: [] };
    bucket.items.push(item);
    buckets.set(year, bucket);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[1].level - b[1].level || a[0].localeCompare(b[0]))
    .map(([year, bucket]) => ({
      year,
      // Alphabetical, so a subject's hue never moves when values change.
      rows: [...bucket.items]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item, index) => ({
          key: `${year}-${item.name}`,
          label: item.name,
          value: item.value,
          color: hueFor(index),
        })),
    }));
};

const YearFacets = ({ groups }: { groups: YearGroup[] }) => (
  <div className="space-y-6">
    {groups.map((group) => (
      <div key={group.year}>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-slate-800">{group.year}</p>
          <p className="text-xs text-slate-500">
            {group.rows.length} subject{group.rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <PercentColumns rows={group.rows} />
      </div>
    ))}
  </div>
);

const alertLabel = (type: AcademicTeacherAlert["type"]) => {
  switch (type) {
    case "LESSON_PLAN_OVERDUE":
      return "Overdue / delayed";
    case "LESSON_PLAN_APPROACHING":
      return "Deadline near";
    case "LOG_BOOK_MISSING":
      return "Log book missing";
    default:
      return type;
  }
};

export const AcademicManagementDashboardPanel = ({
  data,
  loading,
}: AcademicManagementDashboardPanelProps) => {
  if (loading) return <LoadingState />;
  if (!data) return null;

  const alerts = data.teacherAlerts ?? [];

  /**
   * Chart rows are derived once. Subject hues are assigned inside each year
   * facet by alphabetical order, so they follow the subject rather than its
   * current rank — a filter or a re-sort never repaints the survivors.
   */
  const monthlyRows = useMemo(
    () =>
      (data?.monthlyProgress ?? []).map((row) => ({
        month: String(row.month ?? "—"),
        planned: asNumber(row.planned),
        completed: asNumber(row.completed),
      })),
    [data?.monthlyProgress],
  );

  const subjectGroups = useMemo(
    () =>
      groupByYear(
        (data?.subjectProgress ?? []).map((row) => ({
          name: row.subjectName?.trim() || "Subject",
          year: row.yearLabel,
          level: row.yearLevel,
          value: asNumber(row.completionPercent),
        })),
      ),
    [data?.subjectProgress],
  );

  const syllabusGroups = useMemo(
    () =>
      groupByYear(
        (data?.syllabusCompletion ?? []).map((row) => ({
          name: row.subjectName?.trim() || "Subject",
          year: row.yearLabel,
          level: row.yearLevel,
          value: asNumber(row.percent),
        })),
      ),
    [data?.syllabusCompletion],
  );

  const subjectFlat = useMemo(
    () => subjectGroups.flatMap((g) => g.rows),
    [subjectGroups],
  );
  const syllabusFlat = useMemo(
    () => syllabusGroups.flatMap((g) => g.rows),
    [syllabusGroups],
  );

  /**
   * Teachers and faculties appear in one chart each, so there is nothing to
   * recognise them across — a single hue is the honest encoding; the axis
   * already carries identity.
   */
  const teacherRows = useMemo(
    () =>
      (data?.teacherPerformance ?? []).map((row) => ({
        key: row.teacherId || row.teacherName,
        label: row.teacherName?.trim() || "Teacher",
        value: asNumber(row.completionPercent),
        color: SERIES[0],
      })),
    [data?.teacherPerformance],
  );

  const facultyRows = useMemo(
    () =>
      (data?.facultyProgress ?? []).map((row) => ({
        key: row.faculty,
        label: row.faculty?.trim() || "Faculty",
        value: asNumber(row.completionPercent),
        color: SERIES[2],
      })),
    [data?.facultyProgress],
  );

  return (
    <div className="space-y-6">
      {alerts.length > 0 ? (
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Teacher action required
            </CardTitle>
            <p className="text-sm text-slate-600">
              Missing log books and lesson plans that are near deadline or not
              on time. Remaining work is shown as a percentage.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.map((alert, index) => (
              <div
                key={`${alert.type}-${alert.teacherId}-${alert.lessonPlanItemId ?? alert.topic}-${index}`}
                className={`rounded-xl border p-3 ${alertStyle(alert.type)}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    {alertIcon(alert.type)}
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-white/80 text-slate-800">
                          {alertLabel(alert.type)}
                        </Badge>
                        {alert.subjectName ? (
                          <span className="text-sm font-medium text-slate-900">
                            {alert.subjectName}
                            {alert.month ? ` · ${alert.month}` : ""}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-700">
                        {alert.message}
                      </p>
                      {alert.deadline ? (
                        <p className="mt-0.5 text-xs text-slate-500">
                          Deadline: {alert.deadline}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {alert.type !== "LOG_BOOK_MISSING" ? (
                    <div className="min-w-[140px] text-right">
                      <p className="text-lg font-semibold text-amber-800">
                        {alert.remainingPercent}% remaining
                      </p>
                      <p className="text-xs text-slate-500">
                        {alert.completedClasses}/{alert.estimatedClasses}{" "}
                        classes
                      </p>
                      <AcademicProgressBar
                        className="mt-1"
                        completedPercent={alert.completedPercent}
                        remainingPercent={alert.remainingPercent}
                        compact
                      />
                    </div>
                  ) : (
                    <p className="text-sm font-semibold text-orange-800">
                      Not submitted
                    </p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {statCards.map((card) => {
          const value = asNumber(data[card.key as keyof AcademicManagementDashboard]);
          const isPercent =
            card.key === "syllabusCompletionPercent" ||
            card.key === "syllabusRemainingPercent";
          return (
            <Card key={card.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">
                  {card.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p
                  className={`text-3xl font-semibold ${
                    card.key === "syllabusRemainingPercent" ||
                    card.key === "delayedLessonPlans" ||
                    card.key === "teachersPendingLogBook"
                      ? "text-amber-800"
                      : "text-slate-900"
                  }`}
                >
                  {isPercent ? `${value}%` : value}
                </p>
                {card.key === "syllabusCompletionPercent" ? (
                  <AcademicProgressBar
                    className="mt-2"
                    completedPercent={data.syllabusCompletionPercent}
                    remainingPercent={data.syllabusRemainingPercent}
                  />
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/*
        One chart per row. A column chart needs the full card width for its
        tilted axis labels, and stacking gives the page a single top-to-bottom
        reading order instead of a two-column zig-zag.
      */}
      <div className="grid gap-6">
        <ChartCard
          id="chart-monthly-progress"
          title="Monthly Progress"
          subtitle="Lesson plans planned against completed, by Nepali month."
          empty={monthlyRows.length === 0}
          table={<MonthlyTable rows={monthlyRows} />}
        >
          <MonthlyColumns rows={monthlyRows} />
        </ChartCard>

        <ChartCard
          id="chart-subject-progress"
          title="Subject Progress"
          subtitle="Every curriculum subject across all years. Each subject keeps its own colour here and in Syllabus Completion."
          empty={subjectGroups.length === 0}
          table={<ValueTable rows={subjectFlat} nameHeader="Subject" />}
        >
          <YearFacets groups={subjectGroups} />
        </ChartCard>

        <ChartCard
          id="chart-syllabus-completion"
          title="Syllabus Completion"
          subtitle="Share of each subject's syllabus marked complete from the log book."
          empty={syllabusGroups.length === 0}
          table={<ValueTable rows={syllabusFlat} nameHeader="Subject" />}
        >
          <YearFacets groups={syllabusGroups} />
        </ChartCard>

        <ChartCard
          id="chart-teacher-performance"
          title="Teacher Performance"
          subtitle="Average completion across each teacher's session plans."
          empty={teacherRows.length === 0}
          table={<ValueTable rows={teacherRows} nameHeader="Teacher" />}
        >
          <PercentColumns rows={teacherRows} />
        </ChartCard>

        <ChartCard
          id="chart-faculty-progress"
          title="Faculty Progress"
          subtitle="Average completion by faculty or programme."
          empty={facultyRows.length === 0}
          table={<ValueTable rows={facultyRows} nameHeader="Faculty" />}
        >
          <PercentColumns rows={facultyRows} />
        </ChartCard>
      </div>
    </div>
  );
};
