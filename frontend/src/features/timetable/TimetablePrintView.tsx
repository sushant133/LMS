import {
  WeeklyTimetableGrid,
  densityForPeriodCount,
} from "./WeeklyTimetableGrid";
import type { WeeklyMatrix } from "./timetableMatrixUtils";

export type TimetablePrintMeta = {
  collegeName: string;
  collegeNameNp?: string;
  collegeAddress?: string;
  logoUrl?: string;
  batchName?: string;
  yearName?: string;
  className?: string;
  sectionName?: string;
  academicYearBs?: string;
  generatedAt: string;
  principalName?: string;
  viewTitle: string;
};

interface TimetablePrintViewProps {
  matrix: WeeklyMatrix;
  meta: TimetablePrintMeta;
  printId?: string;
}

/**
 * Hidden print/PDF root: compact A4 landscape layout so the full weekly grid
 * (header + table + signatures) fits on a single page without overflow.
 */
export const TimetablePrintView = ({
  matrix,
  meta,
  printId = "timetable-print-root",
}: TimetablePrintViewProps) => {
  const density = densityForPeriodCount(matrix.periods.length);
  const periodCount = matrix.periods.length;

  return (
    <div
      id={printId}
      className="timetable-print-sheet hidden print:block bg-white text-black"
      data-print-fit="timetable"
      data-tt-density={density}
      data-tt-period-count={periodCount}
      style={{
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
        color: "#000000",
        backgroundColor: "#ffffff",
        boxSizing: "border-box",
        width: "100%",
        maxWidth: "287mm",
        padding: "3mm 4mm 2.5mm",
        fontFamily:
          '"IBM Plex Sans", "Noto Sans Devanagari", "Nirmala UI", sans-serif',
      }}
    >
      <header
        className="tt-print-header border-b border-black text-center text-black"
        style={{
          paddingBottom: "2mm",
          marginBottom: "2mm",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "3mm",
          }}
        >
          {meta.logoUrl ? (
            <img
              src={meta.logoUrl}
              alt=""
              style={{
                height: "9mm",
                width: "9mm",
                objectFit: "contain",
                flexShrink: 0,
              }}
            />
          ) : null}
          <div style={{ minWidth: 0, textAlign: "center" }}>
            <h1
              style={{
                margin: 0,
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                lineHeight: 1.15,
                color: "#000",
              }}
            >
              {meta.collegeName}
            </h1>
            {meta.collegeNameNp ? (
              <p
                style={{
                  margin: "1px 0 0",
                  fontSize: "9px",
                  fontWeight: 600,
                  lineHeight: 1.15,
                  color: "#000",
                }}
              >
                {meta.collegeNameNp}
              </p>
            ) : null}
            {meta.collegeAddress ? (
              <p
                style={{
                  margin: "1px 0 0",
                  fontSize: "8px",
                  fontWeight: 500,
                  lineHeight: 1.2,
                  color: "#1e293b",
                }}
              >
                {meta.collegeAddress}
              </p>
            ) : null}
          </div>
        </div>
        <p
          style={{
            margin: "2mm 0 0",
            fontSize: "11px",
            fontWeight: 700,
            lineHeight: 1.15,
            color: "#000",
          }}
        >
          Weekly Class Timetable
        </p>
        <p
          style={{
            margin: "0.5mm 0 0",
            fontSize: "9px",
            fontWeight: 600,
            lineHeight: 1.15,
            color: "#0f172a",
          }}
        >
          {meta.viewTitle}
        </p>
        <div
          style={{
            marginTop: "1.5mm",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "1mm 3mm",
            fontSize: "7.5px",
            fontWeight: 600,
            lineHeight: 1.2,
            color: "#000",
          }}
        >
          {meta.batchName ? <span>Batch: {meta.batchName}</span> : null}
          {meta.yearName ? <span>Year: {meta.yearName}</span> : null}
          {meta.className ? <span>Class: {meta.className}</span> : null}
          {meta.sectionName ? <span>Section: {meta.sectionName}</span> : null}
          {meta.academicYearBs ? (
            <span>Academic Year (BS): {meta.academicYearBs}</span>
          ) : null}
          <span>Generated: {meta.generatedAt}</span>
        </div>
      </header>

      <WeeklyTimetableGrid matrix={matrix} density={density} />

      <footer
        className="tt-print-footer"
        style={{
          marginTop: "3mm",
          paddingTop: "1.5mm",
          borderTop: "1px solid #94a3b8",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "4mm",
          textAlign: "center",
          fontSize: "7.5px",
          color: "#000",
        }}
      >
        <div>
          <div
            style={{
              margin: "0 auto 1.5mm",
              height: "7mm",
              width: "80%",
              borderBottom: "1px solid #000",
            }}
          />
          <p style={{ margin: 0, fontWeight: 700 }}>Administrator</p>
          <p style={{ margin: 0, fontWeight: 500 }}>Signature</p>
        </div>
        <div>
          <div
            style={{
              margin: "0 auto 1.5mm",
              height: "7mm",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                border: "1px dashed #64748b",
                borderRadius: "999px",
                padding: "1px 6px",
                fontSize: "6.5px",
                fontWeight: 500,
                color: "#334155",
              }}
            >
              Optional Stamp
            </span>
          </div>
          <p style={{ margin: 0, fontWeight: 700 }}>Official Seal</p>
        </div>
        <div>
          <div
            style={{
              margin: "0 auto 1.5mm",
              height: "7mm",
              width: "80%",
              borderBottom: "1px solid #000",
            }}
          />
          <p style={{ margin: 0, fontWeight: 700 }}>
            {meta.principalName || "Principal"}
          </p>
          <p style={{ margin: 0, fontWeight: 500 }}>Signature</p>
        </div>
      </footer>
    </div>
  );
};
