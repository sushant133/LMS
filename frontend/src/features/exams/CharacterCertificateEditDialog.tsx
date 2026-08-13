import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CHARACTER_CERTIFICATE_CONDUCT_RATINGS,
  CHARACTER_CERTIFICATE_ISSUE_TYPE_LABELS,
  type CharacterCertificateDetails,
  type CharacterCertificateRecord,
} from "@phit-erp/shared";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { parseErrorMessage } from "lib/utils";
import { updateCertificateRecord } from "./characterCertificateApi";

/**
 * Correct a certificate that has already been issued.
 *
 * Distinct from "Generate Duplicate": a duplicate adds a new issuance row for a
 * replacement copy, whereas this fixes a mistake on a row that already exists.
 * The certificate number is deliberately not editable — a record carrying the
 * wrong number is deleted and reissued instead.
 *
 * The body is stored already-resolved, so a misspelt name has to be corrected in
 * the body text itself; the student fields below only drive the records list and
 * its search.
 */
interface CharacterCertificateEditDialogProps {
  open: boolean;
  certificate: CharacterCertificateRecord | null;
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY_DETAILS: Required<CharacterCertificateDetails> = {
  issueNo: "",
  courseDuration: "",
  programName: "",
  studyFromBs: "",
  studyFromAd: "",
  examYearBs: "",
  examYearAd: "",
  division: "",
};

export const CharacterCertificateEditDialog = ({
  open,
  certificate,
  onClose,
  onSaved,
}: CharacterCertificateEditDialogProps) => {
  const [issueNumber, setIssueNumber] = useState<number>(0);
  const [studentName, setStudentName] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [motherName, setMotherName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [dateOfBirthBs, setDateOfBirthBs] = useState("");
  const [conduct, setConduct] = useState("");
  const [issueDateBs, setIssueDateBs] = useState("");
  const [purpose, setPurpose] = useState("");
  const [remarks, setRemarks] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState<Required<CharacterCertificateDetails>>(EMPTY_DETAILS);

  const issuances = useMemo(() => certificate?.issuances ?? [], [certificate]);
  const selected = useMemo(
    () => issuances.find((entry) => entry.issueNumber === issueNumber),
    [issuances, issueNumber],
  );

  // Default to the most recent issuance, which is the sheet the student holds.
  useEffect(() => {
    if (!open || !certificate) return;
    const latest = certificate.issuances[certificate.issuances.length - 1];
    setIssueNumber(latest?.issueNumber ?? 1);
    setStudentName(certificate.student.studentName ?? "");
    setFatherName(certificate.student.fatherName ?? "");
    setMotherName(certificate.student.motherName ?? "");
    setRegistrationNumber(certificate.student.registrationNumber ?? "");
    setDateOfBirthBs(certificate.student.dateOfBirthBs ?? "");
    setConduct(certificate.conduct ?? "");
    setReason("");
  }, [open, certificate]);

  // Switching issuance reloads the fields stored against that row.
  useEffect(() => {
    if (!selected) return;
    setIssueDateBs(selected.issueDateBs ?? "");
    setPurpose(selected.purpose ?? "");
    setRemarks(selected.remarks ?? "");
    setBody(selected.resolvedBody ?? "");
    setDetails({ ...EMPTY_DETAILS, ...(selected.details ?? {}) });
  }, [selected]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!certificate) throw new Error("No certificate selected");
      return updateCertificateRecord(certificate._id, {
        issueNumber,
        studentName: studentName.trim(),
        fatherName: fatherName.trim(),
        motherName: motherName.trim(),
        registrationNumber: registrationNumber.trim(),
        dateOfBirthBs: dateOfBirthBs.trim(),
        conduct: conduct.trim(),
        issueDateBs: issueDateBs.trim(),
        purpose: purpose.trim(),
        remarks: remarks.trim(),
        resolvedBody: body.trim(),
        reason: reason.trim(),
        ...details,
      });
    },
    onSuccess: () => {
      toast.success("Certificate corrected");
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  if (!open || !certificate) return null;

  const setDetail = (key: keyof CharacterCertificateDetails, value: string) =>
    setDetails((current) => ({ ...current, [key]: value }));

  const bodyReady = body.trim().length >= 20;
  const canSubmit = bodyReady && studentName.trim().length > 0 && !saveMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className="my-8 w-full max-w-4xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Edit Certificate</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {certificate.student.studentName} · {certificate.certificateNumber}
            </p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            Corrections are applied to the issuance you pick below and are recorded in the audit
            log. Certificate number <strong>{certificate.certificateNumber}</strong> stays the
            same — if the number itself is wrong, delete the record and issue it again.
          </div>

          {issuances.length > 1 ? (
            <FormField label="Issuance to correct">
              <Select
                value={String(issueNumber)}
                onChange={(event) => setIssueNumber(Number(event.target.value))}
              >
                {issuances.map((entry) => (
                  <option key={entry.issueNumber} value={entry.issueNumber}>
                    #{entry.issueNumber}{" "}
                    {CHARACTER_CERTIFICATE_ISSUE_TYPE_LABELS[entry.issueType]} ·{" "}
                    {entry.issueDateBs} BS
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Student record</h3>
            <p className="text-xs text-slate-500">
              These drive the records list and its search. To change what the certificate prints,
              edit the certificate text further down.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="Student name">
                <Input
                  value={studentName}
                  onChange={(event) => setStudentName(event.target.value)}
                />
              </FormField>
              <FormField label="Father's name">
                <Input
                  value={fatherName}
                  onChange={(event) => setFatherName(event.target.value)}
                />
              </FormField>
              <FormField label="Mother's name">
                <Input
                  value={motherName}
                  onChange={(event) => setMotherName(event.target.value)}
                />
              </FormField>
              <FormField label="Registration number">
                <Input
                  value={registrationNumber}
                  onChange={(event) => setRegistrationNumber(event.target.value)}
                />
              </FormField>
              <FormField label="Date of birth (BS)">
                <NepaliDateField value={dateOfBirthBs} onChange={setDateOfBirthBs} />
              </FormField>
              <FormField label="Conduct">
                <Select value={conduct} onChange={(event) => setConduct(event.target.value)}>
                  {CHARACTER_CERTIFICATE_CONDUCT_RATINGS.map((rating) => (
                    <option key={rating} value={rating}>
                      {rating}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Certificate details</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="Issue no. (register)">
                <Input
                  value={details.issueNo}
                  onChange={(event) => setDetail("issueNo", event.target.value)}
                  placeholder="e.g. GM - 076/77 - 001"
                />
              </FormField>
              <FormField label="Issue date (BS)">
                <NepaliDateField value={issueDateBs} onChange={setIssueDateBs} />
              </FormField>
              <FormField label="Course / programme">
                <Input
                  value={details.programName}
                  onChange={(event) => setDetail("programName", event.target.value)}
                />
              </FormField>
              <FormField label="Course duration">
                <Input
                  value={details.courseDuration}
                  onChange={(event) => setDetail("courseDuration", event.target.value)}
                  placeholder="e.g. three years"
                />
              </FormField>
              <FormField label="Division">
                <Input
                  value={details.division}
                  onChange={(event) => setDetail("division", event.target.value)}
                />
              </FormField>
              <FormField label="Studied from (BS)">
                <Input
                  value={details.studyFromBs}
                  onChange={(event) => setDetail("studyFromBs", event.target.value)}
                />
              </FormField>
              <FormField label="Studied from (AD)">
                <Input
                  value={details.studyFromAd}
                  onChange={(event) => setDetail("studyFromAd", event.target.value)}
                />
              </FormField>
              <FormField label="Final exam year (BS)">
                <Input
                  value={details.examYearBs}
                  onChange={(event) => setDetail("examYearBs", event.target.value)}
                />
              </FormField>
              <FormField label="Final exam year (AD)">
                <Input
                  value={details.examYearAd}
                  onChange={(event) => setDetail("examYearAd", event.target.value)}
                />
              </FormField>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Certificate text</h3>
            <p className="text-xs text-slate-500">
              This is the wording that prints. Placeholders were already filled in when the
              certificate was issued, so correct the words directly here.
            </p>
            <Textarea
              value={body}
              rows={9}
              onChange={(event) => setBody(event.target.value)}
              className="font-mono text-sm"
            />
            {!bodyReady ? (
              <p className="text-xs text-rose-600">
                The certificate text is too short to print (minimum 20 characters).
              </p>
            ) : null}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Record keeping</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Purpose">
                <Input value={purpose} onChange={(event) => setPurpose(event.target.value)} />
              </FormField>
              <FormField label="Remarks">
                <Input value={remarks} onChange={(event) => setRemarks(event.target.value)} />
              </FormField>
            </div>
            <FormField label="Reason for correction (audit log)">
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Registration number was mistyped"
              />
            </FormField>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Save corrections
          </Button>
        </div>
      </div>
    </div>
  );
};
