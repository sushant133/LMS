import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  INSTITUTION_NAME,
  PARENT_RELATIONSHIPS,
  parentSelfRegisterSchema,
  type ParentSelfRegisterInput,
  type SchoolRecord
} from "@phit-erp/shared";
import { toast } from "sonner";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { FormField } from "components/shared/FormField";
import { PortalLoginFields, validatePortalPassword } from "components/shared/PortalLoginFields";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";

interface ParentRegisterResponse {
  pending: boolean;
  message: string;
  redirectTo: string;
  studentName?: string;
  studentRegistrationNumber?: string;
}

const relationshipLabels: Record<(typeof PARENT_RELATIONSHIPS)[number], string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian",
  OTHER: "Other"
};

export const RegisterPage = () => {
  const [form, setForm] = useState<ParentSelfRegisterInput>({
    schoolId: "",
    fullName: "",
    email: "",
    password: "",
    phone: "",
    studentRegistrationNumber: "",
    relationship: "GUARDIAN"
  });
  const [confirmPassword, setConfirmPassword] = useState("");
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);

  const schoolsQuery = useQuery({
    queryKey: ["public-schools"],
    queryFn: () => unwrap<SchoolRecord[]>(api.get("/schools/public"))
  });

  useEffect(() => {
    const institutionSchool = schoolsQuery.data?.[0];
    if (!institutionSchool || form.schoolId) {
      return;
    }

    setForm((current) => ({ ...current, schoolId: institutionSchool._id }));
  }, [form.schoolId, schoolsQuery.data]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const passwordError = validatePortalPassword(form.password, confirmPassword);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    const parsed = parentSelfRegisterSchema.safeParse({
      schoolId: form.schoolId,
      fullName: form.fullName,
      email: form.email,
      password: form.password,
      phone: form.phone,
      studentRegistrationNumber: form.studentRegistrationNumber,
      relationship: form.relationship
    });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }

    setSubmitting(true);
    try {
      const result = await unwrap<ParentRegisterResponse>(api.post("/auth/register", parsed.data));
      toast.success(result.message, {
        description: result.studentName
          ? `Linked student: ${result.studentName} (${result.studentRegistrationNumber ?? ""})`
          : "An administrator will verify your student registration number."
      });
      navigate(result.redirectTo ?? "/login");
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(160deg,_#ecfeff_0%,_#f8fafc_50%,_#d6e2f5_100%)] p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-3 flex items-center gap-3">
            <CollegeLogo className="h-14 w-14" />
            <div>
              <CardTitle>Parent Registration</CardTitle>
              <p className="text-sm font-medium text-brand-800">{INSTITUTION_NAME}</p>
            </div>
          </div>
          <p className="text-sm text-slate-500">
            Register using your child&apos;s student registration (admission) number. Your account will be activated after
            college administrator approval.
          </p>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
            <div className="md:col-span-2">
              <FormField label="Institution">
                <div className="rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3 text-sm font-medium text-brand-950">
                  {schoolsQuery.data?.[0]?.name ?? INSTITUTION_NAME}
                </div>
              </FormField>
            </div>

            <div className="md:col-span-2">
              <FormField label="Student registration number">
                <Input
                  value={form.studentRegistrationNumber}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, studentRegistrationNumber: event.target.value.toUpperCase() }))
                  }
                  placeholder="e.g. PHIT-2026-001"
                />
                <p className="text-xs text-slate-500">
                  Enter your child&apos;s admission / registration number exactly as issued by the college.
                </p>
              </FormField>
            </div>

            <FormField label="Your relationship to student">
              <Select
                value={form.relationship}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    relationship: event.target.value as ParentSelfRegisterInput["relationship"]
                  }))
                }
              >
                {PARENT_RELATIONSHIPS.map((relationship) => (
                  <option key={relationship} value={relationship}>
                    {relationshipLabels[relationship]}
                  </option>
                ))}
              </Select>
            </FormField>

            <div className="md:col-span-2">
              <FormField label={t("fullName")}>
                <Input
                  value={form.fullName}
                  onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                />
              </FormField>
            </div>

            <FormField label="Phone">
              <Input
                value={form.phone ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </FormField>

            <div className="md:col-span-2">
              <PortalLoginFields
                email={form.email}
                password={form.password}
                confirmPassword={confirmPassword}
                onEmailChange={(value) => setForm((current) => ({ ...current, email: value }))}
                onPasswordChange={(value) => setForm((current) => ({ ...current, password: value }))}
                onConfirmPasswordChange={setConfirmPassword}
              />
            </div>

            <div className="md:col-span-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Parents only</p>
              <p className="mt-1">
                After you submit, an administrator will verify your student registration number. You cannot sign in
                until your registration is approved.
              </p>
            </div>

            <div className="md:col-span-2 flex items-center justify-between">
              <Link className="text-sm font-medium text-brand-700" to="/login">
                {t("login")}
              </Link>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit for approval"}
              </Button>
            </div>
          </form>
          <p className="mt-4 text-center text-xs text-slate-500">
            <Link className="hover:text-brand-700 hover:underline" to="/privacy">
              Privacy Policy
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};