import { teacherSchema, type TeacherInput } from "@phit-erp/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
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
    streetAddress: "",
  },
  subjects: [],
  assignedClassIds: [],
  assignedSectionIds: [],
  assignedBatchIds: [],
  assignedYearIds: [],
  basicSalaryNpr: 0,
});

interface TeacherFormProps {
  initialValue?: TeacherInput;
  isEditing?: boolean;
  submitting?: boolean;
  teacherId?: string;
  onSubmit: (value: TeacherInput) => Promise<void>;
  onCancel?: () => void;
}

export const TeacherForm = ({
  initialValue,
  isEditing = false,
  submitting,
  teacherId,
  onSubmit,
  onCancel,
}: TeacherFormProps) => {
  const [form, setForm] = useState<TeacherInput>(
    initialValue ?? createDefaultTeacherValue(),
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const passwordError = validatePortalPassword(password, confirmPassword);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    // HR-only: always send empty assignment arrays (backend may reject non-empty for ACCEPTED/NA)
    const parsed = teacherSchema.safeParse({
      ...form,
      email: form.email.trim(),
      password: password.trim() || undefined,
      subjects: [],
      assignedClassIds: [],
      assignedSectionIds: [],
      assignedBatchIds: [],
      assignedYearIds: [],
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
        <FormField label="Basic Salary (NPR)">
          <NumberInput
            value={form.basicSalaryNpr}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                basicSalaryNpr: event.target.valueAsNumber,
              }))
            }
          />
        </FormField>
      </div>

      <AddressFields
        value={form.address}
        onChange={(address) => setForm((current) => ({ ...current, address }))}
      />

      <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Teaching load is managed separately</p>
        <p className="mt-1">
          Assign subjects under{" "}
          <Link to={assignmentLink} className="font-medium text-blue-700 underline">
            Academics → Subject Assignment
          </Link>
          . This form is for HR / identity fields only.
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
