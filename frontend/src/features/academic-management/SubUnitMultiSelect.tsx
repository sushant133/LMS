import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import {
  joinSubUnitTitles,
  toggleSubUnitTitle,
} from "./academicManagementUtils";

type SubUnitMultiSelectProps = {
  /** Titles available from syllabus / session plan topics. */
  options: string[];
  /** Currently selected titles (order preserved). */
  value: string[];
  onChange: (next: string[]) => void;
  /** Allow typing a custom sub-unit not in options. */
  allowCustom?: boolean;
  disabled?: boolean;
  placeholder?: string;
  nepali?: boolean;
  /** Optional hint under the control. */
  hint?: string;
};

/**
 * Multi-select for lesson / log book sub-units with optional custom add.
 */
export const SubUnitMultiSelect = ({
  options,
  value,
  onChange,
  allowCustom = true,
  disabled = false,
  placeholder = "Add custom sub-unit…",
  nepali = false,
  hint,
}: SubUnitMultiSelectProps) => {
  const [custom, setCustom] = useState("");
  const selected = value.map((t) => t.trim()).filter(Boolean);

  const optionSet = new Set(options.map((o) => o.toLowerCase()));
  // Show custom selections that are not in the option list
  const extraSelected = selected.filter(
    (t) => !optionSet.has(t.toLowerCase()),
  );
  const allRows = [
    ...options,
    ...extraSelected.filter(
      (t) => !options.some((o) => o.toLowerCase() === t.toLowerCase()),
    ),
  ];

  const addCustom = () => {
    const title = custom.trim();
    if (!title) return;
    onChange(toggleSubUnitTitle(selected, title, true));
    setCustom("");
  };

  return (
    <div className="space-y-2">
      {allRows.length > 0 ? (
        <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
          {allRows.map((title) => {
            const checked = selected.some(
              (t) => t.toLowerCase() === title.toLowerCase(),
            );
            return (
              <label
                key={title}
                className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange(
                      toggleSubUnitTitle(selected, title, e.target.checked),
                    )
                  }
                />
                <span className="text-slate-800">{title}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          No sub-units listed yet — add custom ones below.
        </p>
      )}

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((title) => (
            <span
              key={title}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-900"
            >
              {title}
              {!disabled ? (
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-brand-100"
                  onClick={() =>
                    onChange(toggleSubUnitTitle(selected, title, false))
                  }
                  aria-label={`Remove ${title}`}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {allowCustom && !disabled ? (
        <div className="flex gap-2">
          <Input
            value={custom}
            nepali={nepali}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={addCustom}
            disabled={!custom.trim()}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      ) : null}

      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {selected.length > 0 ? (
        <p className="text-xs text-slate-500">
          Selected: {joinSubUnitTitles(selected)}
        </p>
      ) : null}
    </div>
  );
};
