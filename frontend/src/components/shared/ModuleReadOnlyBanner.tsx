import { Lock } from "lucide-react";
import { MODULE_ACCESS_DISABLED_MESSAGE } from "@phit-erp/shared";

interface ModuleReadOnlyBannerProps {
  show: boolean;
  message?: string;
  className?: string;
}

/** Shown when the Administrator has set a module to read-only for this user. */
export const ModuleReadOnlyBanner = ({
  show,
  message = MODULE_ACCESS_DISABLED_MESSAGE,
  className = "",
}: ModuleReadOnlyBannerProps) => {
  if (!show) return null;
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 ${className}`}
      role="status"
    >
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <div>
        <p className="font-semibold">Read-only access</p>
        <p className="text-amber-900/90">{message}</p>
      </div>
    </div>
  );
};
