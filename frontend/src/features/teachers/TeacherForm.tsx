import { teacherSchema, type ClassRecord, type SectionRecord, type SubjectRecord, type TeacherInput } from "@nepal-school-erp/shared";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";

const createDefaultTeacherValue = (): TeacherInput => ({
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
  basicSalaryNpr: 0
});

interface TeacherFormProps {
  initialValue?: TeacherInput;
  classes: ClassRecord[];
  sections: SectionRecord[];
  subjects: SubjectRecord[];
  submitting?: boolean;
  onSubmit: (value: TeacherInput) => Promise<void>;
  onCancel?: () => void;
}

export const TeacherForm = ({ initialValue, classes, sections, subjects, submitting, onSubmit, onCancel }: TeacherFormProps) => {
  const [form, setForm] = useState<TeacherInput>(initialValue ?? createDefaultTeacherValue());

  const filteredSections = useMemo(
    () => sections.filter((section) => form.assignedClassIds.length === 0 || form.assignedClassIds.includes(section.classId)),
    [form.assignedClassIds, sections]
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = teacherSchema.safeParse(form);

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }

    await onSubmit(parsed.data);
    setForm(createDefaultTeacherValue());
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
        <FormField label="Email">
          <Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
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
          <Input type="number" value={form.basicSalaryNpr} onChange={(event) => setForm((current) => ({ ...current, basicSalaryNpr: Number(event.target.value) }))} />
        </FormField>
      </div>

      <AddressFields value={form.address} onChange={(address) => setForm((current) => ({ ...current, address }))} />

      <div className="grid gap-4 md:grid-cols-3">
        <FormField label="Subjects">
          <Select
            multiple
            className="h-36"
            value={form.subjects}
            onChange={(event) => setForm((current) => ({ ...current, subjects: readMultiSelect(event.target.selectedOptions) }))}
          >
            {subjects.map((subject) => (
              <option key={subject._id} value={subject._id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Assigned Classes">
          <Select
            multiple
            className="h-36"
            value={form.assignedClassIds}
            onChange={(event) => setForm((current) => ({ ...current, assignedClassIds: readMultiSelect(event.target.selectedOptions), assignedSectionIds: [] }))}
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
      </div>

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

