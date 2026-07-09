import type { AcademicCalendarEventRecord } from "@phit-erp/shared";
import { Pencil, Trash2, X } from "lucide-react";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { getEventTypeColor, getEventTypeLabel } from "./academicCalendarUtils";

interface EventDetailDialogProps {
  open: boolean;
  dateBs: string;
  events: AcademicCalendarEventRecord[];
  canManage: boolean;
  deleting?: boolean;
  onClose: () => void;
  onEdit: (event: AcademicCalendarEventRecord) => void;
  onDelete: (event: AcademicCalendarEventRecord) => void;
  onAdd: () => void;
}

export const EventDetailDialog = ({
  open,
  dateBs,
  events,
  canManage,
  deleting = false,
  onClose,
  onEdit,
  onDelete,
  onAdd,
}: EventDetailDialogProps) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Events on {dateBs}
            </h2>
            <p className="text-sm text-slate-500">
              {events.length} event{events.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3 p-5">
          {events.length === 0 ? (
            <p className="text-sm text-slate-600">
              No events scheduled for this date.
            </p>
          ) : (
            events.map((event) => (
              <div
                key={event._id}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <h3 className="font-semibold text-slate-900">
                      {event.name}
                    </h3>
                    <Badge
                      style={{
                        backgroundColor: `${getEventTypeColor(event.eventType)}22`,
                        color: getEventTypeColor(event.eventType),
                        borderColor: `${getEventTypeColor(event.eventType)}55`,
                      }}
                    >
                      {getEventTypeLabel(event.eventType)}
                    </Badge>
                  </div>
                  {canManage ? (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(event)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={deleting}
                        onClick={() => onDelete(event)}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  ) : null}
                </div>
                <dl className="mt-3 grid gap-1 text-sm text-slate-600">
                  <div>AD Date: {event.dateAd}</div>
                  <div>Day: {event.dayOfWeek}</div>
                  {event.reason ? <div>Reason: {event.reason}</div> : null}
                </dl>
              </div>
            ))
          )}

          {canManage ? (
            <Button type="button" className="w-full" onClick={onAdd}>
              Add Event
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
