import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { RegisterInput, SchoolRecord } from "@nepal-school-erp/shared";
import { registerSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { FormField } from "components/shared/FormField";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";

export const RegisterPage = () => {
  const [form, setForm] = useState<RegisterInput>({
    schoolId: "",
    fullName: "",
    email: "",
    password: "",
    phone: "",
    role: "PARENT"
  });
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { register } = useAuth();
  const schoolsQuery = useQuery({
    queryKey: ["public-schools"],
    queryFn: () => unwrap<SchoolRecord[]>(api.get("/schools/public"))
  });

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = registerSchema.safeParse(form);

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }

    try {
      const result = await register(parsed.data);
      toast.success("Registration successful");
      navigate(result.redirectTo);
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(160deg,_#ecfeff_0%,_#f8fafc_50%,_#dcfce7_100%)] p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t("register")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
            <div className="md:col-span-2">
              <FormField label="College">
                <Select value={form.schoolId} onChange={(event) => setForm((current) => ({ ...current, schoolId: event.target.value }))}>
                  <option value="">Select college</option>
                  {(schoolsQuery.data ?? []).map((school) => (
                    <option key={school._id} value={school._id}>
                      {school.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <div className="md:col-span-2">
              <FormField label={t("fullName")}>
                <Input value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
              </FormField>
            </div>
            <FormField label={t("email")}>
              <Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
            </FormField>
            <FormField label="Phone">
              <Input value={form.phone ?? ""} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            </FormField>
            <div className="md:col-span-2">
              <FormField label={t("password")}>
                <Input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
              </FormField>
            </div>
            <div className="md:col-span-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Public self-registration is enabled for parents only. College admins, teachers, and students are created by college administration.
            </div>
            <div className="md:col-span-2 flex items-center justify-between">
              <Link className="text-sm font-medium text-emerald-700" to="/login">
                {t("login")}
              </Link>
              <Button type="submit">{t("register")}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
