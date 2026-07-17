import { Pencil, Trash2 } from "lucide-react";
import { Button } from "components/ui/button";
import { cn } from "lib/utils";
import { SESSION_COLORS, SESSION_LABELS } from "./timetableColors";
import {
  isLabSlot,
  nameOf,
  resolveSessionType,
  type MatrixCell,
  type TimetableSlotRow,
} from "./timetableMatrixUtils";

const SlotContent = ({
  slot,
  compact,
}: {
  slot: TimetableSlotRow;
  compact?: boolean;
}) => {
  const type = resolveSessionType(slot);
  const colors = SESSION_COLORS[type] ?? SESSION_COLORS.THEORY;
  const lab = isLabSlot(slot);

  if (type === "BREAK") {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center p-1 text-center",
          colors.text,
        )}
      >
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
            colors.badge,
          )}
        >
          {slot.breakLabel?.trim() || "Break"}
        </span>
      </div>
    );
  }

  if (type === "HOLIDAY") {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center p-1 font-semibold",
          colors.text,
        )}
      >
        HOLIDAY
      </div>
    );
  }

  if (type === "SPORTS") {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center gap-0.5 p-1 text-center",
          colors.text,
        )}
      >
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
            colors.badge,
          )}
        >
          Sports
        </span>
        {slot.subjectId ? (
          <span className={cn("leading-tight", compact ? "text-[10px]" : "text-[11px]")}>
            {nameOf(slot.subjectId)}
          </span>
        ) : null}
        {slot.teacherId ? (
          <span className={cn("leading-tight text-slate-600", compact ? "text-[10px]" : "text-[11px]")}>
            {nameOf(slot.teacherId)}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col gap-0.5 p-1.5 text-left", colors.text)}>
      <div
        className={cn(
          "font-semibold leading-tight",
          compact ? "text-[11px]" : "text-xs",
        )}
      >
        {nameOf(slot.subjectId, type === "EXAM" ? "Exam" : "—")}
      </div>
      {slot.teacherId ? (
        <div
          className={cn(
            "leading-tight text-slate-600",
            compact ? "text-[10px]" : "text-[11px]",
          )}
        >
          {nameOf(slot.teacherId)}
        </div>
      ) : null}
      {slot.room ? (
        <div
          className={cn(
            "leading-tight text-slate-500",
            compact ? "text-[10px]" : "text-[11px]",
          )}
        >
          {lab ? `Lab: ${slot.room}` : slot.room}
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-0.5 pt-0.5">
        <span
          className={cn(
            "rounded px-1 py-px text-[9px] font-semibold uppercase",
            colors.badge,
          )}
        >
          {lab && type === "THEORY" ? "Lab" : SESSION_LABELS[type]}
        </span>
      </div>
    </div>
  );
};

const CellActions = ({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete?: () => void;
}) => (
  <div className="no-print flex justify-end gap-0.5 border-t border-black/5 bg-white/70 px-0.5 py-0.5">
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-6 px-1.5 text-[10px]"
      title="Edit period"
      onClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
    >
      <Pencil className="mr-0.5 h-3 w-3" />
      Edit
    </Button>
    {onDelete ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 px-1.5 text-[10px] text-rose-700 border-rose-200"
        title="Delete period"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    ) : null}
  </div>
);

export const TimetableCellView = ({
  cell,
  onEdit,
  onDelete,
  compact,
}: {
  cell: MatrixCell;
  onEdit?: (slot: TimetableSlotRow) => void;
  onDelete?: (slot: TimetableSlotRow) => void;
  compact?: boolean;
}) => {
  if (cell.kind === "empty") {
    return (
      <div className="min-h-[4.5rem] border border-slate-100 bg-white/60" />
    );
  }

  if (cell.kind === "holiday") {
    const colors = SESSION_COLORS.HOLIDAY_ROW;
    return (
      <div
        className={cn(
          "flex min-h-[4.5rem] items-center justify-center border font-bold tracking-wide",
          colors.bg,
          colors.border,
          colors.text,
        )}
      >
        HOLIDAY
      </div>
    );
  }

  if (cell.kind === "multi") {
    const first = cell.slots[0]!;
    const type = resolveSessionType(first);
    const colors = SESSION_COLORS[type] ?? SESSION_COLORS.THEORY;
    const canEdit = Boolean(onEdit);

    return (
      <div
        className={cn(
          "flex min-h-[4.5rem] w-full flex-col border",
          colors.bg,
          colors.border,
        )}
      >
        <button
          type="button"
          className={cn(
            "flex-1 text-left",
            canEdit && "cursor-pointer hover:bg-black/[0.03]",
          )}
          onClick={() => onEdit?.(first)}
          disabled={!canEdit}
        >
          <SlotContent slot={first} compact={compact} />
          <div className="px-1 pb-1 text-[9px] font-semibold text-amber-700">
            +{cell.slots.length - 1} more
          </div>
        </button>
        {canEdit ? (
          <CellActions
            onEdit={() => onEdit?.(first)}
            onDelete={onDelete ? () => onDelete(first) : undefined}
          />
        ) : null}
      </div>
    );
  }

  const type = resolveSessionType(cell.slot);
  const colors = SESSION_COLORS[type] ?? SESSION_COLORS.THEORY;
  const canEdit = Boolean(onEdit);

  return (
    <div
      className={cn(
        "flex min-h-[4.5rem] w-full flex-col border",
        colors.bg,
        colors.border,
      )}
    >
      <button
        type="button"
        className={cn(
          "flex-1 text-left",
          canEdit && "cursor-pointer hover:bg-black/[0.03]",
        )}
        onClick={() => onEdit?.(cell.slot)}
        disabled={!canEdit}
        title={canEdit ? "Click to edit this period" : undefined}
      >
        <SlotContent slot={cell.slot} compact={compact} />
      </button>
      {canEdit ? (
        <CellActions
          onEdit={() => onEdit?.(cell.slot)}
          onDelete={onDelete ? () => onDelete(cell.slot) : undefined}
        />
      ) : null}
    </div>
  );
};
