import {
  academicCalendarEventInputSchema,
  type AcademicCalendarEventInput,
  type AcademicCalendarEventRecord,
} from "@phit-erp/shared";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import {
  bsToAdString,
  buildDefaultEventInput,
  eventTypeOptions,
  expandBsRangeClient,
  getWeekdayFromBs,
} from "./academicCalendarUtils";

type DateMode = "single" | "range";

interface EventFormDialogProps {
  open: boolean;
  academicYearBs: string;
  dateBs: string;
  editingEvent?: AcademicCalendarEventRecord | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (payload: AcademicCalendarEventInput) => Promise<void>;
}

export const EventFormDialog = ({
  open,
  academicYearBs,
  dateBs,
  editingEvent,
  saving = false,
  onClose,
  onSave,
}: EventFormDialogProps) => {
  const [dateMode, setDateMode] = useState<DateMode>("range");
  const [form, setForm] = useState<AcademicCalendarEventInput>(
    buildDefaultEventInput(academicYearBs, dateBs),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingEvent) {
      const start = editingEvent.startDateBs || editingEvent.dateBs;
      const end = editingEvent.endDateBs || editingEvent.dateBs;
      setDateMode(start !== end ? "range" : "single");
      setForm({
        academicYearBs: editingEvent.academicYearBs,
        startDateBs: start,
        endDateBs: end,
        dateBs: start,
        name: editingEvent.name,
        eventType: editingEvent.eventType,
        reason: editingEvent.reason ?? "",
        status: editingEvent.status ?? "ACTIVE",
      });
      return;
    }
    // Default to date range so Start + End are both visible for vacations/exam weeks
    setDateMode("range");
    setForm(buildDefaultEventInput(academicYearBs, dateBs));
  }, [open, academicYearBs, dateBs, editingEvent]);

  if (!open) return null;

  const startBs = form.startDateBs || form.dateBs || "";
  const endBs =
    dateMode === "single"
      ? startBs
      : form.endDateBs || form.startDateBs || form.dateBs || "";
  const adStart = startBs ? bsToAdString(startBs) : "";
  const adEnd = endBs ? bsToAdString(endBs) : "";
  const weekday = startBs ? getWeekdayFromBs(startBs) : "";
  const totalDays =
    startBs && endBs ? expandBsRangeClient(startBs, endBs).length : 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const payload: AcademicCalendarEventInput = {
      ...form,
      startDateBs: startBs,
      endDateBs: dateMode === "single" ? startBs : endBs,
      dateBs: startBs,
    };

    if (!startBs) {
      setError("Please select a start date (BS).");
      return;
    }
    if (dateMode === "range" && !endBs) {
      setError("Please select an end date (BS).");
      return;
    }
    if (dateMode === "range" && endBs < startBs) {
      setError("End date must be on or after the start date.");
      return;
    }

    const parsed = academicCalendarEventInputSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid event details");
      return;
    }
    await onSave(parsed.data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {editingEvent ? "Edit Event" : "Add Holiday / Event"}
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form className="space-y-4 p-5" onSubmit={handleSubmit}>
          {/* Date mode — always visible at top */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-sm font-medium text-slate-800">
              How many days is this event?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setDateMode("single");
                  setForm((current) => {
                    const start = current.startDateBs || current.dateBs || "";
                    return {
                      ...current,
                      endDateBs: start,
                    };
                  });
                }}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                  dateMode === "single"
                    ? "border-brand-600 bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-600"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                <span className="block">Single Date</span>
                <span className="mt-0.5 block text-xs font-normal text-slate-500">
                  One day only
                </span>
              </button>
              <button
                type="button"
                onClick={() => setDateMode("range")}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                  dateMode === "range"
                    ? "border-brand-600 bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-600"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                <span className="block">Date Range</span>
                <span className="mt-0.5 block text-xs font-normal text-slate-500">
                  Multiple consecutive days
                </span>
              </button>
            </div>
          </div>

          {/* Always show Start Date; End Date when range mode */}
          <div className="space-y-4 rounded-xl border border-brand-100 bg-brand-50/40 p-4">
            <p className="text-sm font-semibold text-slate-900">
              {dateMode === "range"
                ? "Select start and end dates (BS)"
                : "Select date (BS)"}
            </p>

            <FormField label="Start Date (BS) *">
              <NepaliDateField
                value={startBs}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    startDateBs: value,
                    dateBs: value,
                    endDateBs:
                      dateMode === "single"
                        ? value
                        : current.endDateBs && current.endDateBs >= value
                          ? current.endDateBs
                          : value,
                  }))
                }
                placeholder="Click to pick start date"
              />
              {startBs ? (
                <p className="mt-1 text-xs text-slate-500">
                  AD: {adStart}
                  {weekday ? ` · ${weekday}` : ""}
                </p>
              ) : null}
            </FormField>

            {dateMode === "range" ? (
              <FormField label="End Date (BS) *">
                <NepaliDateField
                  value={endBs}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      endDateBs: value,
                    }))
                  }
                  placeholder="Click to pick end date"
                />
                {endBs ? (
                  <p className="mt-1 text-xs text-slate-500">AD: {adEnd}</p>
                ) : null}
              </FormField>
            ) : null}

            {dateMode === "range" && startBs && endBs ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                <div className="font-medium text-slate-900">
                  {startBs} → {endBs}
                </div>
                <div className="mt-0.5 text-slate-600">
                  Total days: <strong>{totalDays}</strong>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Every date in this range will be marked with this event.
                </p>
              </div>
            ) : null}

            {dateMode === "single" ? (
              <p className="text-xs text-slate-500">
                Tip: switch to <strong>Date Range</strong> above for vacations
                or exam weeks (start + end date).
              </p>
            ) : null}
          </div>

          <FormField label="Holiday / Event Name *">
            <Input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="e.g. Summer Vacation"
              required
            />
          </FormField>

          <FormField label="Category *">
            <Select
              value={form.eventType}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  eventType: event.target
                    .value as AcademicCalendarEventInput["eventType"],
                }))
              }
            >
              {eventTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-slate-500">
              Use &quot;Working Day (Override)&quot; to mark a Saturday as a
              working day or special class day.
            </p>
          </FormField>

          <FormField label="Status">
            <Select
              value={form.status ?? "ACTIVE"}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  status: event.target
                    .value as AcademicCalendarEventInput["status"],
                }))
              }
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </FormField>

          <FormField label="Reason / Description">
            <Textarea
              value={form.reason ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              placeholder="Optional details"
              rows={3}
            />
          </FormField>

          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
