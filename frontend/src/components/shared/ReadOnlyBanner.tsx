import { READ_ONLY_ACCESS_MESSAGE } from "@phit-erp/shared";
import { Eye } from "lucide-react";
import { useReadOnlyAccess } from "hooks/useNormalizedRole";

export const ReadOnlyBanner = () => {
  const { isReadOnly } = useReadOnlyAccess();

  if (!isReadOnly) {
    return null;
  }

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <Eye className="h-4 w-4 shrink-0" />
      <span>
        <strong>College Administrator</strong> — {READ_ONLY_ACCESS_MESSAGE}
      </span>
    </div>
  );
};