import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { ExamRecord, StudentRecord } from "@phit-erp/shared";
import { IdCard, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { fetchAuthenticatedBlobUrl } from "lib/attachments";
import { getPrintInstitutionBranding } from "lib/printBranding";
import { getPdfErrorMessage, printAdmitCardsElement } from "lib/printUtils";
import { filterYearsByBatch } from "lib/teacherScopeUtils";
import { cn } from "lib/utils";

/** Six cards per A4 sheet — the grid in admit-card.css is sized for exactly this. */
const CARDS_PER_SHEET = 6;

/** Parallel photo fetches — enough to fill a class quickly without flooding. */
const PHOTO_FETCH_CONCURRENCY = 6;

/**
 * The student's profile photograph.
 *
 * `photoUrl` is set from the STUDENT_PHOTOGRAPH document when the student form
 * saves, but a photo attached later through the documents section only lands in
 * `documents`, so fall through to that and finally to the linked user account.
 */
const studentPhotoSource = (student: StudentRecord): string => {
  const direct = student.photoUrl?.trim();
  if (direct) return direct;

  const doc = student.documents?.find(
    (row) => row.type === "STUDENT_PHOTOGRAPH" && row.url?.trim(),
  );
  if (doc?.url?.trim()) return doc.url.trim();

  return student.user?.profilePhotoUrl?.trim() ?? "";
};

/**
 * Uploads are auth-gated, so a bare <img src="/api/uploads/…"> renders nothing —
 * and never would inside the print iframe, which carries no session. Fetch each
 * photo once with credentials and keep it as a data URI so the printed clone is
 * self-contained. "" is cached for failures so a broken file is not refetched.
 */
const photoCache = new Map<string, string>();

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read photo"));
    reader.readAsDataURL(blob);
  });

const loadPhotoDataUrl = async (url: string): Promise<string> => {
  const cached = photoCache.get(url);
  if (cached !== undefined) return cached;

  let dataUrl = "";
  try {
    const resolved = await fetchAuthenticatedBlobUrl(url);
    if (resolved.startsWith("blob:")) {
      const response = await fetch(resolved);
      dataUrl = await blobToDataUrl(await response.blob());
      URL.revokeObjectURL(resolved);
    } else {
      // External CDN link — usable directly, no session needed.
      dataUrl = resolved;
    }
  } catch {
    dataUrl = "";
  }
  photoCache.set(url, dataUrl);
  return dataUrl;
};

interface ScopeOption {
  _id: string;
  name: string;
  batchId?: string;
}

interface AdmitCardPanelProps {
  isCollege: boolean;
  labels: {
    primary: string;
    secondary: string;
    primaryPlural: string;
    secondaryPlural: string;
  };
  exams: ExamRecord[];
  batches: ScopeOption[];
  years: ScopeOption[];
  classes: Array<{ _id: string; name: string }>;
  sections: Array<{ _id: string; name: string; classId?: string }>;
  students: StudentRecord[];
}

/** One printed card. Kept presentational so bulk and single print share it exactly. */
const AdmitCard = ({
  student,
  exam,
  college,
  photo,
  batchName,
  yearName,
  className,
  sectionName,
}: {
  student: StudentRecord;
  exam: ExamRecord;
  college: { name: string; nameNp?: string; address?: string };
  /** Data URI of the student's profile photograph, "" while loading or absent. */
  photo: string;
  batchName?: string;
  yearName?: string;
  className?: string;
  sectionName?: string;
}) => {
  const symbolNo = student.registrationNumber?.trim() || student.admissionNumber;

  /** Only the rows that actually have a value — a small card cannot carry blanks. */
  const rows: Array<{ label: string; value: string; strong?: boolean }> = [
    {
      label: "Name",
      value: student.user?.fullName ?? "—",
      strong: true,
    },
    { label: "Symbol No.", value: symbolNo || "—", strong: true },
    { label: "Roll No.", value: String(student.rollNumber ?? "—") },
  ];
  if (student.registrationNumber?.trim() && student.admissionNumber) {
    rows.push({ label: "Admission", value: student.admissionNumber });
  }
  if (batchName) rows.push({ label: "Batch", value: batchName });
  if (yearName) rows.push({ label: "Year", value: yearName });
  if (className) rows.push({ label: "Class", value: className });
  if (sectionName) rows.push({ label: "Section", value: sectionName });
  if (student.dateOfBirthBs) {
    rows.push({ label: "D.O.B (BS)", value: student.dateOfBirthBs });
  }

  const dateRange =
    exam.startDateBs && exam.endDateBs
      ? exam.startDateBs === exam.endDateBs
        ? exam.startDateBs
        : `${exam.startDateBs} — ${exam.endDateBs}`
      : exam.startDateBs || exam.endDateBs || "";

  return (
    <article className="ac-card">
      <header className="ac-head">
        <CollegeLogo className="ac-logo" alt={`${college.name} logo`} />
        <div className="ac-head-text">
          <p className="ac-college">{college.name}</p>
          {college.nameNp ? (
            <p className="ac-college-np" lang="ne">
              {college.nameNp}
            </p>
          ) : null}
          {college.address ? (
            <p className="ac-address">{college.address}</p>
          ) : null}
        </div>
      </header>

      <p className="ac-title">Admit Card</p>
      <p className="ac-exam">{exam.name}</p>
      <p className="ac-session">
        Academic Session: {exam.academicYearBs}
        {dateRange ? ` · Exam: ${dateRange}` : ""}
      </p>

      <div className="ac-body">
        <dl className="ac-fields">
          {rows.map((row) => (
            <Fragment key={row.label}>
              <dt>{row.label}</dt>
              <dd className={row.strong ? "ac-strong" : undefined}>
                {row.value}
              </dd>
            </Fragment>
          ))}
        </dl>
        <div className="ac-photo">
          {photo ? (
            <img src={photo} alt={student.user?.fullName ?? "Candidate"} />
          ) : (
            <span className="ac-photo-empty">Affix recent photo</span>
          )}
        </div>
      </div>

      <p className="ac-note">
        Carry this card to every paper. Entry is refused without it. Candidates
        must reach the hall 15 minutes before the paper begins.
      </p>

      <div className="ac-signs">
        <span className="ac-sign">Candidate&apos;s Signature</span>
        <span className="ac-sign">Controller of Examinations</span>
      </div>
    </article>
  );
};

export const AdmitCardPanel = ({
  isCollege,
  labels,
  exams,
  batches,
  years,
  classes,
  sections,
  students,
}: AdmitCardPanelProps) => {
  const [examId, setExamId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Set while printing a single card so the print root holds only that one. */
  const [soloStudentId, setSoloStudentId] = useState("");
  const [printing, setPrinting] = useState(false);

  /** Bumped after photos land so the cards re-read the cache. */
  const [photoVersion, setPhotoVersion] = useState(0);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  const printRef = useRef<HTMLDivElement | null>(null);
  const college = getPrintInstitutionBranding();

  /**
   * Fetch every missing photo for `list`, then force one re-render. Resolves
   * only once the cache is warm, so callers can print straight afterwards and
   * know the <img> tags carry data URIs rather than unauthenticated paths.
   */
  const ensurePhotos = useCallback(async (list: StudentRecord[]) => {
    const pending = [
      ...new Set(
        list
          .map((student) => studentPhotoSource(student))
          .filter((url) => url && photoCache.get(url) === undefined),
      ),
    ];
    if (pending.length === 0) return;

    setLoadingPhotos(true);
    try {
      const queue = [...pending];
      const workers = Array.from(
        { length: Math.min(PHOTO_FETCH_CONCURRENCY, queue.length) },
        async () => {
          for (let url = queue.shift(); url; url = queue.shift()) {
            await loadPhotoDataUrl(url);
          }
        },
      );
      await Promise.all(workers);
    } finally {
      setLoadingPhotos(false);
    }
    flushSync(() => setPhotoVersion((value) => value + 1));
  }, []);

  const selectedExam = useMemo(
    () => exams.find((exam) => exam._id === examId) ?? null,
    [exams, examId],
  );

  /** Default to the most recent exam so the panel is useful on open. */
  useEffect(() => {
    if (examId || exams.length === 0) return;
    const sorted = [...exams].sort((a, b) =>
      (b.startDateBs || "").localeCompare(a.startDateBs || ""),
    );
    setExamId(sorted[0]?._id ?? "");
  }, [exams, examId]);

  const batchById = useMemo(
    () => new Map(batches.map((b) => [b._id, b.name])),
    [batches],
  );
  const yearById = useMemo(
    () => new Map(years.map((y) => [y._id, y.name])),
    [years],
  );
  const classById = useMemo(
    () => new Map(classes.map((c) => [c._id, c.name])),
    [classes],
  );
  const sectionById = useMemo(
    () => new Map(sections.map((s) => [s._id, s.name])),
    [sections],
  );

  const yearOptions = useMemo(
    () => (batchId ? filterYearsByBatch(years, batchId) : years),
    [years, batchId],
  );
  const sectionOptions = useMemo(
    () => (classId ? sections.filter((s) => s.classId === classId) : sections),
    [sections, classId],
  );

  /**
   * Exam-appearing candidates: enrolled students of the selected cohort.
   * Back students (PENDING_NOT_PASSED) sit the exam too, so they are included —
   * the same rule the CTEVT fee panels use.
   */
  const appearingStudents = useMemo(() => {
    const examBatchIds = new Set((selectedExam?.batchIds ?? []).map(String));
    const examYearIds = new Set((selectedExam?.yearIds ?? []).map(String));
    const examClassIds = new Set((selectedExam?.classIds ?? []).map(String));

    return students.filter((student) => {
      const status = student.academicStatus ?? "ACTIVE";
      if (status !== "ACTIVE" && status !== "PENDING_NOT_PASSED") return false;

      // Restrict to the cohorts the exam is actually assigned to, when it has any.
      if (selectedExam) {
        if (isCollege && examYearIds.size > 0) {
          if (!student.yearId || !examYearIds.has(String(student.yearId))) {
            return false;
          }
        } else if (isCollege && examBatchIds.size > 0) {
          if (!student.batchId || !examBatchIds.has(String(student.batchId))) {
            return false;
          }
        } else if (!isCollege && examClassIds.size > 0) {
          if (!student.classId || !examClassIds.has(String(student.classId))) {
            return false;
          }
        }
      }
      return true;
    });
  }, [students, selectedExam, isCollege]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return appearingStudents
      .filter((student) => {
        if (batchId && String(student.batchId ?? "") !== batchId) return false;
        if (yearId && String(student.yearId ?? "") !== yearId) return false;
        if (classId && String(student.classId ?? "") !== classId) return false;
        if (sectionId && String(student.sectionId ?? "") !== sectionId) {
          return false;
        }
        if (!q) return true;
        const name = (student.user?.fullName ?? "").toLowerCase();
        const adm = (student.admissionNumber ?? "").toLowerCase();
        const reg = (student.registrationNumber ?? "").toLowerCase();
        const roll = String(student.rollNumber ?? "");
        return (
          name.includes(q) ||
          adm.includes(q) ||
          reg.includes(q) ||
          roll.includes(q)
        );
      })
      .sort((a, b) => {
        const rollDiff = (a.rollNumber ?? 0) - (b.rollNumber ?? 0);
        if (rollDiff !== 0) return rollDiff;
        return (a.user?.fullName ?? "").localeCompare(b.user?.fullName ?? "");
      });
  }, [appearingStudents, batchId, yearId, classId, sectionId, search]);

  /** Drop selections that the current filters hide, so the count never lies. */
  useEffect(() => {
    setSelectedIds((current) => {
      if (current.length === 0) return current;
      const visible = new Set(filteredStudents.map((s) => s._id));
      const next = current.filter((id) => visible.has(id));
      return next.length === current.length ? current : next;
    });
  }, [filteredStudents]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected =
    filteredStudents.length > 0 &&
    filteredStudents.every((s) => selectedSet.has(s._id));

  const toggleStudent = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      if (allVisibleSelected) {
        const visible = new Set(filteredStudents.map((s) => s._id));
        return current.filter((id) => !visible.has(id));
      }
      const merged = new Set(current);
      for (const student of filteredStudents) merged.add(student._id);
      return [...merged];
    });
  };

  /** Cards currently in the print root: the solo card when set, else the selection. */
  const cardStudents = useMemo(() => {
    if (!selectedExam) return [];
    if (soloStudentId) {
      const one = filteredStudents.find((s) => s._id === soloStudentId);
      return one ? [one] : [];
    }
    return filteredStudents.filter((s) => selectedSet.has(s._id));
  }, [selectedExam, soloStudentId, filteredStudents, selectedSet]);

  /** Chunked into sheets of six; admit-card.css page-breaks between sheets. */
  const sheets = useMemo(() => {
    const out: StudentRecord[][] = [];
    for (let i = 0; i < cardStudents.length; i += CARDS_PER_SHEET) {
      out.push(cardStudents.slice(i, i + CARDS_PER_SHEET));
    }
    return out;
  }, [cardStudents]);

  /** Warm the preview's photos in the background. */
  useEffect(() => {
    if (cardStudents.length === 0) return;
    void ensurePhotos(cardStudents);
  }, [cardStudents, ensurePhotos]);

  /**
   * `cards` is passed in rather than read from state: printOne flushes a new
   * selection and prints in the same tick, so the closure's `cardStudents`
   * would still hold the previous list.
   */
  const runPrint = async (cards: StudentRecord[]) => {
    setPrinting(true);
    try {
      // The print iframe has no session — every photo must already be a data URI.
      await ensurePhotos(cards);
      await printAdmitCardsElement(printRef.current);
    } catch (error) {
      toast.error(getPdfErrorMessage(error));
    } finally {
      setPrinting(false);
    }
  };

  const printBulk = async () => {
    if (!selectedExam) {
      toast.error("Select an exam first");
      return;
    }
    if (selectedIds.length === 0) {
      toast.error("Select at least one student");
      return;
    }
    const cards = filteredStudents.filter((s) => selectedSet.has(s._id));
    // flushSync so the print root holds the full selection before it is cloned.
    flushSync(() => setSoloStudentId(""));
    await runPrint(cards);
  };

  const printOne = async (studentId: string) => {
    if (!selectedExam) {
      toast.error("Select an exam first");
      return;
    }
    const one = filteredStudents.find((s) => s._id === studentId);
    if (!one) return;
    flushSync(() => setSoloStudentId(studentId));
    try {
      await runPrint([one]);
    } finally {
      setSoloStudentId("");
    }
  };

  const cardFor = (student: StudentRecord) => (
    <AdmitCard
      key={`${student._id}-${photoVersion}`}
      student={student}
      exam={selectedExam!}
      college={college}
      photo={photoCache.get(studentPhotoSource(student)) ?? ""}
      batchName={
        student.batchId ? batchById.get(String(student.batchId)) : undefined
      }
      yearName={
        student.yearId ? yearById.get(String(student.yearId)) : undefined
      }
      className={
        student.classId ? classById.get(String(student.classId)) : undefined
      }
      sectionName={
        student.sectionId
          ? sectionById.get(String(student.sectionId))
          : undefined
      }
    />
  );

  const sheetCount = sheets.length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <IdCard className="h-4 w-4 text-brand-600" />
                Admit cards
              </CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                Print admit cards for the students appearing in an exam —
                individually, or in bulk with six cards to an A4 sheet. Card
                size is identical either way.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-slate-100 text-slate-700">
                {filteredStudents.length} appearing
              </Badge>
              <Badge
                className={
                  selectedIds.length > 0
                    ? "bg-brand-100 text-brand-800"
                    : "bg-slate-100 text-slate-600"
                }
              >
                {selectedIds.length} selected
              </Badge>
              <Button
                type="button"
                size="sm"
                disabled={
                  printing || !selectedExam || selectedIds.length === 0
                }
                onClick={() => void printBulk()}
              >
                <Printer className="mr-1.5 h-4 w-4" />
                {printing
                  ? loadingPhotos
                    ? "Loading photos…"
                    : "Preparing…"
                  : `Print ${selectedIds.length || ""} selected`.trim()}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <FormField label="Exam *">
              <Select
                value={examId}
                onChange={(e) => {
                  setExamId(e.target.value);
                  setSelectedIds([]);
                }}
              >
                <option value="">Select exam</option>
                {exams.map((exam) => (
                  <option key={exam._id} value={exam._id}>
                    {exam.name} · {exam.academicYearBs}
                  </option>
                ))}
              </Select>
            </FormField>
            {isCollege ? (
              <>
                <FormField label={labels.primary}>
                  <Select
                    value={batchId}
                    onChange={(e) => {
                      setBatchId(e.target.value);
                      setYearId("");
                    }}
                  >
                    <option value="">All {labels.primaryPlural}</option>
                    {batches.map((batch) => (
                      <option key={batch._id} value={batch._id}>
                        {batch.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label={labels.secondary}>
                  <Select
                    value={yearId}
                    onChange={(e) => setYearId(e.target.value)}
                  >
                    <option value="">All {labels.secondaryPlural}</option>
                    {yearOptions.map((year) => (
                      <option key={year._id} value={year._id}>
                        {year.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </>
            ) : (
              <>
                <FormField label="Class">
                  <Select
                    value={classId}
                    onChange={(e) => {
                      setClassId(e.target.value);
                      setSectionId("");
                    }}
                  >
                    <option value="">All classes</option>
                    {classes.map((row) => (
                      <option key={row._id} value={row._id}>
                        {row.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Section">
                  <Select
                    value={sectionId}
                    onChange={(e) => setSectionId(e.target.value)}
                  >
                    <option value="">All sections</option>
                    {sectionOptions.map((row) => (
                      <option key={row._id} value={row._id}>
                        {row.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </>
            )}
            <FormField label="Search">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, roll, symbol no…"
                />
              </div>
            </FormField>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={toggleAllVisible}
                disabled={filteredStudents.length === 0}
              >
                {allVisibleSelected ? "Clear selection" : "Select all shown"}
              </Button>
            </div>
          </div>

          {!selectedExam ? (
            <EmptyState
              title="Select an exam"
              description="Choose the exam whose admit cards you want to print."
            />
          ) : filteredStudents.length === 0 ? (
            <EmptyState
              title="No appearing students"
              description="No enrolled students match this exam and the current filters."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <Table>
                <TableHead>
                  <tr>
                    <Th className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all shown students"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                      />
                    </Th>
                    <Th>Roll</Th>
                    <Th>Student</Th>
                    <Th>Symbol / Admission</Th>
                    <Th>{isCollege ? labels.secondary : "Class"}</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Admit card</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {filteredStudents.map((student) => {
                    const checked = selectedSet.has(student._id);
                    const status = student.academicStatus ?? "ACTIVE";
                    const cohort = isCollege
                      ? [
                          student.batchId
                            ? batchById.get(String(student.batchId))
                            : "",
                          student.yearId
                            ? yearById.get(String(student.yearId))
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : [
                          student.classId
                            ? classById.get(String(student.classId))
                            : "",
                          student.sectionId
                            ? sectionById.get(String(student.sectionId))
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ");
                    return (
                      <tr
                        key={student._id}
                        className={cn(checked ? "bg-brand-50/60" : undefined)}
                      >
                        <Td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${student.user?.fullName ?? "student"}`}
                            checked={checked}
                            onChange={() => toggleStudent(student._id)}
                          />
                        </Td>
                        <Td className="font-medium">{student.rollNumber}</Td>
                        <Td>
                          <span className="font-medium">
                            {student.user?.fullName ?? "Student"}
                          </span>
                        </Td>
                        <Td className="text-sm text-slate-600">
                          {student.registrationNumber?.trim() ||
                            student.admissionNumber}
                        </Td>
                        <Td className="text-sm text-slate-600">
                          {cohort || "—"}
                        </Td>
                        <Td>
                          {status === "PENDING_NOT_PASSED" ? (
                            <Badge className="bg-amber-100 text-amber-800">
                              Back
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-100 text-emerald-800">
                              Active
                            </Badge>
                          )}
                        </Td>
                        <Td className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={printing}
                            onClick={() => void printOne(student._id)}
                          >
                            <Printer className="mr-1.5 h-3.5 w-3.5" />
                            Print
                          </Button>
                        </Td>
                      </tr>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* One stable mount point for the print root — the ref must never swap
          elements, because printOne renders into it and prints in one go. */}
      <Card className={cardStudents.length > 0 ? undefined : "hidden"}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Print preview</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  {cardStudents.length} card
                  {cardStudents.length === 1 ? "" : "s"} · {sheetCount} A4 sheet
                  {sheetCount === 1 ? "" : "s"} · six cards per sheet
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={printing}
                onClick={() => void runPrint(cardStudents)}
              >
                <Printer className="mr-1.5 h-4 w-4" />
                Print this preview
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="ac-preview">
              <div ref={printRef}>
                {sheets.map((sheet, index) => (
                  <div className="ac-sheet" key={`sheet-${index}`}>
                    {sheet.map((student) => cardFor(student))}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
      </Card>
    </div>
  );
};

export default AdmitCardPanel;
