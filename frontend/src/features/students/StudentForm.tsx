import { BLOOD_GROUPS, DISABILITY_CATEGORIES, ETHNICITY_CATEGORIES, studentSchema, type ClassRecord, type SectionRecord, type StudentInput } from "@nepal-school-erp/shared";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AddressFields } from "components/shared/AddressFields";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";

const createDefaultValue = (): StudentInput => ({
  fullName: "",
  email: "",
  phone: "",
  admissionNumber: "",
  rollNumber: 1,
  classId: "",
  sectionId: "",
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
    streetAddress: ""
  },
  fatherName: "",
  motherName: "",
  guardianName: "",
  guardianPhone: "",
  feesDueNpr: 0,
  remarks: ""
});

interface StudentFormProps {
  initialValue?: StudentInput;
  classes: ClassRecord[];
  sections: SectionRecord[];
  submitting?: boolean;
  onSubmit: (value: StudentInput) => Promise<void>;
  onCancel?: () => void;
}

export const StudentForm = ({ initialValue, classes, sections, submitting, onSubmit, onCancel }: StudentFormProps) => {
  const [form, setForm] = useState<StudentInput>(initialValue ?? createDefaultValue());
  const filteredSections = useMemo(() => sections.filter((section) => section.classId === form.classId), [form.classId, sections]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = studentSchema.safeParse(form);

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }

    await onSubmit(parsed.data);
    setForm(createDefaultValue());
  };

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
        <FormField label="Admission No.">
          <Input value={form.admissionNumber} onChange={(event) => setForm((current) => ({ ...current, admissionNumber: event.target.value }))} />
        </FormField>
        <FormField label="Roll No.">
          <Input type="number" value={form.rollNumber} onChange={(event) => setForm((current) => ({ ...current, rollNumber: Number(event.target.value) }))} />
        </FormField>
        <FormField label="Class">
          <Select value={form.classId} onChange={(event) => setForm((current) => ({ ...current, classId: event.target.value, sectionId: "" }))}>
            <option value="">Select class</option>
            {classes.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Section">
          <Select value={form.sectionId} onChange={(event) => setForm((current) => ({ ...current, sectionId: event.target.value }))}>
            <option value="">Select section</option>
            {filteredSections.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Gender">
          <Select value={form.gender} onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))}>
            {["Male", "Female", "Other"].map((gender) => (
              <option key={gender} value={gender}>
                {gender}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Admission Date (BS)">
          <NepaliDateField value={form.admissionDateBs} onChange={(value) => setForm((current) => ({ ...current, admissionDateBs: value }))} />
        </FormField>
        <FormField label="DOB (BS)">
          <NepaliDateField value={form.dateOfBirthBs} onChange={(value) => setForm((current) => ({ ...current, dateOfBirthBs: value }))} />
        </FormField>
        <FormField label="Blood Group">
          <Select value={form.bloodGroup ?? ""} onChange={(event) => setForm((current) => ({ ...current, bloodGroup: event.target.value as StudentInput["bloodGroup"] }))}>
            {BLOOD_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Disability Category (IEMIS)">
          <Select value={form.disabilityCategory ?? "None"} onChange={(event) => setForm((current) => ({ ...current, disabilityCategory: event.target.value as any }))}>
            {DISABILITY_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Ethnicity / Caste (IEMIS)">
          <Select value={form.ethnicityCategory ?? "Other"} onChange={(event) => setForm((current) => ({ ...current, ethnicityCategory: event.target.value as any }))}>
            {ETHNICITY_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Fees Due (NPR)">
          <Input type="number" value={form.feesDueNpr} onChange={(event) => setForm((current) => ({ ...current, feesDueNpr: Number(event.target.value) }))} />
        </FormField>
      </div>

      <AddressFields value={form.address} onChange={(address) => setForm((current) => ({ ...current, address }))} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <FormField label="Father Name">
          <Input value={form.fatherName} onChange={(event) => setForm((current) => ({ ...current, fatherName: event.target.value }))} />
        </FormField>
        <FormField label="Mother Name">
          <Input value={form.motherName} onChange={(event) => setForm((current) => ({ ...current, motherName: event.target.value }))} />
        </FormField>
        <FormField label="Guardian Name">
          <Input value={form.guardianName} onChange={(event) => setForm((current) => ({ ...current, guardianName: event.target.value }))} />
        </FormField>
        <FormField label="Guardian Phone">
          <Input value={form.guardianPhone} onChange={(event) => setForm((current) => ({ ...current, guardianPhone: event.target.value }))} />
        </FormField>
      </div>

      <FormField label="Remarks">
        <Input value={form.remarks ?? ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
      </FormField>

      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button disabled={submitting} type="submit">
          {submitting ? "Saving..." : "Save Student"}
        </Button>
      </div>

      <p className="text-xs text-slate-500">
        Photo and document uploads (for IEMIS compliance) will be available after saving the student record.
      </p>
    </form>
  );
};

