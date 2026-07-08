import { useMemo, useRef, useState } from "react";
import { computeSubjectMark, type MarksheetViewResponse } from "@phit-erp/shared";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Download, Printer } from "lucide-react";
import {
  downloadMarksheetPdfFromElement,
  getPdfErrorMessage,
  printMarksheetElement
} from "lib/printUtils";

interface ResultMarksheetViewProps {
  data: MarksheetViewResponse;
  showActions?: boolean;
}

export const ResultMarksheetView = ({ data, showActions = true }: ResultMarksheetViewProps) => {
  const marksheetRef = useRef<HTMLElement | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);

  const subjectMap = useMemo(
    () => new Map(data.subjects.map((subject) => [subject._id, subject])),
    [data.subjects]
  );

  const publishedDate = data.result.publishedAtBs ?? data.exam.resultPublishDateBs ?? "—";
  const pdfFilename = `marksheet-${data.student.user.fullName.replace(/\s+/g, "-")}-${data.exam.name.replace(/\s+/g, "-")}.pdf`;

  const rows = useMemo(
    () =>
      data.result.marks.map((mark, index) => {
        const subject = subjectMap.get(mark.subjectId);
        const computed = computeSubjectMark({
          ...mark,
          fullMarks: mark.fullMarks ?? subject?.fullMarks ?? 100,
          passMarks: mark.passMarks ?? subject?.passMarks ?? 35,
          obtainedMarks: 0
        });
        return {
          sn: index + 1,
          subjectName: subject?.name ?? "Subject",
          theory: mark.theoryMarks ?? 0,
          practical: mark.practicalMarks ?? 0,
          internal: mark.internalMarks ?? 0,
          total: computed.obtainedMarks,
          fullMarks: computed.fullMarks,
          grade: computed.grade,
          status: computed.passFail,
          remarks: mark.teacherRemarks || "—"
        };
      }),
    [data.result.marks, subjectMap]
  );

  const handlePdf = async () => {
    setPdfLoading(true);
    try {
      await downloadMarksheetPdfFromElement(marksheetRef.current, pdfFilename);
    } catch (error) {
      toast.error(getPdfErrorMessage(error));
    } finally {
      setPdfLoading(false);
    }
  };

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
    <article ref={marksheetRef} className="official-marksheet print-results-marksheet">
      {showActions ? (
        <div className="om-actions no-print">
          <Button size="sm" variant="outline" disabled={pdfLoading} onClick={() => void handlePdf()}>
            <Download className="mr-2 h-4 w-4" />
            {pdfLoading ? "Preparing PDF..." : "Download PDF"}
          </Button>
          <Button size="sm" variant="outline" disabled={printLoading} onClick={() => void handlePrint()}>
            <Printer className="mr-2 h-4 w-4" />
            {printLoading ? "Preparing Print..." : "Print"}
          </Button>
        </div>
      ) : null}

      <header className="om-header">
        <div className="om-logo">
          <CollegeLogo src={data.collegeLogoUrl} alt={`${data.collegeName} logo`} />
        </div>
        <h1 className="om-college-name">{data.collegeName}</h1>
        {data.collegeNameNp ? <p className="om-college-name-np">{data.collegeNameNp}</p> : null}
        {data.collegeAddress ? <p className="om-college-address">{data.collegeAddress}</p> : null}
        <p className="om-doc-title">OFFICIAL MARKSHEET</p>
        <p className="om-exam-name">{data.exam.name}</p>
        <p className="om-session">Academic Session: {data.exam.academicYearBs}</p>
      </header>

      <section className="om-student-grid">
        <dl className="om-info-list">
          <div className="om-info-row">
            <dt>Student Name</dt>
            <dd>{data.student.user.fullName}</dd>
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

        <dl className="om-info-list">
          <div className="om-info-row">
            <dt>Examination</dt>
            <dd>{data.exam.name}</dd>
          </div>
          <div className="om-info-row">
            <dt>Published Date</dt>
            <dd>{publishedDate}</dd>
          </div>
          <div className="om-info-row">
            <dt>Result Status</dt>
            <dd>{data.result.passFailStatus}</dd>
          </div>
          <div className="om-info-row">
            <dt>GPA</dt>
            <dd>{data.result.gpa.toFixed(2)}</dd>
          </div>
          <div className="om-info-row">
            <dt>Percentage</dt>
            <dd>{data.result.percentage}%</dd>
          </div>
        </dl>
      </section>

      <div className="om-marks-table-wrap">
        <table className="om-marks-table">
          <thead>
            <tr>
              <th className="col-sn">SN</th>
              <th className="col-subject">Subject</th>
              <th className="col-theory">Theory</th>
              <th className="col-practical">Practical</th>
              <th className="col-internal">Internal</th>
              <th className="col-total">Total</th>
              <th className="col-full">Full Marks</th>
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
                <td className="col-theory">{row.theory}</td>
                <td className="col-practical">{row.practical}</td>
                <td className="col-internal">{row.internal}</td>
                <td className="col-total">{row.total}</td>
                <td className="col-full">{row.fullMarks}</td>
                <td className="col-grade">{row.grade}</td>
                <td className="col-status">{row.status}</td>
                <td className="col-remarks">{row.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="om-summary">
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
              <th>Result</th>
              <td>{data.result.passFailStatus}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer className="om-footer">
        <div className="om-footer-block">
          {data.principalName ? <p className="om-footer-name">{data.principalName}</p> : null}
          <div className="om-footer-line">Principal Signature</div>
        </div>
        <div className="om-footer-block">
          <div className="om-footer-line">{data.controllerOfExamination ?? "Controller of Examination"}</div>
        </div>
      </footer>

      <div className="om-meta">
        <div className="om-meta-lines">
          {data.printedDateBs ? <p>Printed Date: {data.printedDateBs}</p> : null}
          {data.verificationNumber ? <p>Verification No.: {data.verificationNumber}</p> : null}
        </div>
      </div>
    </article>
  );
};