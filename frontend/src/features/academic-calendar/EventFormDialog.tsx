import {
  academicCalendarEventInputSchema,
  type AcademicCalendarEventInput,
  type AcademicCalendarEventRecord
} from "@phit-erp/shared";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { FormField } from "components/shared/FormField";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { bsToAdString, buildDefaultEventInput, eventTypeOptions, getWeekdayFromBs } from "./academicCalendarUtils";

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
  onSave
}: EventFormDialogProps) => {
  const [form, setForm] = useState<AcademicCalendarEventInput>(buildDefaultEventInput(academicYearBs, dateBs));

  useEffect(() => {
    if (!open) return;
    if (editingEvent) {
      setForm({
        academicYearBs: editingEvent.academicYearBs,
        dateBs: editingEvent.dateBs,
        name: editingEvent.name,
        eventType: editingEvent.eventType,
        reason: editingEvent.reason ?? ""
      });
      return;
    }
    setForm(buildDefaultEventInput(academicYearBs, dateBs));
  }, [open, academicYearBs, dateBs, editingEvent]);

  if (!open) return null;

  const adDate = form.dateBs ? bsToAdString(form.dateBs) : "";
  const weekday = form.dateBs ? getWeekdayFromBs(form.dateBs) : "";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = academicCalendarEventInputSchema.safeParse(form);
    if (!parsed.success) return;
    await onSave(parsed.data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {editingEvent ? "Edit Event" : "Add Holiday / Event"}
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form className="space-y-4 p-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="BS Date">
              <Input value={form.dateBs} readOnly className="bg-slate-50" />
            </FormField>
            <FormField label="AD Date">
              <Input value={adDate} readOnly className="bg-slate-50" />
            </FormField>
          </div>

          {weekday ? <p className="text-sm text-slate-600">Day: {weekday}</p> : null}

          <FormField label="Holiday / Event Name">
            <Input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="e.g. Dashain Vacation"
              required
            />
          </FormField>

          <FormField label="Event Type">
            <Select
              value={form.eventType}
              onChange={(event) =>
                setForm((current) => ({ ...current, eventType: event.target.value as AcademicCalendarEventInput["eventType"] }))
              }
            >
              {eventTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Reason / Description">
            <Textarea
              value={form.reason ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Optional details"
              rows={3}
            />
          </FormField>

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