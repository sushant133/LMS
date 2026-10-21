import { CheckCircle2 } from "lucide-react";
import { Button } from "components/ui/button";
import {
  existingStatusLabel,
  type ExistingAcademicRecord,
} from "./existingAcademicRecords";

/**
 * "Already made" list under a create form: subjects for the chosen year that
 * already have a syllabus / session plan, so they are not offered again.
 */
export const AlreadyMadeNotice = ({
  records,
  noun,
  canOpen,
  onOpen,
  lockedText = "Made by another teacher",
}: {
  records: ExistingAcademicRecord[];
  /** "session plan" / "syllabus" */
  noun: string;
  canOpen: (record: ExistingAcademicRecord) => boolean;
  onOpen: (record: ExistingAcademicRecord) => void;
  /** Shown instead of the Open button when it cannot be opened here. */
  lockedText?: string;
}) => {
  if (records.length === 0) return null;
  return (
    <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Already made for this year — not shown in the subject list
      </p>
      <ul className="space-y-1.5">
        {records.map((record) => (
          <li
            key={record._id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm"
          >
            <span className="min-w-0">
              <span className="font-medium text-slate-900">
                {record.subjectName}
              </span>
              {record.subjectCode ? (
                <span className="ml-1 text-xs text-slate-500">
                  ({record.subjectCode})
                </span>
              ) : null}
              <span className="ml-2 text-xs text-slate-500">
                {existingStatusLabel(record.status)}
                {record.teacherName ? ` · ${record.teacherName}` : ""}
              </span>
            </span>
            {canOpen(record) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onOpen(record)}
              >
                Open {noun}
              </Button>
            ) : (
              <span className="text-xs text-slate-500">{lockedText}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
