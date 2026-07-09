import {
  BLOOD_GROUPS,
  DISABILITY_CATEGORIES,
  ETHNICITY_CATEGORIES,
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
  NepaliDateField,
  studentBirthMaxDate,
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
import type { PendingStudentDocument } from "./studentDocumentUtils";

const createDefaultValue = (isCollege: boolean): StudentInput => ({
  fullName: "",
  email: "",
  phone: "",
  admissionNumber: "",
  rollNumber: 1,
  classId: isCollege ? undefined : "",
  sectionId: isCollege ? undefined : "",
  batchId: isCollege ? "" : undefined,
  yearId: isCollege ? "" : undefined,
  admissionDateBs: "",
  dateOfBirthBs: "",
  gender: "Male",
  bloodGroup: "A+",
  disabilityCategory: "None",
  ethnicityCategory: "Other",
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
  remarks: "",
  academicStatus: "ACTIVE",
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

    const parsed = studentSchema.safeParse({
      ...form,
      email: form.email.trim(),
      password: password.trim() || undefined,
      documents,
      photoUrl:
        documents.find((doc) => doc.type === "STUDENT_PHOTOGRAPH")?.url ??
        form.photoUrl,
    });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }

    if (isCollege && (!parsed.data.batchId || !parsed.data.yearId)) {
      toast.error("Batch and year are required");
      return;
    }

    if (!isCollege && (!parsed.data.classId || !parsed.data.sectionId)) {
      toast.error("Class and section are required");
      return;
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
        nextDocuments.find((doc) => doc.type === "STUDENT_PHOTOGRAPH")?.url ??
        current.photoUrl,
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
        <FormField label="Date of Birth (BS)">
          <NepaliDateField
            value={form.dateOfBirthBs}
            onChange={(value) =>
              setForm((current) => ({ ...current, dateOfBirthBs: value }))
            }
            minDate={studentBirthMinDate()}
            maxDate={studentBirthMaxDate()}
          />
        </FormField>
        <FormField label="Gender">
          <Select
            value={form.gender}
            onChange={(event) =>
              setForm((current) => ({ ...current, gender: event.target.value }))
            }
          >
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </Select>
        </FormField>
        <FormField label="Blood Group">
          <Select
            value={form.bloodGroup ?? "A+"}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                bloodGroup: event.target.value as StudentInput["bloodGroup"],
              }))
            }
          >
            {BLOOD_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Disability Category">
          <Select
            value={form.disabilityCategory ?? "None"}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                disabilityCategory: event.target
                  .value as StudentInput["disabilityCategory"],
              }))
            }
          >
            {DISABILITY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Ethnicity">
          <Select
            value={form.ethnicityCategory ?? "Other"}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                ethnicityCategory: event.target
                  .value as StudentInput["ethnicityCategory"],
              }))
            }
          >
            {ETHNICITY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Fees Due (NPR)">
          <NumberInput
            value={form.feesDueNpr}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                feesDueNpr: event.target.valueAsNumber,
              }))
            }
          />
        </FormField>
        <FormField label="Academic Status">
          <Select
            value={form.academicStatus ?? "ACTIVE"}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                academicStatus: event.target
                  .value as StudentInput["academicStatus"],
              }))
            }
          >
            {STUDENT_ACADEMIC_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STUDENT_ACADEMIC_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </FormField>
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
