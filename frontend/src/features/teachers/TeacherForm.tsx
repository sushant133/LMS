import {
  teacherSchema,
  type BatchRecord,
  type ClassRecord,
  type SectionRecord,
  type SubjectRecord,
  type TeacherInput,
  type YearRecord
} from "@phit-erp/shared";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PortalLoginFields, validatePortalPassword } from "components/shared/PortalLoginFields";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { useIsCollege } from "hooks/useInstitutionType";
import { filterSectionsByClass, filterSubjectsByYear, filterYearsByBatch, getAcademicLabels } from "lib/academicStructureUtils";

const createDefaultTeacherValue = (isCollege: boolean): TeacherInput => ({
  fullName: "",
  email: "",
  phone: "",
  teacherCode: "",
  qualification: "",
  joinedDateBs: "",
  address: {
    province: "",
    district: "",
    municipality: "",
    ward: "",
    streetAddress: ""
  },
  subjects: [],
  assignedClassIds: [],
  assignedSectionIds: [],
  assignedBatchIds: isCollege ? [] : [],
  assignedYearIds: isCollege ? [] : [],
  basicSalaryNpr: 0
});

interface TeacherFormProps {
  initialValue?: TeacherInput;
  isEditing?: boolean;
  classes?: ClassRecord[];
  sections?: SectionRecord[];
  batches?: BatchRecord[];
  years?: YearRecord[];
  subjects: SubjectRecord[];
  submitting?: boolean;
  onSubmit: (value: TeacherInput) => Promise<void>;
  onCancel?: () => void;
}

export const TeacherForm = ({
  initialValue,
  isEditing = false,
  classes = [],
  sections = [],
  batches = [],
  years = [],
  subjects,
  submitting,
  onSubmit,
  onCancel
}: TeacherFormProps) => {
  const isCollege = useIsCollege();
  const labels = getAcademicLabels(isCollege ? "COLLEGE" : "SCHOOL");
  const [form, setForm] = useState<TeacherInput>(initialValue ?? createDefaultTeacherValue(isCollege));
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const filteredSections = useMemo(
    () => sections.filter((section) => form.assignedClassIds.length === 0 || form.assignedClassIds.includes(section.classId)),
    [form.assignedClassIds, sections]
  );

  const filteredYears = useMemo(
    () =>
      years.filter(
        (year) => form.assignedBatchIds.length === 0 || form.assignedBatchIds.includes(year.batchId)
      ),
    [form.assignedBatchIds, years]
  );

  const filteredSubjects = useMemo(() => {
    if (!isCollege) {
      return subjects;
    }

    if (form.assignedYearIds.length === 0) {
      return subjects.filter((subject) => subject.isActive !== false);
    }

    const scopedSubjects = form.assignedYearIds.flatMap((yearId) => filterSubjectsByYear(subjects, yearId));
    const uniqueSubjects = new Map(scopedSubjects.map((subject) => [subject._id, subject]));
    return Array.from(uniqueSubjects.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [form.assignedYearIds, isCollege, subjects]);

  const subjectLabelById = useMemo(() => {
    const batchNameById = new Map(batches.map((batch) => [batch._id, batch.name]));
    const yearById = new Map(years.map((year) => [year._id, year]));

    return new Map(
      subjects.map((subject) => {
        if (!isCollege) {
          return [subject._id, subject.name] as const;
        }

        const yearLabels = (subject.yearIds ?? [])
          .map((yearId) => {
            const year = yearById.get(yearId);
            if (!year) {
              return null;
            }
            const batchName = batchNameById.get(year.batchId) ?? "Batch";
            return `${batchName} — ${year.name}`;
          })
          .filter(Boolean);

        const scopeLabel = yearLabels.length ? ` (${yearLabels.join(", ")})` : "";
        return [subject._id, `${subject.name} · ${subject.code}${scopeLabel}`] as const;
      })
    );
  }, [batches, isCollege, subjects, years]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const passwordError = validatePortalPassword(password, confirmPassword);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    const parsed = teacherSchema.safeParse({
      ...form,
      email: form.email.trim(),
      password: password.trim() || undefined
    });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }

    await onSubmit(parsed.data);
    setForm(createDefaultTeacherValue(isCollege));
    setPassword("");
    setConfirmPassword("");
  };

  const readMultiSelect = (selectedOptions: HTMLCollectionOf<HTMLOptionElement>): string[] =>
    Array.from(selectedOptions)
      .filter((option) => option.selected)
      .map((option) => option.value);

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <FormField label="Full Name">
          <Input value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
        </FormField>
        <FormField label="Login ID">
          <Input
            placeholder="e.g. teacher01 or name@college.com"
            type="text"
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          />
        </FormField>
        <FormField label="Phone">
          <Input value={form.phone ?? ""} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
        </FormField>
        <FormField label="Teacher Code">
          <Input value={form.teacherCode} onChange={(event) => setForm((current) => ({ ...current, teacherCode: event.target.value }))} />
        </FormField>
        <FormField label="Qualification">
          <Input value={form.qualification} onChange={(event) => setForm((current) => ({ ...current, qualification: event.target.value }))} />
        </FormField>
        <FormField label="Joined Date (BS)">
          <NepaliDateField value={form.joinedDateBs} onChange={(value) => setForm((current) => ({ ...current, joinedDateBs: value }))} />
        </FormField>
        <FormField label="Basic Salary (NPR)">
          <Input type="number" value={form.basicSalaryNpr} onChange={(event) => setForm((current) => ({ ...current, basicSalaryNpr: event.target.valueAsNumber }))} />
        </FormField>
      </div>

      <AddressFields value={form.address} onChange={(address) => setForm((current) => ({ ...current, address }))} />

      <div className="grid gap-4 md:grid-cols-3">
        <FormField label={isCollege ? "Subjects (from Master List)" : "Subjects"}>
          <Select
            multiple
            className="h-36"
            value={form.subjects}
            onChange={(event) => setForm((current) => ({ ...current, subjects: readMultiSelect(event.target.selectedOptions) }))}
          >
            {filteredSubjects.map((subject) => (
              <option key={subject._id} value={subject._id}>
                {subjectLabelById.get(subject._id) ?? subject.name}
              </option>
            ))}
          </Select>
          {isCollege ? (
            <p className="mt-1 text-xs text-slate-500">
              Select assigned batches and years first to narrow subjects from the master curriculum.
            </p>
          ) : null}
        </FormField>

        {isCollege ? (
          <>
            <FormField label={`Assigned ${labels.primaryPlural}`}>
              <Select
                multiple
                className="h-36"
                value={form.assignedBatchIds}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    assignedBatchIds: readMultiSelect(event.target.selectedOptions),
                    assignedYearIds: []
                  }))
                }
              >
                {batches.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label={`Assigned ${labels.secondaryPlural}`}>
              <Select
                multiple
                className="h-36"
                value={form.assignedYearIds}
                onChange={(event) => setForm((current) => ({ ...current, assignedYearIds: readMultiSelect(event.target.selectedOptions) }))}
              >
                {filteredYears.map((year) => (
                  <option key={year._id} value={year._id}>
                    {batches.find((batch) => batch._id === year.batchId)?.name ?? "Batch"} — {year.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        ) : (
          <>
            <FormField label="Assigned Classes">
              <Select
                multiple
                className="h-36"
                value={form.assignedClassIds}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    assignedClassIds: readMultiSelect(event.target.selectedOptions),
                    assignedSectionIds: []
                  }))
                }
              >
                {classes.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Assigned Sections">
              <Select
                multiple
                className="h-36"
                value={form.assignedSectionIds}
                onChange={(event) => setForm((current) => ({ ...current, assignedSectionIds: readMultiSelect(event.target.selectedOptions) }))}
              >
                {filteredSections.map((section) => (
                  <option key={section._id} value={section._id}>
                    {section.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        )}
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