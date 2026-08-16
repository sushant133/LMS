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
  /** Printed heading under the college name. Defaults to weekly class timetable. */
  documentTitle?: string;
  staffName?: string;
  department?: string;
};

interface TimetablePrintViewProps {
  matrix: WeeklyMatrix;
  meta: TimetablePrintMeta;
  printId?: string;
}

/**
 * Hidden print/PDF root for weekly timetable.
 * Compact layout; printUtils scales + centers onto one A4 landscape page.
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
        display: "flex",
        flexDirection: "column",
        gap: "1.5mm",
        // Width/height are assigned by the print + PDF page-fit pass
        // (printUtils `fitTimetableSheet`); a fixed width here fights it.
        width: "100%",
        minWidth: 0,
        maxWidth: "none",
        padding: "2mm 2.5mm 1.5mm",
        fontFamily:
          '"IBM Plex Sans", "Noto Sans Devanagari", "Nirmala UI", sans-serif',
      }}
    >
      <header
        className="tt-print-header text-center text-black"
        style={{
          borderBottom: "1px solid #000",
          paddingBottom: "1.5mm",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "2.5mm",
          }}
        >
          {meta.logoUrl ? (
            <img
              src={meta.logoUrl}
              alt=""
              style={{
                height: "8mm",
                width: "8mm",
                objectFit: "contain",
                flexShrink: 0,
              }}
            />
          ) : null}
          <div style={{ minWidth: 0, textAlign: "center" }}>
            <h1
              style={{
                margin: 0,
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                lineHeight: 1.12,
                color: "#000",
              }}
            >
              {meta.collegeName}
            </h1>
            {meta.collegeNameNp ? (
              <p
                style={{
                  margin: "1px 0 0",
                  fontSize: "8.5px",
                  fontWeight: 600,
                  lineHeight: 1.12,
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
                  fontSize: "7.5px",
                  fontWeight: 500,
                  lineHeight: 1.15,
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
            margin: "1.5mm 0 0",
            fontSize: "10px",
            fontWeight: 700,
            lineHeight: 1.12,
            color: "#000",
          }}
        >
          {meta.documentTitle || "Weekly Class Timetable"}
        </p>
        <p
          style={{
            margin: "0.4mm 0 0",
            fontSize: "8.5px",
            fontWeight: 600,
            lineHeight: 1.12,
            color: "#0f172a",
          }}
        >
          {meta.viewTitle}
        </p>
        <div
          style={{
            marginTop: "1mm",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "0.6mm 2.5mm",
            fontSize: "7px",
            fontWeight: 600,
            lineHeight: 1.15,
            color: "#000",
          }}
        >
          {meta.batchName ? <span>Batch: {meta.batchName}</span> : null}
          {meta.yearName ? <span>Year: {meta.yearName}</span> : null}
          {meta.className ? <span>Class: {meta.className}</span> : null}
          {meta.sectionName ? <span>Section: {meta.sectionName}</span> : null}
          {meta.staffName ? <span>Staff: {meta.staffName}</span> : null}
          {meta.department ? <span>Department: {meta.department}</span> : null}
          {meta.academicYearBs ? (
            <span>Academic Year (BS): {meta.academicYearBs}</span>
          ) : null}
          <span>Generated: {meta.generatedAt}</span>
        </div>
      </header>

      <div style={{ flex: "1 1 auto", minHeight: 0, width: "100%" }}>
        <WeeklyTimetableGrid matrix={matrix} density={density} />
      </div>

      <footer
        className="tt-print-footer"
        style={{
          flexShrink: 0,
          paddingTop: "1mm",
          borderTop: "1px solid #94a3b8",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "3mm",
          textAlign: "center",
          fontSize: "7px",
          color: "#000",
        }}
      >
        <div>
          <div
            style={{
              margin: "0 auto 1mm",
              height: "5mm",
              width: "70%",
              borderBottom: "1px solid #000",
            }}
          />
          <p style={{ margin: 0, fontWeight: 700 }}>Administrator</p>
          <p style={{ margin: 0, fontWeight: 500 }}>Signature</p>
        </div>
        <div>
          <div
            style={{
              margin: "0 auto 1mm",
              height: "5mm",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                border: "1px dashed #64748b",
                borderRadius: "999px",
                padding: "0 5px",
                fontSize: "6px",
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
              margin: "0 auto 1mm",
              height: "5mm",
              width: "70%",
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
