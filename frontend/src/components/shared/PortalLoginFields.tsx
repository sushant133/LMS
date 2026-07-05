import { FormField } from "components/shared/FormField";
import { Input } from "components/ui/input";

interface PortalLoginFieldsProps {
  email: string;
  password: string;
  confirmPassword: string;
  onPasswordChange: (password: string) => void;
  onConfirmPasswordChange: (confirmPassword: string) => void;
  onEmailChange?: (email: string) => void;
  showReset?: boolean;
}

export const PortalLoginFields = ({
  email,
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
  onEmailChange,
  showReset = true
}: PortalLoginFieldsProps) => (
  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
    <p className="text-sm font-semibold text-emerald-950">Portal login</p>
    {!showReset ? (
      <p className="mt-1 text-xs text-emerald-800">Leave password blank to keep the current login password.</p>
    ) : null}
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <FormField label="Login ID">
        <Input
          type="text"
          value={email}
          readOnly={!onEmailChange}
          placeholder="Login ID"
          className={onEmailChange ? undefined : "bg-white"}
          onChange={onEmailChange ? (event) => onEmailChange(event.target.value) : undefined}
        />
      </FormField>
      <FormField label={showReset ? "Password" : "New password (optional)"}>
        <Input
          type="password"
          value={password}
          placeholder={showReset ? "Leave blank for default password" : "Enter only to reset password"}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      </FormField>
      {password ? (
        <FormField label="Confirm password">
          <Input
            type="password"
            value={confirmPassword}
            onChange={(event) => onConfirmPasswordChange(event.target.value)}
          />
        </FormField>
      ) : null}
    </div>
  </div>
);

export const validatePortalPassword = (password: string, confirmPassword: string): string | null => {
  if (!password) {
    return null;
  }

  if (password.trim().length < 6) {
    return "Password must be at least 6 characters";
  }

  if (password !== confirmPassword) {
    return "Passwords do not match";
  }

  return null;
};