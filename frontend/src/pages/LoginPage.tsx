import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, Eye, EyeOff } from "lucide-react";
import { getDemoLoginEntries, loginSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { FormField } from "components/shared/FormField";
import { useAuth } from "features/auth/AuthProvider";
import { useIsDesktopViewport } from "hooks/useIsDesktopViewport";
import { getRoleRedirectPath } from "lib/auth";
import { parseErrorMessage } from "lib/utils";

const HERO_TAGLINE = "BS calendar, streamlined workflows, and college operations in one place.";
const HERO_SUPPORT =
  "Built for diploma colleges, health assistant training institutes, and higher education programs across Nepal.";

const LoginHero = ({ isDesktop }: { isDesktop: boolean }) => {
  const { t } = useTranslation();

  if (!isDesktop) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 pt-8 text-center text-white">
        <div className="rounded-2xl bg-white/10 p-3">
          <Building2 className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-semibold">{t("appName")}</h1>
        <p className="max-w-sm text-sm text-emerald-50/85">{HERO_TAGLINE}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col justify-between p-12 text-white">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-white/10 p-3">
          <Building2 className="h-7 w-7" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{t("appName")}</h1>
        </div>
      </div>

      <div className="max-w-xl">
        <p className="text-sm uppercase tracking-[0.3em] text-emerald-200">2026 Nepal-ready</p>
        <h2 className="mt-4 text-5xl font-semibold leading-tight">{HERO_TAGLINE}</h2>
        <p className="mt-6 text-lg text-emerald-50/85">{HERO_SUPPORT}</p>
      </div>
    </div>
  );
};

export const LoginPage = () => {
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isDesktop = useIsDesktopViewport();
  const { login, logout, user, loading } = useAuth();
  const [logoutEpoch, setLogoutEpoch] = useState(0);
  const clearedInvalidSession = useRef(false);

  const redirectTarget = user ? getRoleRedirectPath(user.role) : null;

  useEffect(() => {
    // If we hit /login while still holding an authenticated user (common during logout redirect),
    // clear auth state here so the login layout renders in a clean unauthenticated state.
    if (loading || !user || redirectTarget || clearedInvalidSession.current) {
      return;
    }

    clearedInvalidSession.current = true;

    // Ensure we remount this page layout after logout-induced auth changes.
    setLogoutEpoch((e) => e + 1);


    void logout();
  }, [loading, logout, redirectTarget, user]);


  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = loginSchema.safeParse({
      email: form.email.trim(),
      password: form.password.trim()
    });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }

    try {
      const result = await login(parsed.data);
      toast.success(t("login"));
      const target = getRoleRedirectPath(result.user.role);
      navigate(target ?? "/dashboard/college_admin", { replace: true });
    } catch (error) {
      toast.error(parseErrorMessage(error));
    }
  };

  if (user && redirectTarget) {
    return <Navigate to={redirectTarget} replace />;
  }

  return (
    <div
      key={logoutEpoch}
      className="grid min-h-screen w-full bg-[linear-gradient(135deg,_#0f172a_0%,_#064e3b_45%,_#dcfce7_100%)]"
      style={isDesktop ? { gridTemplateColumns: "1.2fr 0.8fr" } : undefined}
    >
      <LoginHero isDesktop={isDesktop} />

      <div className="flex items-center justify-center p-6" style={isDesktop ? { gridColumnStart: 2 } : undefined}>
        <Card className="w-full max-w-md border-white/60 bg-white/95 shadow-2xl">
          <CardHeader>
            <CardTitle>{t("login")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <FormField label="Login ID">
                <Input
                  autoComplete="username"
                  type="text"
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                />
              </FormField>
              <FormField label={t("password")}>
                <div className="relative">
                  <Input
                    autoComplete="current-password"
                    className="pr-10"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  />
                  <button
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:text-slate-700"
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
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