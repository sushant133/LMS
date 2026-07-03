import { useEffect, useLayoutEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { School } from "lucide-react";
import { getDemoLoginEntries, loginSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { FormField } from "components/shared/FormField";
import { useAuth } from "features/auth/AuthProvider";
import { roleRedirectMap } from "lib/auth";
import { resetAppShell } from "lib/resetAppShell";
import { parseErrorMessage } from "lib/utils";

const LoginHero = () => {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex flex-col items-center gap-3 px-6 pt-8 text-center text-white lg:hidden">
        <div className="rounded-2xl bg-white/10 p-3">
          <School className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-semibold">{t("appName")}</h1>
        <p className="max-w-sm text-sm text-emerald-50/85">
          BS calendar, streamlined workflows, and school operations in one place.
        </p>
      </div>

      <div className="hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-white/10 p-3">
            <School className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t("appName")}</h1>
          </div>
        </div>

        <div className="max-w-xl">
          <p className="text-sm uppercase tracking-[0.3em] text-emerald-200">2026 Nepal-ready</p>
          <h2 className="mt-4 text-5xl font-semibold leading-tight">
            BS calendar, streamlined workflows, and school operations in one place.
          </h2>
          <p className="mt-6 text-lg text-emerald-50/85">
            Built for private schools, community schools, government-aided institutions, and +2 colleges across Nepal.
          </p>
        </div>
      </div>
    </>
  );
};

export const LoginPage = () => {
  const [form, setForm] = useState({ email: "", password: "" });
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { login, user, loading, authEpoch } = useAuth();

  useLayoutEffect(() => {
    resetAppShell();
  }, []);

  useLayoutEffect(() => {
    resetAppShell();
  }, [authEpoch]);

  useEffect(() => {
    if (!loading && user) {
      navigate(roleRedirectMap[user.role], { replace: true });
    }
  }, [loading, navigate, user]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = loginSchema.safeParse(form);

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }

    try {
      const result = await login(parsed.data);
      toast.success(t("login"));
      navigate(result.redirectTo);
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  if (!loading && user) {
    return <Navigate to={roleRedirectMap[user.role]} replace />;
  }

  return (
    <div className="grid min-h-screen w-full bg-[linear-gradient(135deg,_#0f172a_0%,_#064e3b_45%,_#dcfce7_100%)] lg:grid-cols-[1.2fr_0.8fr]">
      <LoginHero />

      <div className="flex items-center justify-center p-6 lg:col-start-2">
        <Card className="w-full max-w-md border-white/60 bg-white/95 shadow-2xl">
          <CardHeader>
            <CardTitle>{t("login")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <FormField label={t("email")}>
                <Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
              </FormField>
              <FormField label={t("password")}>
                <Input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
              </FormField>
              <Button className="w-full" type="submit">
                {t("login")}
              </Button>
            </form>

            <div className="mt-4 space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-900">
              <p className="font-semibold text-emerald-950">Demo login credentials</p>
              {getDemoLoginEntries().map((entry) => (
                <p key={entry.email}>
                  {entry.label}: <span className="font-medium">{entry.email}</span> / <span className="font-medium">{entry.password}</span>
                </p>
              ))}
            </div>
            <p className="mt-4 text-sm text-slate-600">
              No account?{" "}
              <Link className="font-semibold text-emerald-700" to="/register">
                {t("register")}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};