import { useMemo, useRef, useState } from "react";
import {
  computeSubjectMark,
  type MarksheetViewResponse,
} from "@phit-erp/shared";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Printer } from "lucide-react";
import { getPdfErrorMessage, printMarksheetElement } from "lib/printUtils";

interface ResultMarksheetViewProps {
  data: MarksheetViewResponse;
  showActions?: boolean;
}

export const ResultMarksheetView = ({
  data,
  showActions = true,
}: ResultMarksheetViewProps) => {
  const marksheetRef = useRef<HTMLElement | null>(null);
  const [printLoading, setPrintLoading] = useState(false);

  const subjectMap = useMemo(
    () => new Map(data.subjects.map((subject) => [subject._id, subject])),
    [data.subjects],
  );

  const publishedDate =
    data.result.publishedAtBs ?? data.exam.resultPublishDateBs ?? "—";
  const examHeldDate =
    data.exam.startDateBs && data.exam.endDateBs
      ? data.exam.startDateBs === data.exam.endDateBs
        ? data.exam.startDateBs
        : `${data.exam.startDateBs} – ${data.exam.endDateBs}`
      : (data.exam.startDateBs ?? data.exam.endDateBs ?? "—");
  const studentName = data.student.user?.fullName ?? "Student";
  const isPass = String(data.result.passFailStatus ?? "")
    .toUpperCase()
    .includes("PASS");

  const rows = useMemo(
    () =>
      data.result.marks.map((mark, index) => {
        const subject = subjectMap.get(mark.subjectId);
        const computed = computeSubjectMark({
          ...mark,
          fullMarks: mark.fullMarks ?? subject?.fullMarks ?? 100,
          passMarks: mark.passMarks ?? subject?.passMarks ?? 35,
          obtainedMarks: 0,
        });
        return {
          sn: index + 1,
          subjectName: subject?.name ?? "Subject",
          fullMarks: computed.fullMarks,
          passMarks: computed.passMarks,
          theory: mark.theoryMarks ?? 0,
          practical: mark.practicalMarks ?? 0,
          obtained: computed.obtainedMarks,
          // Subject grade as stored with the published result; older marks saved
          // before the grade was persisted fall back to the same grading scale.
          grade: mark.grade ?? computed.grade,
          status: computed.passFail,
          // Only a remark a teacher actually typed prints here; blank otherwise.
          remarks: mark.teacherRemarks?.trim() ?? "",
        };
      }),
    [data.result.marks, subjectMap],
  );

  /**
   * Print is the only export offered here: the browser's print dialog renders this exact
   * DOM (fonts, logo, column widths) and offers "Save as PDF", so it matches what the user
   * sees. Client-side rasterizing (html2canvas/jsPDF) misaligned the columns, and the
   * server-rendered pdfkit copy dropped the Latin font and logo in production.
   */
  const handlePrint = async () => {
    setPrintLoading(true);
    try {
      await printMarksheetElement(marksheetRef.current);
    } catch (error) {
      toast.error(getPdfErrorMessage(error));
    } finally {
      setPrintLoading(false);
    }
  };

  return (
    <article
      ref={marksheetRef}
      className="official-marksheet print-results-marksheet"
    >
      <div className="om-watermark" aria-hidden="true">
        <span>OFFICIAL</span>
      </div>

      {showActions ? (
        <div className="om-actions no-print">
          <Button
            size="sm"
            variant="outline"
            disabled={printLoading}
            onClick={() => void handlePrint()}
          >
            <Printer className="mr-2 h-4 w-4" />
            {printLoading ? "Preparing Print..." : "Print"}
          </Button>
        </div>
      ) : null}

      <header className="om-header">
        <div className="om-header-band">
          <div className="om-logo">
            <CollegeLogo
              src={data.collegeLogoUrl}
              alt={`${data.collegeName} logo`}
            />
          </div>
          <div className="om-header-text">
            <h1 className="om-college-name">{data.collegeName}</h1>
            {data.collegeNameNp ? (
              <p className="om-college-name-np">{data.collegeNameNp}</p>
            ) : null}
            {data.collegeAddress ? (
              <p className="om-college-address">{data.collegeAddress}</p>
            ) : null}
          </div>
        </div>

        <div className="om-title-block">
          <p className="om-doc-title">Official Marksheet</p>
          <p className="om-doc-title-sub">Statement of Marks</p>
          <p className="om-exam-name">{data.exam.name}</p>
          <p className="om-session">
            Academic Session: {data.exam.academicYearBs}
          </p>
        </div>
      </header>

      <section className="om-student-grid">
        <div className="om-info-panel">
          <p className="om-info-panel-title">Student particulars</p>
          <dl className="om-info-list">
            <div className="om-info-row">
              <dt>Student Name</dt>
              <dd>{studentName}</dd>
            </div>
            <div className="om-info-row">
              <dt>Registration No.</dt>
              <dd>{data.student.admissionNumber}</dd>
            </div>
            <div className="om-info-row">
              <dt>Roll No.</dt>
              <dd>{data.student.rollNumber}</dd>
            </div>
            {data.batch ? (
              <div className="om-info-row">
                <dt>Batch</dt>
                <dd>{data.batch.name}</dd>
              </div>
            ) : null}
            {data.year ? (
              <div className="om-info-row">
                <dt>Year</dt>
                <dd>{data.year.name}</dd>
              </div>
            ) : null}
            {!data.batch && data.schoolClass ? (
              <div className="om-info-row">
                <dt>Class</dt>
                <dd>{data.schoolClass.name}</dd>
              </div>
            ) : null}
            {!data.year && data.section ? (
              <div className="om-info-row">
                <dt>Section</dt>
                <dd>{data.section.name}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="om-info-panel">
          <p className="om-info-panel-title">Examination details</p>
          <dl className="om-info-list">
            <div className="om-info-row">
              <dt>Examination</dt>
              <dd>{data.exam.name}</dd>
            </div>
            <div className="om-info-row">
              <dt>Exam Held Date</dt>
              <dd>{examHeldDate}</dd>
            </div>
            <div className="om-info-row">
              <dt>Published Date</dt>
              <dd>{publishedDate}</dd>
            </div>
            <div className="om-info-row">
              <dt>Result Status</dt>
              <dd className={isPass ? "om-status-pass" : "om-status-fail"}>
                {data.result.passFailStatus}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="om-marks-table-wrap">
        <table className="om-marks-table">
          <thead>
            <tr>
              <th className="col-sn">SN</th>
              <th className="col-subject">Subject</th>
              <th className="col-full">Full Mark</th>
              <th className="col-pass">Pass Mark</th>
              <th className="col-theory">Theory</th>
              <th className="col-practical">Practical</th>
              <th className="col-obtained">Obtained Mark</th>
              <th className="col-grade">Grade</th>
              <th className="col-status">Status</th>
              <th className="col-remarks">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.sn}-${row.subjectName}`}>
                <td className="col-sn">{row.sn}</td>
                <td className="col-subject">{row.subjectName}</td>
                <td className="col-full">{row.fullMarks}</td>
                <td className="col-pass">{row.passMarks}</td>
                <td className="col-theory">{row.theory}</td>
                <td className="col-practical">{row.practical}</td>
                <td className="col-obtained">{row.obtained}</td>
                <td className="col-grade">{row.grade}</td>
                <td className="col-status">
                  <span
                    className={
                      row.status === "PASS"
                        ? "om-badge om-badge-pass"
                        : "om-badge om-badge-fail"
                    }
                  >
                    {row.status}
                  </span>
                </td>
                <td className="col-remarks">{row.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="om-summary-row">
        <div className="om-summary">
          <h2 className="om-summary-title">Result Summary</h2>
          <table className="om-summary-table">
            <tbody>
              <tr>
                <th>Total Obtained Marks</th>
                <td>{data.totalObtained}</td>
              </tr>
              <tr>
                <th>Total Full Marks</th>
                <td>{data.totalFullMarks}</td>
              </tr>
              <tr>
                <th>Percentage</th>
                <td>{data.result.percentage}%</td>
              </tr>
              <tr>
                <th>GPA</th>
                <td>{data.result.gpa.toFixed(2)}</td>
              </tr>
              <tr>
                <th>Final Grade</th>
                <td>{data.result.grade}</td>
              </tr>
              <tr>
                <th>Overall Result</th>
                <td className={isPass ? "om-status-pass" : "om-status-fail"}>
                  {data.result.passFailStatus}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <aside className="om-gpa-card">
          <p className="om-gpa-label">Cumulative GPA</p>
          <p className="om-gpa-value">{data.result.gpa.toFixed(2)}</p>
          <p className="om-gpa-meta">{data.result.percentage}% overall</p>
          <p className="om-gpa-grade">Grade {data.result.grade}</p>
        </aside>
      </section>

      <footer className="om-footer">
        <div className="om-footer-block">
          <div className="om-footer-line">Verified By</div>
        </div>
        <div className="om-footer-block">
          <div className="om-footer-line">
            {data.controllerOfExamination ?? "Controller of Examination"}
          </div>
        </div>
      </footer>

      <div className="om-meta">
        <div className="om-meta-lines">
          {data.printedDateBs ? (
            <p>Printed Date (BS): {data.printedDateBs}</p>
          ) : null}
          {data.verificationNumber ? (
            <p>Verification No.: {data.verificationNumber}</p>
          ) : null}
        </div>
        <p className="om-meta-note">
          This is a computer-generated official marksheet. Verify authenticity
          with the institution using the verification number when provided.
        </p>
      </div>
    </article>
  );
};
