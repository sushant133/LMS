import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_TEACHER_DESIGNATION,
  TEACHER_PAYMENT_TYPE_HELP,
  TEACHER_PAYMENT_TYPE_LABELS,
  TEACHER_PAYMENT_TYPES,
  teacherSchema,
  type SchoolSettingsRecord,
  type SubjectRecord,
  type TeacherInput,
  type TeacherPaymentType,
} from "@phit-erp/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import {
  PortalLoginFields,
  validatePortalPassword,
} from "components/shared/PortalLoginFields";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { HrDocumentsSection } from "features/hr-documents/HrDocumentsSection";
import type { HrDocument } from "@phit-erp/shared";
import { api, resolveApiUrl, resolveMediaUrl, unwrap } from "lib/api";

const createDefaultTeacherValue = (): TeacherInput => ({
  fullName: "",
  email: "",
  phone: "",
  teacherCode: "",
  qualification: "",
  designation: DEFAULT_TEACHER_DESIGNATION,
  joinedDateBs: "",
  address: {
    province: "",
    district: "",
    municipality: "",
    ward: "",
    streetAddress: "",
  },
  subjects: [],
  assignedClassIds: [],
  assignedSectionIds: [],
  assignedBatchIds: [],
  assignedYearIds: [],
  basicSalaryNpr: 0,
  paymentType: "MONTHLY",
  periodRateNpr: 0,
  tenders: [],
  photoUrl: "",
});

interface TeacherFormProps {
  initialValue?: TeacherInput;
  isEditing?: boolean;
  submitting?: boolean;
  teacherId?: string;
  documents?: HrDocument[];
  canManageDocuments?: boolean;
  onDocumentsChange?: (documents: HrDocument[]) => void;
  onSubmit: (value: TeacherInput) => Promise<void>;
  onCancel?: () => void;
}

export const TeacherForm = ({
  initialValue,
  isEditing = false,
  submitting,
  teacherId,
  documents = [],
  canManageDocuments = false,
  onDocumentsChange,
  onSubmit,
  onCancel,
}: TeacherFormProps) => {
  const [form, setForm] = useState<TeacherInput>(
    initialValue ?? createDefaultTeacherValue(),
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const paymentType = (form.paymentType ?? "MONTHLY") as TeacherPaymentType;

  const subjectsQuery = useQuery({
    queryKey: ["academics-subjects"],
    queryFn: () => unwrap<SubjectRecord[]>(api.get("/academics/subjects")),
  });
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => unwrap<SchoolSettingsRecord>(api.get("/settings")),
  });
  const subjects = (subjectsQuery.data ?? []).filter(
    (subject) => subject.isActive !== false,
  );
  const currentAcademicYear =
    settingsQuery.data?.academicYearBs?.trim() || "";

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file (JPG, PNG, or WEBP)");
      event.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Photo must be less than 2 MB");
      event.target.value = "";
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("photo", file);

    try {
      const response = await fetch(resolveApiUrl("/uploads/teachers/photo"), {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? "Upload failed");
      }
      const body = await response.json();
      const photoUrl = (body.data?.url as string | undefined) ?? "";
      if (!photoUrl) throw new Error("Upload response missing file URL");

      setForm((current) => ({ ...current, photoUrl }));

      // Persist immediately when editing an existing teacher (no full form save needed)
      if (teacherId) {
        await unwrap(api.put(`/teachers/${teacherId}/photo`, { photoUrl }));
        toast.success("Photo uploaded and saved");
      } else {
        toast.success("Photo uploaded — click Save Teacher to keep it");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const passwordError = validatePortalPassword(password, confirmPassword);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    if (paymentType === "TENDER") {
      const rows = form.tenders ?? [];
      if (rows.some((tender) => !tender.subjectId)) {
        toast.error("Select a subject for every tender row");
        return;
      }
      if (rows.some((tender) => !tender.academicYearBs?.trim())) {
        toast.error("Enter the academic year for every subject tender");
        return;
      }
    }

    // HR-only: always send empty assignment arrays (backend may reject non-empty for ACCEPTED/NA)
    const parsed = teacherSchema.safeParse({
      ...form,
      email: form.email.trim(),
      designation: form.designation?.trim() || DEFAULT_TEACHER_DESIGNATION,
      password: password.trim() || undefined,
      subjects: [],
      assignedClassIds: [],
      assignedSectionIds: [],
      assignedBatchIds: [],
      assignedYearIds: [],
      paymentType,
      periodRateNpr: paymentType === "PERIOD" ? form.periodRateNpr ?? 0 : 0,
      basicSalaryNpr: paymentType === "MONTHLY" ? form.basicSalaryNpr : form.basicSalaryNpr ?? 0,
      tenders:
        paymentType === "TENDER"
          ? (form.tenders ?? []).filter((tender) => tender.subjectId)
          : [],
    });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }

    await onSubmit(parsed.data);
    setForm(createDefaultTeacherValue());
    setPassword("");
    setConfirmPassword("");
  };

  const assignmentLink = teacherId
    ? `/academics/subject-assignments?teacherId=${teacherId}`
    : "/academics/subject-assignments";

  const photoPreview = resolveMediaUrl(form.photoUrl) ?? "";

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
        <FormField label="Login ID">
          <Input
            placeholder="e.g. teacher01 or name@college.com"
            type="text"
            value={form.email}
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
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
        <FormField label="Teacher Code">
          <Input
            value={form.teacherCode}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                teacherCode: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Designation">
          <Input
            placeholder={DEFAULT_TEACHER_DESIGNATION}
            value={form.designation ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                designation: event.target.value,
              }))
            }
          />
          <p className="mt-1 text-xs text-slate-500">
            Leave blank to use &quot;{DEFAULT_TEACHER_DESIGNATION}&quot;.
          </p>
        </FormField>
        <FormField label="Qualification">
          <Input
            value={form.qualification}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                qualification: event.target.value,
              }))
            }
          />
        </FormField>
        <FormField label="Joined Date (BS)">
          <NepaliDateField
            value={form.joinedDateBs}
            onChange={(value) =>
              setForm((current) => ({ ...current, joinedDateBs: value }))
            }
          />
        </FormField>
        <FormField label="Pay type">
          <Select
            value={paymentType}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                paymentType: event.target.value as TeacherPaymentType,
              }))
            }
          >
            {TEACHER_PAYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {TEACHER_PAYMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-slate-500">
            {TEACHER_PAYMENT_TYPE_HELP[paymentType]}
          </p>
        </FormField>
        {paymentType === "MONTHLY" ? (
          <FormField label="Monthly salary (NPR)">
            <NumberInput
              min={0}
              value={form.basicSalaryNpr}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  basicSalaryNpr: value ?? 0,
                }))
              }
            />
          </FormField>
        ) : null}
        {paymentType === "PERIOD" ? (
          <FormField label="Rate per period (NPR)">
            <NumberInput
              min={0}
              value={form.periodRateNpr ?? 0}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  periodRateNpr: value ?? 0,
                }))
              }
            />
            <p className="mt-1 text-xs text-slate-500">
              Salary sheet pays this rate × periods taught (from the log book).
            </p>
          </FormField>
        ) : null}
        <FormField label="Profile photo">
          <div className="space-y-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <Upload className="h-4 w-4" />
              {isUploading ? "Uploading..." : "Upload photo"}
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                className="hidden"
                disabled={isUploading}
                onChange={(event) => void handlePhotoUpload(event)}
              />
            </label>
            {photoPreview ? (
              <img
                src={photoPreview}
                alt="Teacher preview"
                className="h-20 w-20 rounded-lg object-cover"
              />
            ) : null}
          </div>
        </FormField>
      </div>

      {paymentType === "TENDER" ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium text-slate-900">Subject tenders</p>
              <p className="text-xs text-slate-500">
                Award one or more subjects at a fixed contract amount. The salary
                sheet pays the share of syllabus completed, minus amounts already
                paid this academic year.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (!currentAcademicYear) {
                  toast.error(
                    "Set the academic year in Settings before adding a subject tender",
                  );
                  return;
                }
                setForm((current) => ({
                  ...current,
                  tenders: [
                    ...(current.tenders ?? []),
                    {
                      subjectId: "",
                      academicYearBs: currentAcademicYear,
                      tenderAmountNpr: 0,
                      notes: "",
                    },
                  ],
                }));
              }}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add subject
            </Button>
          </div>
          {(form.tenders ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">
              No subject tenders yet. Add the subject and contract amount.
            </p>
          ) : (
            <div className="space-y-3">
              {(form.tenders ?? []).map((tender, index) => (
                <div
                  key={tender._id || `tender-${index}`}
                  className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-12"
                >
                  <div className="md:col-span-4">
                    <FormField label="Subject">
                      <Select
                        value={tender.subjectId}
                        onChange={(event) =>
                          setForm((current) => {
                            const next = [...(current.tenders ?? [])];
                            next[index] = {
                              ...next[index]!,
                              subjectId: event.target.value,
                            };
                            return { ...current, tenders: next };
                          })
                        }
                      >
                        <option value="">Select subject</option>
                        {subjects.map((subject) => (
                          <option key={subject._id} value={subject._id}>
                            {subject.name}
                            {subject.code ? ` (${subject.code})` : ""}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  </div>
                  <div className="md:col-span-3">
                    <FormField label="Academic year (BS)">
                      <Input
                        placeholder="2082/2083"
                        value={tender.academicYearBs}
                        onChange={(event) =>
                          setForm((current) => {
                            const next = [...(current.tenders ?? [])];
                            next[index] = {
                              ...next[index]!,
                              academicYearBs: event.target.value,
                            };
                            return { ...current, tenders: next };
                          })
                        }
                      />
                    </FormField>
                  </div>
                  <div className="md:col-span-3">
                    <FormField label="Tender amount (NPR)">
                      <NumberInput
                        min={0}
                        value={tender.tenderAmountNpr}
                        onValueChange={(value) =>
                          setForm((current) => {
                            const next = [...(current.tenders ?? [])];
                            next[index] = {
                              ...next[index]!,
                              tenderAmountNpr: value ?? 0,
                            };
                            return { ...current, tenders: next };
                          })
                        }
                      />
                    </FormField>
                  </div>
                  <div className="flex items-end md:col-span-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full text-rose-700"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          tenders: (current.tenders ?? []).filter(
                            (_, rowIndex) => rowIndex !== index,
                          ),
                        }))
                      }
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                  <div className="md:col-span-12">
                    <FormField label="Notes (optional)">
                      <Input
                        value={tender.notes ?? ""}
                        onChange={(event) =>
                          setForm((current) => {
                            const next = [...(current.tenders ?? [])];
                            next[index] = {
                              ...next[index]!,
                              notes: event.target.value,
                            };
                            return { ...current, tenders: next };
                          })
                        }
                      />
                    </FormField>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <AddressFields
        value={form.address}
        onChange={(address) => setForm((current) => ({ ...current, address }))}
      />

      {canManageDocuments && onDocumentsChange && teacherId ? (
        <HrDocumentsSection
          entityKind="teacher"
          entityId={teacherId}
          documents={documents}
          onChange={onDocumentsChange}
          canManage={canManageDocuments}
          title="Teacher documents"
          description="Upload CV, degree, certificates and other teacher documents (PDF, JPG, PNG, DOC — max 600 KB each). You can also manage these from the teacher profile."
        />
      ) : canManageDocuments && !teacherId ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          After creating this teacher, open their <strong>Profile</strong> (or Edit)
          to upload photo, CV, degree, certificates, and other documents.
        </div>
      ) : null}

      <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-900">
          This form is login / HR only (one account per teacher)
        </p>
        <p className="mt-1">
          Do <strong>not</strong> create another teacher account for a second subject.
          After save, open the teacher list → <strong>Assignments</strong> to attach
          unlimited subjects, years, batches, and laboratories to this same login.{" "}
          {isEditing && teacherId ? (
            <>
              Or go directly to{" "}
              <Link to={assignmentLink} className="font-medium text-blue-700 underline">
                Subject Assignment for this teacher
              </Link>
              .
            </>
          ) : (
            <>
              Subject matrix:{" "}
              <Link to={assignmentLink} className="font-medium text-blue-700 underline">
                Academics → Subject Assignment
              </Link>
              .
            </>
          )}
        </p>
      </div>

      <PortalLoginFields
        email={form.email}
        password={password}
        confirmPassword={confirmPassword}
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
        showReset={!isEditing}
      />

      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button disabled={submitting} type="submit">
          {submitting ? "Saving..." : "Save Teacher"}
        </Button>
      </div>
    </form>
  );
};
