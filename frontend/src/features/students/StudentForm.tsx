import {
  BLOOD_GROUPS,
  DISABILITY_CATEGORIES,
  ETHNICITY_CATEGORIES,
  getCastesForReligion,
  RELIGIONS,
  STUDENT_ACADEMIC_STATUSES,
  STUDENT_ACADEMIC_STATUS_LABELS,
  studentSchema,
  type BatchRecord,
  type ClassRecord,
  type SectionRecord,
  type StudentDocument,
  type StudentInput,
  type YearRecord,
} from "@phit-erp/shared";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { FormField } from "components/shared/FormField";
import {
  DualBsAdDateField,
  NepaliDateField,
  studentBirthMaxAd,
  studentBirthMaxDate,
  studentBirthMinAd,
  studentBirthMinDate,
} from "components/shared/NepaliDateField";
import {
  PortalLoginFields,
  validatePortalPassword,
} from "components/shared/PortalLoginFields";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { useIsCollege } from "hooks/useInstitutionType";
import {
  filterSectionsByClass,
  filterYearsByBatch,
} from "lib/academicStructureUtils";
import { StudentDocumentsSection } from "./StudentDocumentsSection";
import {
  isPendingStudentDocument,
  type PendingStudentDocument,
} from "./studentDocumentUtils";

const createDefaultValue = (isCollege: boolean): StudentInput => ({
  fullName: "",
  email: "",
  phone: "",
  admissionNumber: "",
  registrationNumber: "",
  rollNumber: 0,
  classId: isCollege ? undefined : "",
  sectionId: isCollege ? undefined : "",
  batchId: isCollege ? "" : undefined,
  yearId: isCollege ? "" : undefined,
  admissionDateBs: "",
  dateOfBirthBs: "",
  gender: "",
  bloodGroup: undefined,
  disabilityCategory: undefined,
  ethnicityCategory: undefined,
  religion: undefined,
  caste: "",
  address: {
    province: "",
    district: "",
    municipality: "",
    ward: "",
    streetAddress: "",
  },
  fatherName: "",
  fatherPhone: "",
  motherName: "",
  motherPhone: "",
  guardianName: "",
  guardianPhone: "",
  feesDueNpr: 0,
  year1FeeNpr: 0,
  year2FeeNpr: 0,
  year3FeeNpr: 0,
  securityDepositNpr: 0,
  securityDepositWaived: false,
  hasScholarship: false,
  remarks: "",
  academicStatus: "ACTIVE",
  backCount: 0,
});

interface StudentFormProps {
  initialValue?: StudentInput;
  studentId?: string;
  isEditing?: boolean;
  canManageDocuments?: boolean;
  classes?: ClassRecord[];
  sections?: SectionRecord[];
  batches?: BatchRecord[];
  years?: YearRecord[];
  submitting?: boolean;
  uploadedBy?: string;
  uploadedByName?: string;
  onSubmit: (value: StudentInput) => Promise<void>;
  onCancel?: () => void;
  onPendingDocumentsChange?: (pending: PendingStudentDocument[]) => void;
  pendingDocuments?: PendingStudentDocument[];
}

export const StudentForm = ({
  initialValue,
  studentId,
  isEditing = false,
  canManageDocuments = false,
  classes = [],
  sections = [],
  batches = [],
  years = [],
  submitting,
  uploadedBy,
  uploadedByName,
  onSubmit,
  onCancel,
  onPendingDocumentsChange,
  pendingDocuments = [],
}: StudentFormProps) => {
  const isCollege = useIsCollege();
  const [form, setForm] = useState<StudentInput>(
    initialValue ?? createDefaultValue(isCollege),
  );
  const [documents, setDocuments] = useState<StudentDocument[]>(
    initialValue?.documents ?? [],
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const filteredSections = useMemo(
    () => filterSectionsByClass(sections, form.classId ?? ""),
    [form.classId, sections],
  );
  const filteredYears = useMemo(
    () => filterYearsByBatch(years, form.batchId ?? ""),
    [form.batchId, years],
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const passwordError = validatePortalPassword(password, confirmPassword);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    const hasScholarship = Boolean(form.hasScholarship);
    const securityDepositWaived = Boolean(form.securityDepositWaived);
    const year1 = hasScholarship ? 0 : Number(form.year1FeeNpr) || 0;
    const year2 = hasScholarship ? 0 : Number(form.year2FeeNpr) || 0;
    const year3 = hasScholarship ? 0 : Number(form.year3FeeNpr) || 0;
    const yearTotal = year1 + year2 + year3;
    const academicStatus = form.academicStatus ?? "ACTIVE";
    const backCount =
      academicStatus === "PENDING_NOT_PASSED"
        ? Math.max(1, Math.min(50, Math.floor(Number(form.backCount) || 1)))
        : 0;

    const parsed = studentSchema.safeParse({
      ...form,
      email: (form.email ?? "").trim(),
      password: password.trim() || undefined,
      registrationNumber: (form.registrationNumber ?? "").trim(),
      academicStatus,
      backCount,
      hasScholarship,
      securityDepositWaived,
      year1FeeNpr: year1,
      year2FeeNpr: year2,
      year3FeeNpr: year3,
      // Planned deposit only — NOT collected. Held/paid is set only in Accounts.
      securityDepositExpectedNpr: securityDepositWaived
        ? 0
        : Number(form.securityDepositNpr) || 0,
      // Do not send held amount from this form (avoids merging plan into "paid")
      securityDepositNpr: undefined,
      // Total tuition due = sum of year fees when set, else manual total
      feesDueNpr: hasScholarship
        ? 0
        : yearTotal > 0
          ? yearTotal
          : Number(form.feesDueNpr) || 0,
      bloodGroup: form.bloodGroup || undefined,
      disabilityCategory: form.disabilityCategory || undefined,
      ethnicityCategory: form.ethnicityCategory || undefined,
      religion: form.religion || undefined,
      caste: form.caste?.trim() || undefined,
      documents,
      photoUrl:
        documents.find(
          (doc) =>
            doc.type === "STUDENT_PHOTOGRAPH" &&
            !isPendingStudentDocument(doc) &&
            doc.url,
        )?.url ?? form.photoUrl,
    });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }

    // Soft pairing only when one side is chosen
    if (isCollege) {
      const hasBatch = Boolean(parsed.data.batchId);
      const hasYear = Boolean(parsed.data.yearId);
      if (hasBatch !== hasYear) {
        toast.error("Provide both batch and year, or leave both empty");
        return;
      }
    } else {
      const hasClass = Boolean(parsed.data.classId);
      const hasSection = Boolean(parsed.data.sectionId);
      if (hasClass !== hasSection) {
        toast.error("Provide both class and section, or leave both empty");
        return;
      }
    }

    await onSubmit(parsed.data);
    setForm(createDefaultValue(isCollege));
    setDocuments([]);
    setPassword("");
    setConfirmPassword("");
  };

  const handleDocumentsChange = (nextDocuments: StudentDocument[]) => {
    setDocuments(nextDocuments);
    setForm((current) => ({
      ...current,
      documents: nextDocuments,
      photoUrl:
        nextDocuments.find(
          (doc) =>
            doc.type === "STUDENT_PHOTOGRAPH" &&
            !isPendingStudentDocument(doc) &&
            doc.url,
        )?.url ?? current.photoUrl,
    }));
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <FormField label="Full Name">
          <Input
            value={form.fullName}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                fullName: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Phone">
          <Input
            value={form.phone ?? ""}
            onChange={(event) =>
              setForm((current) => ({ ...current, phone: event.target.value }))
            }
          />
        </FormField>
        <FormField label="Admission No.">
          <Input
            value={form.admissionNumber}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                admissionNumber: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Registration No.">
          <Input
            value={form.registrationNumber ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                registrationNumber: event.target.value,
              }))
            }
            placeholder="Optional college registration no."
          />
        </FormField>
        <FormField label="Roll No.">
          <NumberInput
            value={form.rollNumber}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                rollNumber: event.target.valueAsNumber,
              }))
            }
          />
        </FormField>

        {isCollege ? (
          <>
            <FormField label="Batch">
              <Select
                value={form.batchId ?? ""}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    batchId: event.target.value,
                    yearId: "",
                  }))
                }
              >
                <option value="">Select batch</option>
                {batches.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Year">
              <Select
                value={form.yearId ?? ""}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    yearId: event.target.value,
                  }))
                }
              >
                <option value="">Select year</option>
                {filteredYears.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        ) : (
          <>
            <FormField label="Class">
              <Select
                value={form.classId ?? ""}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    classId: event.target.value,
                    sectionId: "",
                  }))
                }
              >
                <option value="">Select class</option>
                {classes.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Section">
              <Select
                value={form.sectionId ?? ""}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    sectionId: event.target.value,
                  }))
                }
              >
                <option value="">Select section</option>
                {filteredSections.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        )}

        <FormField label="Admission Date (BS)">
          <NepaliDateField
            value={form.admissionDateBs}
            onChange={(value) =>
              setForm((current) => ({ ...current, admissionDateBs: value }))
            }
          />
        </FormField>
        <div className="md:col-span-2">
          <FormField label="Date of Birth">
            <DualBsAdDateField
              valueBs={form.dateOfBirthBs}
              onChangeBs={(value) =>
                setForm((current) => ({ ...current, dateOfBirthBs: value }))
              }
              minDate={studentBirthMinDate()}
              maxDate={studentBirthMaxDate()}
              minAd={studentBirthMinAd()}
              maxAd={studentBirthMaxAd()}
              bsPlaceholder="Select date of birth (BS)"
            />
          </FormField>
        </div>
        <FormField label="Gender">
          <Select
            value={form.gender || ""}
            onChange={(event) =>
              setForm((current) => ({ ...current, gender: event.target.value }))
            }
          >
            <option value="">Select gender</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </Select>
        </FormField>
        <FormField label="Blood Group">
          <Select
            value={form.bloodGroup ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                bloodGroup: (event.target.value ||
                  undefined) as StudentInput["bloodGroup"],
              }))
            }
          >
            <option value="">Select blood group</option>
            {BLOOD_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Disability Category">
          <Select
            value={form.disabilityCategory ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                disabilityCategory: (event.target.value ||
                  undefined) as StudentInput["disabilityCategory"],
              }))
            }
          >
            <option value="">Select category</option>
            {DISABILITY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Ethnicity">
          <Select
            value={form.ethnicityCategory ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                ethnicityCategory: (event.target.value ||
                  undefined) as StudentInput["ethnicityCategory"],
              }))
            }
          >
            <option value="">Select ethnicity</option>
            {ETHNICITY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Religion">
          <Select
            value={form.religion ?? ""}
            onChange={(event) => {
              const religion = (event.target.value ||
                undefined) as StudentInput["religion"];
              setForm((current) => {
                const casteOptions = getCastesForReligion(religion);
                const casteStillValid =
                  current.caste && casteOptions.includes(current.caste)
                    ? current.caste
                    : "";
                return {
                  ...current,
                  religion,
                  caste: casteStillValid,
                };
              });
            }}
          >
            <option value="">Select religion</option>
            {RELIGIONS.map((religion) => (
              <option key={religion} value={religion}>
                {religion}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Caste">
          <Select
            value={form.caste ?? ""}
            disabled={!form.religion}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                caste: event.target.value || "",
              }))
            }
          >
            <option value="">
              {form.religion ? "Select caste" : "Select religion first"}
            </option>
            {getCastesForReligion(form.religion).map((caste) => (
              <option key={caste} value={caste}>
                {caste}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Fee type">
          <Select
            value={form.hasScholarship ? "SCHOLARSHIP" : "TOTAL_FEE"}
            onChange={(event) => {
              const isScholarship = event.target.value === "SCHOLARSHIP";
              setForm((current) => ({
                ...current,
                hasScholarship: isScholarship,
                feesDueNpr: isScholarship ? 0 : current.feesDueNpr,
                year1FeeNpr: isScholarship ? 0 : current.year1FeeNpr,
                year2FeeNpr: isScholarship ? 0 : current.year2FeeNpr,
                year3FeeNpr: isScholarship ? 0 : current.year3FeeNpr,
              }));
            }}
          >
            <option value="TOTAL_FEE">Program fees</option>
            <option value="SCHOLARSHIP">Scholarship</option>
          </Select>
        </FormField>
        {form.hasScholarship ? (
          <FormField label="Scholarship">
            <Input value="Scholarship" readOnly className="bg-slate-50 font-medium text-emerald-800" />
          </FormField>
        ) : (
          <>
            <FormField label="1st Year fee (NPR)">
              <NumberInput
                min={0}
                value={form.year1FeeNpr ?? 0}
                onChange={(event) => {
                  const year1FeeNpr = Number.isFinite(event.target.valueAsNumber)
                    ? event.target.valueAsNumber
                    : 0;
                  setForm((current) => {
                    const year2 = Number(current.year2FeeNpr) || 0;
                    const year3 = Number(current.year3FeeNpr) || 0;
                    return {
                      ...current,
                      year1FeeNpr,
                      feesDueNpr: year1FeeNpr + year2 + year3,
                    };
                  });
                }}
                placeholder="1st year amount"
              />
            </FormField>
            <FormField label="2nd Year fee (NPR)">
              <NumberInput
                min={0}
                value={form.year2FeeNpr ?? 0}
                onChange={(event) => {
                  const year2FeeNpr = Number.isFinite(event.target.valueAsNumber)
                    ? event.target.valueAsNumber
                    : 0;
                  setForm((current) => {
                    const year1 = Number(current.year1FeeNpr) || 0;
                    const year3 = Number(current.year3FeeNpr) || 0;
                    return {
                      ...current,
                      year2FeeNpr,
                      feesDueNpr: year1 + year2FeeNpr + year3,
                    };
                  });
                }}
                placeholder="2nd year amount"
              />
            </FormField>
            <FormField label="3rd Year fee (NPR)">
              <NumberInput
                min={0}
                value={form.year3FeeNpr ?? 0}
                onChange={(event) => {
                  const year3FeeNpr = Number.isFinite(event.target.valueAsNumber)
                    ? event.target.valueAsNumber
                    : 0;
                  setForm((current) => {
                    const year1 = Number(current.year1FeeNpr) || 0;
                    const year2 = Number(current.year2FeeNpr) || 0;
                    return {
                      ...current,
                      year3FeeNpr,
                      feesDueNpr: year1 + year2 + year3FeeNpr,
                    };
                  });
                }}
                placeholder="3rd year amount"
              />
            </FormField>
            <FormField label="Total tuition (NPR)">
              <Input
                readOnly
                className="bg-slate-50 font-medium"
                value={String(
                  (Number(form.year1FeeNpr) || 0) +
                    (Number(form.year2FeeNpr) || 0) +
                    (Number(form.year3FeeNpr) || 0) ||
                    form.feesDueNpr ||
                    0,
                )}
              />
            </FormField>
          </>
        )}
        <FormField label="Security deposit to be deposited (NPR)">
          <NumberInput
            min={0}
            disabled={Boolean(form.securityDepositWaived)}
            value={
              form.securityDepositWaived ? 0 : (form.securityDepositNpr ?? 0)
            }
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                securityDepositNpr: Number.isFinite(event.target.valueAsNumber)
                  ? event.target.valueAsNumber
                  : 0,
                securityDepositWaived: false,
              }))
            }
            placeholder="Amount student must deposit (not yet paid)"
          />
        </FormField>
        <div className="md:col-span-2 xl:col-span-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(form.securityDepositWaived)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  securityDepositWaived: event.target.checked,
                  securityDepositNpr: event.target.checked
                    ? 0
                    : current.securityDepositNpr,
                }))
              }
            />
            <span>
              <span className="font-medium text-slate-900">
                Security deposit not taken / cancelled by college
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Use when the college does not collect a security deposit for
                this student. Planned amount is set to zero. Cannot waive if a
                deposit is still held.
              </span>
            </span>
          </label>
        </div>
        <FormField label="Academic Status">
          <Select
            value={form.academicStatus ?? "ACTIVE"}
            onChange={(event) => {
              const next = event.target
                .value as StudentInput["academicStatus"];
              setForm((current) => ({
                ...current,
                academicStatus: next,
                // Show/require backs only for Back status; clear otherwise
                backCount:
                  next === "PENDING_NOT_PASSED"
                    ? Math.max(1, Number(current.backCount) || 1)
                    : 0,
              }));
            }}
          >
            {STUDENT_ACADEMIC_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STUDENT_ACADEMIC_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </FormField>
        {(form.academicStatus ?? "ACTIVE") === "PENDING_NOT_PASSED" ? (
          <FormField label="Number of backs *">
            <NumberInput
              min={1}
              max={50}
              step={1}
              value={form.backCount ?? 1}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  backCount: Math.max(
                    1,
                    Math.min(50, Math.floor(value ?? 1)),
                  ),
                }))
              }
            />
          </FormField>
        ) : null}
      </div>

      <AddressFields
        value={form.address}
        onChange={(address) => setForm((current) => ({ ...current, address }))}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <FormField label="Father Name">
          <Input
            value={form.fatherName}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                fatherName: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Father Phone">
          <Input
            placeholder="e.g. 9801234567"
            value={form.fatherPhone ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                fatherPhone: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Mother Name">
          <Input
            value={form.motherName}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                motherName: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Mother Phone">
          <Input
            placeholder="e.g. 9801234567"
            value={form.motherPhone ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                motherPhone: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Guardian Name">
          <Input
            value={form.guardianName}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                guardianName: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Guardian Phone">
          <Input
            value={form.guardianPhone}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                guardianPhone: event.target.value,
              }))
            }
          />
        </FormField>
      </div>

      <FormField label="Remarks">
        <Input
          value={form.remarks ?? ""}
          onChange={(event) =>
            setForm((current) => ({ ...current, remarks: event.target.value }))
          }
        />
      </FormField>

      {canManageDocuments ? (
        <StudentDocumentsSection
          studentId={studentId}
          documents={documents}
          onChange={handleDocumentsChange}
          canManage={canManageDocuments}
          pendingDocuments={pendingDocuments}
          onPendingChange={onPendingDocumentsChange}
          uploadedBy={uploadedBy}
          uploadedByName={uploadedByName}
          showPendingSummary={false}
        />
      ) : null}

      <PortalLoginFields
        email={form.email}
        password={password}
        confirmPassword={confirmPassword}
        onEmailChange={(email) => setForm((current) => ({ ...current, email }))}
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
        showReset={!isEditing}
        credentialsHint={
          isEditing
            ? "Leave Login ID and password as they are to keep the existing login. Only type a new Login ID and/or password if you want to change access — a new password is emailed only when you set one."
            : undefined
        }
      />

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button disabled={submitting} type="submit">
          {submitting ? "Saving..." : "Save Student"}
        </Button>
      </div>
    </form>
  );
};
