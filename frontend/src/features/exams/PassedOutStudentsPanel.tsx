import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CHARACTER_CERTIFICATE_ISSUE_TYPE_LABELS,
  type CharacterCertificateRecord,
  type PassedOutStudentRecord,
} from "@phit-erp/shared";
import {
  Award,
  Copy,
  Download,
  FileText,
  GraduationCap,
  Printer,
  Search,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { filterYearsByBatch } from "lib/teacherScopeUtils";
import { cn, parseErrorMessage } from "lib/utils";
import { CertificateTemplatesPanel } from "./CertificateTemplatesPanel";
import { CharacterCertificateIssueDialog } from "./CharacterCertificateIssueDialog";
import {
  certificateRecordsKey,
  downloadCertificatePdf,
  fetchCertificateRecords,
  fetchPassedOutStudents,
  passedOutStudentsKey,
  printCertificatePdf,
} from "./characterCertificateApi";

type PassedOutTab = "students" | "records" | "templates";

interface PassedOutStudentsPanelProps {
  batches: Array<{ _id: string; name: string }>;
  years: Array<{ _id: string; name: string; batchId?: string }>;
}

const TAB_LABELS: Record<PassedOutTab, string> = {
  students: "Passed-Out Students",
  records: "Certificate Records",
  templates: "Templates",
};

const TAB_ICONS: Record<PassedOutTab, typeof GraduationCap> = {
  students: GraduationCap,
  records: FileText,
  templates: Settings2,
};

/**
 * Passed-Out Students & Character Certificate desk.
 *
 * Students land here automatically once academic promotion marks them
 * PASSED_OUT (see academicPromotionService); nothing has to be entered by hand.
 * Certificates keep one number for life — duplicates are extra issuance rows on
 * the same record, never a new number.
 */
export const PassedOutStudentsPanel = ({ batches, years }: PassedOutStudentsPanelProps) => {
  const [tab, setTab] = useState<PassedOutTab>("students");

  const [batchFilter, setBatchFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [certificateStatus, setCertificateStatus] = useState("");
  const [search, setSearch] = useState("");

  const [recordBatchFilter, setRecordBatchFilter] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [dialogMode, setDialogMode] = useState<"issue" | "duplicate">("issue");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogStudent, setDialogStudent] = useState<PassedOutStudentRecord | null>(null);
  const [dialogCertificate, setDialogCertificate] = useState<CharacterCertificateRecord | null>(
    null,
  );

  const studentsQuery = useQuery({
    queryKey: passedOutStudentsKey({ batchId: batchFilter, yearId: yearFilter, certificateStatus }),
    queryFn: () =>
      fetchPassedOutStudents({ batchId: batchFilter, yearId: yearFilter, certificateStatus }),
    enabled: tab === "students",
  });

  const recordsQuery = useQuery({
    queryKey: certificateRecordsKey({ batchId: recordBatchFilter, search: recordSearch }),
    queryFn: () => fetchCertificateRecords({ batchId: recordBatchFilter, search: recordSearch }),
    enabled: tab === "records",
  });

  // filterYearsByBatch returns nothing without a batch; "All batches" should
  // still offer every year.
  const yearOptions = useMemo(
    () => (batchFilter ? filterYearsByBatch(years, batchFilter) : years),
    [years, batchFilter],
  );

  // Server already filters by batch/year/status; search stays client-side so
  // typing feels instant on an already-loaded roster.
  const students = useMemo(() => {
    const rows = studentsQuery.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [
        row.studentName,
        row.registrationNumber ?? "",
        row.admissionNumber,
        row.batchName ?? "",
        row.programName ?? "",
        row.certificateNumber ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [studentsQuery.data, search]);

  const records = recordsQuery.data ?? [];

  const openIssueDialog = (student: PassedOutStudentRecord) => {
    setDialogMode("issue");
    setDialogStudent(student);
    setDialogCertificate(null);
    setDialogOpen(true);
  };

  const openDuplicateDialog = (certificate: CharacterCertificateRecord) => {
    setDialogMode("duplicate");
    setDialogCertificate(certificate);
    setDialogStudent(null);
    setDialogOpen(true);
  };

  const handlePrint = async (certificateId: string, issueNumber?: number) => {
    try {
      await printCertificatePdf(certificateId, issueNumber);
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  const handleDownload = async (
    record: CharacterCertificateRecord,
    issueNumber?: number,
  ) => {
    try {
      const suffix = issueNumber && issueNumber > 1 ? `-duplicate-${issueNumber}` : "";
      await downloadCertificatePdf(
        record._id,
        `character-certificate-${record.student.studentName.replace(/\s+/g, "-")}-${record.certificateNumber}${suffix}`,
        issueNumber,
      );
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TAB_LABELS) as PassedOutTab[]).map((key) => {
          const Icon = TAB_ICONS[key];
          return (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={tab === key ? "default" : "outline"}
              className={cn(tab === key && "bg-brand-600 hover:bg-brand-700")}
              onClick={() => setTab(key)}
            >
              <Icon className="mr-2 h-4 w-4" />
              {TAB_LABELS[key]}
            </Button>
          );
        })}
      </div>

      {tab === "students" ? (
        <Card>
          <CardHeader>
            <CardTitle>Passed-Out Students</CardTitle>
            <p className="text-sm text-slate-500">
              Students appear here automatically once academic promotion marks them as passed
              out. Issue a character certificate directly from this list.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                value={batchFilter}
                onChange={(event) => {
                  setBatchFilter(event.target.value);
                  setYearFilter("");
                }}
              >
                <option value="">All batches</option>
                {batches.map((batch) => (
                  <option key={batch._id} value={batch._id}>
                    {batch.name}
                  </option>
                ))}
              </Select>
              <Select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
                <option value="">All years</option>
                {yearOptions.map((year) => (
                  <option key={year._id} value={year._id}>
                    {year.name}
                  </option>
                ))}
              </Select>
              <Select
                value={certificateStatus}
                onChange={(event) => setCertificateStatus(event.target.value)}
              >
                <option value="">All certificate statuses</option>
                <option value="ISSUED">Issued</option>
                <option value="NOT_ISSUED">Not issued</option>
              </Select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name, reg. no, certificate no…"
                  className="pl-9"
                />
              </div>
            </div>

            {studentsQuery.isLoading ? (
              <LoadingState />
            ) : students.length === 0 ? (
              <EmptyState
                title="No passed-out students"
                description="Students appear here once academic promotion marks a final-year batch as passed out."
              />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <Table>
                  <TableHead>
                    <tr>
                      <Th>Student Name</Th>
                      <Th>Reg. / Roll No.</Th>
                      <Th>Batch</Th>
                      <Th>Year</Th>
                      <Th>Program</Th>
                      <Th>Passed Out</Th>
                      <Th>Certificate</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {students.map((student) => (
                      <tr key={student.studentId}>
                        <Td className="font-medium text-slate-900">{student.studentName}</Td>
                        <Td>
                          <div>{student.registrationNumber || student.admissionNumber}</div>
                          {student.rollNumber ? (
                            <div className="text-xs text-slate-500">
                              Roll {student.rollNumber}
                            </div>
                          ) : null}
                        </Td>
                        <Td>{student.batchName || "—"}</Td>
                        <Td>{student.yearName || "—"}</Td>
                        <Td>{student.programName || "—"}</Td>
                        <Td>{student.passedOutDateBs ? `${student.passedOutDateBs} BS` : "—"}</Td>
                        <Td>
                          {student.certificateNumber ? (
                            <div>
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                Issued
                              </span>
                              <div className="mt-1 text-xs font-medium text-slate-600">
                                {student.certificateNumber}
                              </div>
                              <div className="text-xs text-slate-500">
                                {student.issueCount} issue
                                {student.issueCount === 1 ? "" : "s"}
                              </div>
                            </div>
                          ) : (
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                              Not issued
                            </span>
                          )}
                        </Td>
                        <Td>
                          <div className="flex justify-end gap-1.5">
                            {student.certificateId ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handlePrint(student.certificateId as string)}
                              >
                                <Printer className="mr-1.5 h-3.5 w-3.5" />
                                Print
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => openIssueDialog(student)}
                              >
                                <Award className="mr-1.5 h-3.5 w-3.5" />
                                Issue certificate
                              </Button>
                            )}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "records" ? (
        <Card>
          <CardHeader>
            <CardTitle>Certificate Records</CardTitle>
            <p className="text-sm text-slate-500">
              Every issued character certificate, kept permanently for audit and verification.
              Reprinting never alters a record.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                value={recordBatchFilter}
                onChange={(event) => setRecordBatchFilter(event.target.value)}
              >
                <option value="">All batches</option>
                {batches.map((batch) => (
                  <option key={batch._id} value={batch._id}>
                    {batch.name}
                  </option>
                ))}
              </Select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={recordSearch}
                  onChange={(event) => setRecordSearch(event.target.value)}
                  placeholder="Certificate no., name, reg. no, program…"
                  className="pl-9"
                />
              </div>
            </div>

            {recordsQuery.isLoading ? (
              <LoadingState />
            ) : records.length === 0 ? (
              <EmptyState
                title="No certificates issued yet"
                description="Issue a character certificate from the Passed-Out Students tab."
              />
            ) : (
              <div className="space-y-3">
                {records.map((record) => {
                  const expanded = expandedId === record._id;
                  const latest = record.issuances[record.issuances.length - 1];
                  return (
                    <div
                      key={record._id}
                      className="rounded-2xl border border-slate-200 bg-white"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900">
                              {record.certificateNumber}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                              {record.issueCount} issue{record.issueCount === 1 ? "" : "s"}
                            </span>
                            {record.issueCount > 1 ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                Duplicate issued
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm font-medium text-slate-800">
                            {record.student.studentName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {[
                              record.student.registrationNumber || record.student.admissionNumber,
                              record.student.batchName,
                              record.student.programName,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Originally issued {record.originalIssueDateBs} BS
                            {latest ? ` · last issued ${record.lastIssueDateBs} BS by ${latest.issuedByName}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setExpandedId(expanded ? null : record._id)}
                          >
                            {expanded ? "Hide history" : "History"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handlePrint(record._id)}
                          >
                            <Printer className="mr-1.5 h-3.5 w-3.5" />
                            Reprint
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownload(record)}
                          >
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            PDF
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => openDuplicateDialog(record)}
                          >
                            <Copy className="mr-1.5 h-3.5 w-3.5" />
                            Duplicate
                          </Button>
                        </div>
                      </div>

                      {expanded ? (
                        <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Issuance history
                          </p>
                          <div className="space-y-2">
                            {record.issuances.map((issuance) => (
                              <div
                                key={issuance.issueNumber}
                                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                              >
                                <div className="min-w-0 text-sm">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span
                                      className={cn(
                                        "rounded-full px-2 py-0.5 text-xs font-semibold",
                                        issuance.issueType === "DUPLICATE"
                                          ? "bg-amber-100 text-amber-800"
                                          : "bg-emerald-100 text-emerald-700",
                                      )}
                                    >
                                      #{issuance.issueNumber}{" "}
                                      {CHARACTER_CERTIFICATE_ISSUE_TYPE_LABELS[issuance.issueType]}
                                    </span>
                                    <span className="text-slate-700">
                                      {issuance.issueDateBs} BS
                                    </span>
                                    <span className="text-slate-500">
                                      by {issuance.issuedByName}
                                    </span>
                                  </div>
                                  {issuance.purpose ? (
                                    <p className="mt-1 text-xs text-slate-600">
                                      <span className="font-medium">Purpose:</span>{" "}
                                      {issuance.purpose}
                                    </p>
                                  ) : null}
                                  {issuance.remarks ? (
                                    <p className="text-xs text-slate-600">
                                      <span className="font-medium">Remarks:</span>{" "}
                                      {issuance.remarks}
                                    </p>
                                  ) : null}
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handlePrint(record._id, issuance.issueNumber)}
                                >
                                  <Printer className="mr-1.5 h-3.5 w-3.5" />
                                  Reprint this
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "templates" ? (
        <Card>
          <CardHeader>
            <CardTitle>Certificate Templates</CardTitle>
          </CardHeader>
          <CardContent>
            <CertificateTemplatesPanel />
          </CardContent>
        </Card>
      ) : null}

      <CharacterCertificateIssueDialog
        open={dialogOpen}
        mode={dialogMode}
        student={dialogStudent}
        certificate={dialogCertificate}
        onClose={() => setDialogOpen(false)}
        onIssued={() => {
          void studentsQuery.refetch();
          void recordsQuery.refetch();
        }}
      />
    </div>
  );
};
