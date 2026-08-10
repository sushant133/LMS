import type { CSSProperties } from "react";
import {
  formatAcademicYearLabel,
  type AcademicCalendarEventRecord,
} from "@phit-erp/shared";
import { CollegeLogo } from "components/shared/CollegeLogo";
import {
  WEEKDAY_LABELS,
  buildMonthGrid,
  formatMonthKey,
  getAdDayParts,
  getBsMonthAdRangeLabel,
  getEventTypeColor,
  getEventTypeLabel,
  isSaturdayBs,
  legendGroups,
  listEventsForBsMonth,
  pickPrimaryEvent,
} from "./academicCalendarUtils";

const PRINT_AREA_ID = "academic-calendar-print";

export { PRINT_AREA_ID as ACADEMIC_CALENDAR_PRINT_ID };

type MonthInfo = {
  year: number;
  month: number;
  name: string;
  adRangeLabel?: string;
};

interface AcademicCalendarPrintViewProps {
  institutionName: string;
  institutionAddress?: string;
  academicYearBs: string;
  months: MonthInfo[];
  eventsByDate: Map<string, AcademicCalendarEventRecord[]>;
  managedEvents: AcademicCalendarEventRecord[];
  todayBs: string;
  /** Optional filter summary lines shown under the title */
  scopeLines?: string[];
}

const thStyle: CSSProperties = {
  border: "1px solid #64748b",
  background: "#e2e8f0",
  padding: "4px 6px",
  fontSize: 9,
  fontWeight: 700,
  textAlign: "left",
  color: "#0f172a",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};

const tdStyle: CSSProperties = {
  border: "1px solid #94a3b8",
  padding: "3px 6px",
  fontSize: 9,
  color: "#0f172a",
  verticalAlign: "top",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
  lineHeight: 1.35,
};

const cellBase: CSSProperties = {
  border: "1px solid #cbd5e1",
  minHeight: 22,
  padding: "2px 1px",
  textAlign: "center",
  fontSize: 9,
  fontWeight: 600,
  lineHeight: 1.15,
  verticalAlign: "middle",
  fontVariantNumeric: "tabular-nums",
  position: "relative",
  boxSizing: "border-box",
};

function cellColors(
  primary: AcademicCalendarEventRecord | undefined,
  saturday: boolean,
  isToday: boolean,
): CSSProperties {
  if (primary?.isWorkingDayOverride) {
    return {
      background: "#dcfce7",
      color: "#14532d",
      ...(isToday ? { outline: "1.5px solid #0c2d6b", outlineOffset: -1 } : {}),
    };
  }
  if (primary?.isHoliday || saturday) {
    return {
      background: "#fee2e2",
      color: "#9f1239",
      ...(isToday ? { outline: "1.5px solid #0c2d6b", outlineOffset: -1 } : {}),
    };
  }
  if (primary) {
    const color = getEventTypeColor(primary.eventType) || "#64748b";
    return {
      background: `${color}33`,
      color: "#0f172a",
      ...(isToday ? { outline: "1.5px solid #0c2d6b", outlineOffset: -1 } : {}),
    };
  }
  if (isToday) {
    return {
      background: "#dbeafe",
      color: "#0c2d6b",
      outline: "1.5px solid #0c2d6b",
      outlineOffset: -1,
    };
  }
  return { background: "#ffffff", color: "#0f172a" };
}

const PrintMonthCard = ({
  year,
  month,
  monthName,
  eventsByDate,
  todayBs,
}: {
  year: number;
  month: number;
  monthName: string;
  eventsByDate: Map<string, AcademicCalendarEventRecord[]>;
  todayBs: string;
}) => {
  const cells = buildMonthGrid(year, month);
  const adRangeLabel = getBsMonthAdRangeLabel(year, month);
  const monthPrefix = formatMonthKey(year, month);
  const monthEvents = listEventsForBsMonth(eventsByDate, year, month).filter(
    (event) => !event.isSystemGenerated,
  );

  return (
    <div
      style={{
        border: "1px solid #64748b",
        borderRadius: 4,
        overflow: "hidden",
        background: "#ffffff",
        breakInside: "avoid",
        pageBreakInside: "avoid",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
      }}
    >
      <div
        style={{
          background: "#0c2d6b",
          color: "#ffffff",
          padding: "5px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>
            {monthName}
            {adRangeLabel ? (
              <span style={{ fontWeight: 500, opacity: 0.9 }}>
                {" "}
                · {adRangeLabel}
              </span>
            ) : null}
          </div>
        </div>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            whiteSpace: "nowrap",
            opacity: 0.95,
          }}
        >
          BS {monthPrefix}
        </span>
      </div>

      <div style={{ padding: "6px 6px 4px" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <thead>
            <tr>
              {WEEKDAY_LABELS.map((label) => (
                <th
                  key={label}
                  style={{
                    ...cellBase,
                    background: "#f1f5f9",
                    fontSize: 8,
                    fontWeight: 700,
                    color: label === "Sat" ? "#e11d48" : "#64748b",
                    minHeight: 16,
                    padding: "2px 0",
                  }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(
              { length: Math.ceil(cells.length / 7) },
              (_, rowIndex) => (
                <tr key={rowIndex}>
                  {cells.slice(rowIndex * 7, rowIndex * 7 + 7).map((day, col) => {
                    if (!day) {
                      return (
                        <td
                          key={`e-${rowIndex}-${col}`}
                          style={{
                            ...cellBase,
                            background: "#f8fafc",
                            borderColor: "#e2e8f0",
                          }}
                        />
                      );
                    }
                    const dateBs = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const dayEvents = eventsByDate.get(dateBs) ?? [];
                    const primary = pickPrimaryEvent(dayEvents);
                    const saturday = isSaturdayBs(dateBs);
                    const isToday = dateBs === todayBs;
                    const adParts = getAdDayParts(dateBs);
                    const colors = cellColors(primary, saturday, isToday);
                    const titleParts = dayEvents.map(
                      (e) => `${e.name} (${getEventTypeLabel(e.eventType)})`,
                    );
                    if (saturday && dayEvents.length === 0) {
                      titleParts.push("Public Holiday (Saturday)");
                    }

                    return (
                      <td
                        key={dateBs}
                        title={titleParts.join("\n") || undefined}
                        style={{ ...cellBase, ...colors }}
                      >
                        <div>{day}</div>
                        {adParts ? (
                          <div
                            style={{
                              fontSize: 7,
                              fontWeight: 500,
                              opacity: 0.65,
                              lineHeight: 1,
                            }}
                          >
                            {adParts.label}
                          </div>
                        ) : null}
                        {dayEvents.length > 0 ? (
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "center",
                              gap: 1,
                              marginTop: 1,
                            }}
                          >
                            {dayEvents.slice(0, 3).map((event, i) => (
                              <span
                                key={`${event._id}-${i}`}
                                style={{
                                  width: 4,
                                  height: 4,
                                  borderRadius: "50%",
                                  background:
                                    getEventTypeColor(event.eventType) ||
                                    "#64748b",
                                  display: "inline-block",
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ),
            )}
          </tbody>
        </table>

        <div
          style={{
            marginTop: 6,
            borderTop: "1px solid #e2e8f0",
            paddingTop: 4,
          }}
        >
          <div
            style={{
              fontSize: 8,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "#64748b",
              marginBottom: 3,
            }}
          >
            Month events
            {monthEvents.length > 0 ? ` (${monthEvents.length})` : ""}
          </div>
          {monthEvents.length === 0 ? (
            <p style={{ margin: 0, fontSize: 8, color: "#94a3b8" }}>
              No events this month
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {monthEvents.map((event) => {
                const start = event.startDateBs || event.dateBs;
                const end = event.endDateBs || event.dateBs;
                const range = start === end ? start : `${start} → ${end}`;
                const color = getEventTypeColor(event.eventType);
                return (
                  <li
                    key={event._id}
                    style={{
                      display: "flex",
                      gap: 5,
                      alignItems: "flex-start",
                      marginBottom: 3,
                      fontSize: 8,
                      lineHeight: 1.3,
                    }}
                  >
                    <span
                      style={{
                        width: 3,
                        minHeight: 12,
                        marginTop: 1,
                        borderRadius: 1,
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 700, color: "#0f172a" }}>
                        {event.name}
                      </span>
                      <span style={{ color: "#64748b" }}>
                        {" "}
                        · {getEventTypeLabel(event.eventType)}
                        {event.isHoliday ? " · Holiday" : ""} · {range}
                        {event.totalDays && event.totalDays > 1
                          ? ` · ${event.totalDays}d`
                          : ""}
                      </span>
                      {event.reason?.trim() ? (
                        <div style={{ color: "#64748b", marginTop: 1 }}>
                          {event.reason.trim()}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Dedicated print/PDF layout for the academic calendar.
 * Hidden on screen; cloned by printElementById / downloadPdfFromElementById.
 */
export const AcademicCalendarPrintView = ({
  institutionName,
  institutionAddress,
  academicYearBs,
  months,
  eventsByDate,
  managedEvents,
  todayBs,
  scopeLines = [],
}: AcademicCalendarPrintViewProps) => {
  const printedAt = new Date().toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      id={PRINT_AREA_ID}
      className="hidden print:block"
      data-print-list="academic-calendar"
      aria-hidden="true"
      style={{
        background: "#ffffff",
        color: "#0f172a",
        padding: "8px 4px",
        fontFamily:
          '"IBM Plex Sans", "Noto Sans Devanagari", "Nirmala UI", sans-serif',
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      <header
        style={{
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: "2px solid #0f172a",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            width: "100%",
          }}
        >
          <CollegeLogo className="h-12 w-12 shrink-0" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 700,
                color: "#0f172a",
                letterSpacing: "0.01em",
                textTransform: "uppercase",
              }}
            >
              {institutionName || "Institution"}
            </p>
            {institutionAddress ? (
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 10,
                  color: "#475569",
                  lineHeight: 1.35,
                }}
              >
                {institutionAddress}
              </p>
            ) : null}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "4px 16px",
                marginTop: 4,
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#1e293b",
                }}
              >
                Academic Calendar{" "}
                {formatAcademicYearLabel(academicYearBs)}
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 9,
                  color: "#64748b",
                  whiteSpace: "nowrap",
                }}
              >
                Printed: {printedAt}
              </p>
            </div>
            {scopeLines.length > 0 ? (
              <p
                style={{
                  margin: "3px 0 0",
                  fontSize: 10,
                  color: "#334155",
                  fontWeight: 600,
                }}
              >
                {scopeLines.join("  ·  ")}
              </p>
            ) : (
              <p
                style={{
                  margin: "3px 0 0",
                  fontSize: 10,
                  color: "#64748b",
                }}
              >
                Full academic year · All categories
              </p>
            )}
            <p
              style={{
                margin: "2px 0 0",
                fontSize: 9,
                color: "#64748b",
              }}
            >
              {months.length} month{months.length === 1 ? "" : "s"} ·{" "}
              {managedEvents.length} scheduled event
              {managedEvents.length === 1 ? "" : "s"}
              {" · "}
              Saturdays are automatic public holidays
            </p>
          </div>
        </div>
      </header>

      {/* Month grids — 3 columns on landscape A4 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 8,
          marginBottom: 12,
        }}
      >
        {months.map((month) => (
          <PrintMonthCard
            key={`${month.year}-${month.month}`}
            year={month.year}
            month={month.month}
            monthName={month.name}
            eventsByDate={eventsByDate}
            todayBs={todayBs}
          />
        ))}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          padding: "6px 8px",
          border: "1px solid #cbd5e1",
          borderRadius: 4,
          background: "#f8fafc",
          fontSize: 9,
          color: "#334155",
        }}
      >
        <span
          style={{
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#64748b",
            fontSize: 8,
          }}
        >
          Legend
        </span>
        {legendGroups.map((group) => (
          <span
            key={group.key}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: group.color,
                display: "inline-block",
                border: "1px solid #94a3b8",
              }}
            />
            {group.label}
          </span>
        ))}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#dbeafe",
              display: "inline-block",
              border: "1.5px solid #0c2d6b",
            }}
          />
          Today
        </span>
      </div>

      {/* Full event list */}
      <section style={{ breakInside: "auto" }}>
        <h2
          style={{
            margin: "0 0 6px",
            fontSize: 11,
            fontWeight: 700,
            color: "#0f172a",
            borderBottom: "1px solid #94a3b8",
            paddingBottom: 4,
          }}
        >
          Event list
        </h2>
        <p
          style={{
            margin: "0 0 6px",
            fontSize: 8,
            color: "#64748b",
          }}
        >
          Scheduled events with start/end dates. Automatic Saturday holidays are
          not listed here.
        </p>

        {managedEvents.length === 0 ? (
          <p style={{ margin: 0, fontSize: 9, color: "#64748b" }}>
            No events created for this selection.
          </p>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
              border: "1px solid #64748b",
            }}
          >
            <colgroup>
              <col style={{ width: "18%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "7%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={thStyle}>Event Name</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Start (BS)</th>
                <th style={thStyle}>End (BS)</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Days</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Created By</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {managedEvents.map((event, index) => {
                const start = event.startDateBs || event.dateBs;
                const end = event.endDateBs || event.dateBs;
                const color = getEventTypeColor(event.eventType);
                return (
                  <tr
                    key={event._id}
                    style={{
                      background: index % 2 === 1 ? "#f8fafc" : "#ffffff",
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{event.name}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "1px 5px",
                          borderRadius: 999,
                          fontSize: 8,
                          fontWeight: 700,
                          background: `${color}22`,
                          color,
                          border: `1px solid ${color}55`,
                        }}
                      >
                        {getEventTypeLabel(event.eventType)}
                      </span>
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {start}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {end}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "center",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {event.totalDays ?? 1}
                    </td>
                    <td style={tdStyle}>{event.reason?.trim() || "—"}</td>
                    <td style={tdStyle}>{event.audit?.createdByName ?? "—"}</td>
                    <td style={tdStyle}>{event.status ?? "ACTIVE"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <footer
        style={{
          marginTop: 10,
          paddingTop: 6,
          borderTop: "1px solid #94a3b8",
          fontSize: 8,
          color: "#64748b",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: "4px 12px",
        }}
      >
        <p style={{ margin: 0 }}>
          Academic calendar · Confidential institutional record
          {scopeLines.length > 0 ? ` · ${scopeLines.join(" · ")}` : ""}
        </p>
        <p style={{ margin: 0 }}>
          {formatAcademicYearLabel(academicYearBs)} · {managedEvents.length}{" "}
          event{managedEvents.length === 1 ? "" : "s"}
        </p>
      </footer>
    </div>
  );
};
