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

/** Print density: denser = smaller type / padding so more periods fit on one A4 landscape page. */
export type TimetableDensity = "screen" | "compact" | "dense" | "ultra";

const densityCellMinH: Record<TimetableDensity, string> = {
  screen: "min-h-[4.5rem]",
  compact: "min-h-[2.35rem]",
  dense: "min-h-[1.85rem]",
  ultra: "min-h-[1.45rem]",
};

const densityPad: Record<TimetableDensity, string> = {
  screen: "p-1.5",
  compact: "p-0.5 px-1",
  dense: "p-0.5 px-0.5",
  ultra: "p-px px-0.5",
};

const densitySubject: Record<TimetableDensity, string> = {
  screen: "text-xs",
  compact: "text-[10px]",
  dense: "text-[9px]",
  ultra: "text-[8px]",
};

const densityMeta: Record<TimetableDensity, string> = {
  screen: "text-[11px]",
  compact: "text-[9px]",
  dense: "text-[8px]",
  ultra: "text-[7.5px]",
};

const densityBadge: Record<TimetableDensity, string> = {
  screen: "text-[9px] px-1 py-px",
  compact: "text-[8px] px-0.5",
  dense: "text-[7px] px-0.5",
  ultra: "text-[6.5px] px-0.5",
};

const SlotContent = ({
  slot,
  density,
}: {
  slot: TimetableSlotRow;
  density: TimetableDensity;
}) => {
  const type = resolveSessionType(slot);
  const colors = SESSION_COLORS[type] ?? SESSION_COLORS.THEORY;
  const lab = isLabSlot(slot);
  const isPrint = density !== "screen";
  const showBadge = density === "screen" || density === "compact";

  if (type === "BREAK") {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center text-center",
          densityPad[density],
          colors.text,
        )}
      >
        <span
          className={cn(
            "rounded font-bold uppercase leading-tight",
            densityBadge[density],
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
          "flex h-full items-center justify-center font-semibold",
          densityPad[density],
          densitySubject[density],
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
          "flex h-full flex-col items-center justify-center gap-px text-center",
          densityPad[density],
          colors.text,
        )}
      >
        <span
          className={cn(
            "rounded font-bold uppercase leading-tight",
            densityBadge[density],
            colors.badge,
          )}
        >
          Sports
        </span>
        {slot.subjectId ? (
          <span className={cn("leading-tight", densityMeta[density])}>
            {nameOf(slot.subjectId)}
          </span>
        ) : null}
        {slot.teacherId ? (
          <span
            className={cn(
              "leading-tight text-slate-600",
              densityMeta[density],
            )}
          >
            {nameOf(slot.teacherId)}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col text-left",
        densityPad[density],
        isPrint ? "gap-px" : "gap-0.5",
        colors.text,
      )}
    >
      <div
        className={cn(
          "font-semibold leading-tight",
          densitySubject[density],
          isPrint && "line-clamp-2",
        )}
        title={nameOf(slot.subjectId, type === "EXAM" ? "Exam" : "—")}
      >
        {nameOf(slot.subjectId, type === "EXAM" ? "Exam" : "—")}
      </div>
      {slot.teacherId ? (
        <div
          className={cn(
            "leading-tight text-slate-600",
            densityMeta[density],
            isPrint && "line-clamp-1",
          )}
          title={nameOf(slot.teacherId)}
        >
          {nameOf(slot.teacherId)}
        </div>
      ) : null}
      {slot.room ? (
        <div
          className={cn(
            "leading-tight text-slate-500",
            densityMeta[density],
            isPrint && "line-clamp-1",
          )}
          title={lab ? `Lab: ${slot.room}` : slot.room}
        >
          {lab ? `Lab: ${slot.room}` : slot.room}
        </div>
      ) : null}
      {showBadge ? (
        <div
          className={cn(
            "flex flex-wrap gap-0.5",
            isPrint ? "pt-px" : "mt-auto pt-0.5",
          )}
        >
          <span
            className={cn(
              "rounded font-semibold uppercase leading-tight",
              densityBadge[density],
              colors.badge,
            )}
          >
            {lab && type === "THEORY" ? "Lab" : SESSION_LABELS[type]}
          </span>
        </div>
      ) : null}
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
  density: densityProp,
}: {
  cell: MatrixCell;
  onEdit?: (slot: TimetableSlotRow) => void;
  onDelete?: (slot: TimetableSlotRow) => void;
  /** @deprecated Prefer `density`. compact ≈ density "compact". */
  compact?: boolean;
  density?: TimetableDensity;
}) => {
  const density: TimetableDensity =
    densityProp ?? (compact ? "compact" : "screen");
  const minH = densityCellMinH[density];

  if (cell.kind === "empty") {
    return (
      <div
        className={cn(
          "border border-slate-100 bg-white/60",
          minH,
          density === "screen" ? "" : "bg-white",
        )}
      />
    );
  }

  if (cell.kind === "holiday") {
    const colors = SESSION_COLORS.HOLIDAY_ROW;
    return (
      <div
        className={cn(
          "flex items-center justify-center border font-bold tracking-wide",
          minH,
          densitySubject[density],
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
          "flex w-full flex-col border",
          minH,
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
          <SlotContent slot={first} density={density} />
          <div
            className={cn(
              "font-semibold text-amber-700",
              density === "screen" ? "px-1 pb-1 text-[9px]" : "px-0.5 pb-px text-[7px]",
            )}
          >
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
        "flex w-full flex-col border",
        minH,
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
        <SlotContent slot={cell.slot} density={density} />
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
