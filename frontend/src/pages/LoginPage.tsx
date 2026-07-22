import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, WifiOff } from "lucide-react";
import { loginSchema } from "@phit-erp/shared";
import { toast } from "sonner";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { FormField } from "components/shared/FormField";
import { useAuth } from "features/auth/AuthProvider";
import { useIsDesktopViewport } from "hooks/useIsDesktopViewport";
import { useOnlineStatus } from "hooks/useOnlineStatus";
import { getRoleRedirectPath } from "lib/auth";
import { parseErrorMessage } from "lib/utils";

const LOGIN_BRAND_NAME = "PHIT COLLEGE";
const HERO_TAGLINE =
  "Official Login for Public Himal Institute of Technology.";

const LoginHero = ({ isDesktop }: { isDesktop: boolean }) => {
  if (!isDesktop) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 pt-8 text-center text-white">
        <div className="rounded-2xl bg-white/10 p-2">
          <CollegeLogo variant="light" className="h-12 w-12" />
        </div>
        <h1 className="text-2xl font-semibold">{LOGIN_BRAND_NAME}</h1>
        <p className="max-w-sm text-sm text-brand-50/85">{HERO_TAGLINE}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col justify-between p-12 text-white">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-white/10 p-2">
          <CollegeLogo variant="light" className="h-12 w-12" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{LOGIN_BRAND_NAME}</h1>
        </div>
      </div>

      <div className="max-w-xl">
        <h2 className="text-5xl font-semibold leading-tight">{HERO_TAGLINE}</h2>
      </div>
    </div>
  );
};

/**
 * Login page always shows the form.
 * Does NOT auto-redirect from a leftover cookie (that blocked switching accounts).
 * Does NOT auto-logout on mount (that raced with login and cleared the new session cookie).
 * A successful login overwrites any previous session cookie.
 */
export const LoginPage = () => {
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isDesktop = useIsDesktopViewport();
  const online = useOnlineStatus();
  const { login } = useAuth();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    if (!online) {
      toast.error("No internet connection. Connect to the network to sign in.");
      return;
    }

    const parsed = loginSchema.safeParse({
      email: form.email.trim(),
      password: form.password.trim(),
    });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
      return;
    }

    setSubmitting(true);
    try {
      const result = await login(parsed.data);
      // Prefer server redirectTo so FE/BE stay aligned
      const target = result.redirectTo || getRoleRedirectPath(result.user.role);
      toast.success(t("login"));
      navigate(target ?? "/dashboard/college_admin", { replace: true });
    } catch (error) {
      toast.error(parseErrorMessage(error));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="grid min-h-screen w-full bg-[linear-gradient(135deg,_#0f172a_0%,_#061535_45%,_#d6e2f5_100%)]"
      style={isDesktop ? { gridTemplateColumns: "1.2fr 0.8fr" } : undefined}
    >
      <LoginHero isDesktop={isDesktop} />

      <div
        className="flex items-center justify-center p-6"
        style={isDesktop ? { gridColumnStart: 2 } : undefined}
      >
        <Card className="w-full max-w-md border-white/60 bg-white/95 shadow-2xl">
          <CardHeader>
            <CardTitle>{t("login")}</CardTitle>
          </CardHeader>
          <CardContent>
            {!online && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>
                  You are offline. An internet connection is required to use this
                  application. Only this login page is available until you are
                  back online.
                </p>
              </div>
            )}
            <form className="space-y-4" onSubmit={handleSubmit}>
              <FormField label="Login ID">
                <Input
                  autoComplete="username"
                  type="text"
                  value={form.email}
                  disabled={submitting || !online}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label={t("password")}>
                <div className="relative">
                  <Input
                    autoComplete="current-password"
                    className="pr-10"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    disabled={submitting || !online}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                  />
                  <button
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:text-slate-700"
                    type="button"
                    disabled={submitting || !online}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </FormField>
              <Button className="w-full" type="submit" disabled={submitting || !online}>
                {submitting ? "Signing in…" : !online ? "Waiting for connection…" : t("login")}
              </Button>
            </form>

            {online ? (
              <p className="mt-4 text-sm text-slate-600">
                Parent without an account?{" "}
                <Link className="font-semibold text-brand-700" to="/register">
                  Register with student registration number
                </Link>
              </p>
            ) : null}
            <p className="mt-4 text-center text-xs text-slate-500">
              <Link className="hover:text-brand-700 hover:underline" to="/privacy">
                Privacy Policy
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
