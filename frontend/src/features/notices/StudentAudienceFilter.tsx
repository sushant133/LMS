import { useQuery } from "@tanstack/react-query";
import {
  EMPTY_STUDENT_AUDIENCE,
  hasStudentAudienceFilter,
  STUDENT_AUDIENCE_STATUS_LABELS,
  STUDENT_AUDIENCE_STATUSES,
  STUDENT_AUDIENCE_YEAR_NAMES,
  type BatchRecord,
  type StudentAudience,
} from "@phit-erp/shared";
import { api, unwrap } from "lib/api";
import { cn } from "lib/utils";

interface StudentAudienceFilterProps {
  value?: StudentAudience;
  onChange: (value: StudentAudience) => void;
}

const toggle = <T,>(list: readonly T[], item: T, checked: boolean): T[] =>
  checked ? [...list, item] : list.filter((entry) => entry !== item);

const Chip = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label
    className={cn(
      "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm",
      checked
        ? "border-brand-300 bg-brand-50 text-brand-900"
        : "border-slate-200 text-slate-700",
    )}
  >
    <input
      type="checkbox"
      className="h-4 w-4 shrink-0"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span>{label}</span>
  </label>
);

/**
 * Narrows the Students audience of a notice / banner by batch, year and
 * status. Nothing ticked in a group means every student for that group.
 */
export const StudentAudienceFilter = ({
  value,
  onChange,
}: StudentAudienceFilterProps) => {
  const audience = value ?? EMPTY_STUDENT_AUDIENCE;
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
  });
  const batches = batchesQuery.data ?? [];

  const update = (patch: Partial<StudentAudience>) =>
    onChange({ ...audience, ...patch });

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">Filter students</p>
        {hasStudentAudienceFilter(audience) ? (
          <button
            type="button"
            className="text-xs font-medium text-brand-700 hover:underline"
            onClick={() => onChange(EMPTY_STUDENT_AUDIENCE)}
          >
            Clear filters
          </button>
        ) : (
          <span className="text-xs text-slate-500">All students</span>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Batch
        </p>
        {batchesQuery.isLoading ? (
          <p className="text-xs text-slate-500">Loading batches…</p>
        ) : batches.length === 0 ? (
          <p className="text-xs text-slate-500">No batches found.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {batches.map((batch) => (
              <Chip
                key={batch._id}
                label={batch.name}
                checked={audience.batchIds.includes(batch._id)}
                onChange={(checked) =>
                  update({ batchIds: toggle(audience.batchIds, batch._id, checked) })
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Year
        </p>
        <div className="flex flex-wrap gap-2">
          {STUDENT_AUDIENCE_YEAR_NAMES.map((yearName) => (
            <Chip
              key={yearName}
              label={yearName}
              checked={audience.yearNames.includes(yearName)}
              onChange={(checked) =>
                update({ yearNames: toggle(audience.yearNames, yearName, checked) })
              }
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Status
        </p>
        <div className="flex flex-wrap gap-2">
          {STUDENT_AUDIENCE_STATUSES.map((status) => (
            <Chip
              key={status}
              label={STUDENT_AUDIENCE_STATUS_LABELS[status]}
              checked={audience.statuses.includes(status)}
              onChange={(checked) =>
                update({ statuses: toggle(audience.statuses, status, checked) })
              }
            />
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Leave a group empty to include everyone in it. Students must match every
        group you tick.
      </p>
    </div>
  );
};

/** Short text for tables, e.g. "Batch 2081 · 2nd Year · Back". */
export const formatStudentAudience = (
  audience: StudentAudience | undefined,
  batchNameById: Map<string, string>,
): string | null => {
  if (!hasStudentAudienceFilter(audience)) return null;
  const parts = [
    audience!.batchIds.map((id) => batchNameById.get(id) ?? "Batch").join(", "),
    audience!.yearNames.join(", "),
    audience!.statuses.map((status) => STUDENT_AUDIENCE_STATUS_LABELS[status]).join(", "),
  ].filter(Boolean);
  return parts.join(" · ");
};
