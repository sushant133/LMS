import { useMemo } from "react";
import { bsToAd, parseBsDate } from "@munatech/nepali-datepicker";
import { DAYS_OF_WEEK } from "@phit-erp/shared";
import { cn } from "lib/utils";

/**
 * One year cohort column of the combined routine grid — 1st / 2nd / 3rd year for a
 * college, or a single "Exam schedule" column in school mode.
 */
export interface RoutineColumn {
  /** Year id, or "" for legacy rows with no year. */
  key: string;
  /** Full label, e.g. "1st Year · Batch 2083". */
  title: string;
  /** Compact label used in the grid header, e.g. "First". */
  shortTitle?: string;
  level?: number;
}

export interface RoutineSlot {
  _id: string;
  yearId?: string;
  subjectName?: string;
  subjectCode?: string;
  examDateBs: string;
  day: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  examHall?: string;
  invigilator?: string;
  remarks?: string;
}

/** "First", "Second", "Third"… derived from a year label or level for the grid header. */
const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"];

export const shortYearTitle = (title: string, level?: number): string => {
  const trimmed = (title ?? "").trim();
  const leading = /^(\d+)/.exec(trimmed);
  const index = leading ? Number(leading[1]) - 1 : (level ?? 0) - 1;
  if (index >= 0 && index < ORDINALS.length) return ORDINALS[index]!;
  // "First Year · Batch 2083" → "First"
  const firstWord = trimmed.split(/[\s·—-]+/)[0];
  return firstWord || trimmed || "Year";
};

/** Weekday name for a BS date, so grid rows read "2083-06-13 · Friday" without extra input. */
export const weekdayFromBsDate = (examDateBs: string): string => {
  const parsed = parseBsDate(examDateBs);
  if (!parsed) return "";
  try {
    const ad = bsToAd(parsed.year, parsed.month, parsed.day);
    return DAYS_OF_WEEK[new Date(ad.year, ad.month - 1, ad.day).getDay()] ?? "";
  } catch {
    return "";
  }
};

const timeRange = (slot: RoutineSlot) =>
  slot.startTime && slot.endTime ? `${slot.startTime} – ${slot.endTime}` : "";

interface GridRow {
  examDateBs: string;
  day: string;
  /** column key → slots scheduled that day for that year */
  byColumn: Map<string, RoutineSlot[]>;
}

const buildRows = (columns: RoutineColumn[], slots: RoutineSlot[]): GridRow[] => {
  const byDate = new Map<string, GridRow>();
  const columnKeys = new Set(columns.map((column) => column.key));

  for (const slot of slots) {
    const row = byDate.get(slot.examDateBs) ?? {
      examDateBs: slot.examDateBs,
      day: slot.day || weekdayFromBsDate(slot.examDateBs),
      byColumn: new Map<string, RoutineSlot[]>()
    };
    if (!row.day && slot.day) row.day = slot.day;
    // A row whose year is outside the exam scope still belongs somewhere: fall back to
    // the single column when there is only one, otherwise to the untagged column.
    const rawKey = slot.yearId ?? "";
    const key = columnKeys.has(rawKey)
      ? rawKey
      : columns.length === 1
        ? columns[0]!.key
        : rawKey;
    const cell = row.byColumn.get(key) ?? [];
    cell.push(slot);
    row.byColumn.set(key, cell);
    byDate.set(slot.examDateBs, row);
  }

  for (const row of byDate.values()) {
    for (const cell of row.byColumn.values()) {
      cell.sort((left, right) => (left.startTime ?? "").localeCompare(right.startTime ?? ""));
    }
  }

  return [...byDate.values()].sort((left, right) =>
    left.examDateBs.localeCompare(right.examDateBs)
  );
};

interface ExamRoutineGridProps {
  columns: RoutineColumn[];
  slots: RoutineSlot[];
  /** "print" drops interactive chrome and switches to the black-bordered sheet styles. */
  variant?: "screen" | "print";
  /** Show hall / invigilator inside each cell. */
  showDetails?: boolean;
  className?: string;
}

/**
 * Date × Year matrix of an exam routine — one row per exam date, one column per year
 * cohort, each cell naming the subject sat that day by that year. This is the layout the
 * college prints and hands out, so all three years read off a single sheet.
 */
export const ExamRoutineGrid = ({
  columns,
  slots,
  variant = "screen",
  showDetails = true,
  className
}: ExamRoutineGridProps) => {
  const rows = useMemo(() => buildRows(columns, slots), [columns, slots]);
  const isPrint = variant === "print";

  if (columns.length === 0 || rows.length === 0) {
    return (
      <p
        className={cn(
          "rounded-lg border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500",
          isPrint && "border-slate-400 text-slate-700"
        )}
      >
        No exam dates scheduled yet.
      </p>
    );
  }

  return (
    <div
      className={cn(
        !isPrint && "overflow-x-auto rounded-xl border border-slate-200 shadow-sm",
        className
      )}
    >
      <table className={cn("routine-grid", isPrint ? "routine-grid-print" : "w-full")}>
        <colgroup>
          <col className="routine-col-date" />
          {columns.map((column) => (
            <col key={column.key} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="routine-corner" scope="col">
              <span className="routine-corner-year">Year</span>
              <span className="routine-corner-date">Date</span>
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="routine-year-head">
                <span className="routine-year-short">
                  {column.shortTitle ?? shortYearTitle(column.title, column.level)}
                </span>
                <span className="routine-year-full">{column.title}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.examDateBs}>
              <th scope="row" className="routine-date-cell">
                <span className="routine-date">{row.examDateBs}</span>
                {row.day ? <span className="routine-day">{row.day}</span> : null}
              </th>
              {columns.map((column) => {
                const cell = row.byColumn.get(column.key) ?? [];
                return (
                  <td key={column.key} className="routine-slot-cell">
                    {cell.length === 0 ? (
                      <span className="routine-empty">—</span>
                    ) : (
                      cell.map((slot) => (
                        <div key={slot._id} className="routine-slot">
                          <span className="routine-subject">
                            {slot.subjectName ?? "Subject"}
                          </span>
                          {slot.subjectCode ? (
                            <span className="routine-code">{slot.subjectCode}</span>
                          ) : null}
                          {timeRange(slot) ? (
                            <span className="routine-time">{timeRange(slot)}</span>
                          ) : null}
                          {showDetails && (slot.examHall || slot.invigilator) ? (
                            <span className="routine-meta">
                              {[
                                slot.examHall ? `Hall ${slot.examHall}` : "",
                                slot.invigilator ?? ""
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          ) : null}
                        </div>
                      ))
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

interface ExamRoutinePrintSheetProps {
  /** DOM id handed to the print helper. */
  id: string;
  collegeName?: string;
  collegeAddress?: string;
  heading?: string;
  examName: string;
  academicYearBs?: string;
  startDateBs?: string;
  endDateBs?: string;
  columns: RoutineColumn[];
  slots: RoutineSlot[];
  /** Line under the table, e.g. "Students must reach the hall 15 minutes early." */
  note?: string;
  /** Names printed above the signature lines. */
  signatories?: string[];
}

/**
 * Hidden A4-landscape sheet used by the Print button. It is always in the DOM (the print
 * helper clones it), styled by `.routine-sheet` in index.css, and hidden on screen.
 */
export const ExamRoutinePrintSheet = ({
  id,
  collegeName,
  collegeAddress,
  heading = "EXAMINATION ROUTINE",
  examName,
  academicYearBs,
  startDateBs,
  endDateBs,
  columns,
  slots,
  note,
  signatories = ["Exam Coordinator", "Campus Chief"]
}: ExamRoutinePrintSheetProps) => (
  <div id={id} className="routine-print-root">
    <div className="routine-sheet">
      <div className="routine-sheet-college">{collegeName || "College"}</div>
      {collegeAddress ? (
        <div className="routine-sheet-address">{collegeAddress}</div>
      ) : null}
      <div className="routine-sheet-title">{heading}</div>
      <div className="routine-sheet-sub">
        {[
          examName,
          academicYearBs ? `Academic Year ${academicYearBs}` : "",
          startDateBs && endDateBs ? `${startDateBs} to ${endDateBs}` : ""
        ]
          .filter(Boolean)
          .join("  |  ")}
      </div>

      <ExamRoutineGrid columns={columns} slots={slots} variant="print" />

      {note ? <div className="routine-sheet-note">{note}</div> : null}

      <div className="routine-sheet-signs">
        {signatories.map((name) => (
          <div key={name} className="routine-sheet-sign">
            <div className="routine-sheet-sign-line" />
            {name}
          </div>
        ))}
      </div>
    </div>
  </div>
);
