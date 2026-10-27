import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn, parseErrorMessage } from "lib/utils";

const GENERAL_FACULTY_KEY = "faculty:general";
const NEW_FACULTY = "__new__";

/** Stored faculty text for a tree node ("" for General / All Programs). */
export const facultyValueOf = (key: string, label: string): string =>
  key === GENERAL_FACULTY_KEY ? "" : label;

const refreshAcademicData = () =>
  Promise.all(
    ["academic-management", "academics", "subject-assignments"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );

/** Three-dot button with a small menu; closes on outside click or Escape. */
export const TreeRowMenu = ({
  label,
  items,
}: {
  label: string;
  items: Array<{ label: string; onSelect: () => void; danger?: boolean }>;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={cn(
                "block w-full px-3 py-2 text-left text-sm",
                item.danger
                  ? "text-red-600 hover:bg-red-50"
                  : "text-slate-700 hover:bg-slate-50",
              )}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

/** Inline rename of a Faculty / Program heading. */
export const FacultyRenameForm = ({
  facultyValue,
  initialLabel,
  onClose,
  className,
}: {
  facultyValue: string;
  initialLabel: string;
  onClose: () => void;
  className?: string;
}) => {
  const [name, setName] = useState(facultyValue ? initialLabel : "");
  const mutation = useMutation({
    mutationFn: (to: string) =>
      unwrap(api.post("/academic-management/faculties/rename", { from: facultyValue, to })),
    onSuccess: async () => {
      toast.success("Faculty / program renamed");
      await refreshAcademicData();
      onClose();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  return (
    <form
      className={cn("flex flex-wrap items-center gap-2 px-4 py-2.5", className)}
      onSubmit={(event) => {
        event.preventDefault();
        const to = name.trim();
        if (!to) {
          toast.error("Enter a faculty / program name");
          return;
        }
        mutation.mutate(to);
      }}
    >
      <Input
        autoFocus
        value={name}
        aria-label="Faculty / program name"
        placeholder="Faculty / program name"
        className="h-9 min-w-0 flex-1"
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={mutation.isPending}>
        {mutation.isPending ? "Saving…" : "Save"}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onClose}>
        Cancel
      </Button>
    </form>
  );
};

/** Move a curriculum subject to another Faculty / Program (or a new one). */
export const SubjectMoveForm = ({
  subjectName,
  subjectIds,
  fromFaculty,
  faculties,
  onClose,
  className,
}: {
  subjectName: string;
  subjectIds: string[];
  fromFaculty: string;
  /** Other faculties to move to: stored value + display label. */
  faculties: Array<{ value: string; label: string }>;
  onClose: () => void;
  className?: string;
}) => {
  const [target, setTarget] = useState(faculties[0]?.value ?? NEW_FACULTY);
  const [newName, setNewName] = useState("");
  const mutation = useMutation({
    mutationFn: (toFaculty: string) =>
      unwrap(
        api.post("/academic-management/faculties/move-subject", {
          subjectIds,
          fromFaculty,
          toFaculty,
        }),
      ),
    onSuccess: async (_data, toFaculty) => {
      toast.success(`${subjectName} moved to ${toFaculty}`);
      await refreshAcademicData();
      onClose();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  return (
    <form
      className={cn("space-y-2 rounded-xl border border-slate-200 bg-white p-3", className)}
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        const toFaculty = (target === NEW_FACULTY ? newName : target).trim();
        if (!toFaculty) {
          toast.error("Choose or enter a faculty / program");
          return;
        }
        mutation.mutate(toFaculty);
      }}
    >
      <p className="text-xs font-medium text-slate-600">
        Move <span className="text-slate-900">{subjectName}</span> to
      </p>
      <Select
        aria-label="Move to faculty / program"
        value={target}
        onChange={(event) => setTarget(event.target.value)}
      >
        {faculties.map((faculty) => (
          <option key={faculty.value} value={faculty.value}>
            {faculty.label}
          </option>
        ))}
        <option value={NEW_FACULTY}>New faculty / program…</option>
      </Select>
      {target === NEW_FACULTY ? (
        <Input
          autoFocus
          value={newName}
          aria-label="New faculty / program name"
          placeholder="New faculty / program name"
          onChange={(event) => setNewName(event.target.value)}
        />
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? "Moving…" : "Move"}
        </Button>
      </div>
    </form>
  );
};

const DELETE_WORD = "delete";

/**
 * Delete a whole Faculty / Program, or one subject in it: its syllabi, session
 * plans, lesson plans and log books. Typing "delete" is required to confirm.
 */
export const FacultyDeleteForm = ({
  facultyValue,
  facultyLabel,
  subjectName,
  subjectIds,
  onClose,
  className,
}: {
  facultyValue: string;
  facultyLabel: string;
  /** With subjectIds: delete just this subject inside the faculty. */
  subjectName?: string;
  subjectIds?: string[];
  onClose: () => void;
  className?: string;
}) => {
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim().toLowerCase() === DELETE_WORD;
  const target = subjectName ? `${subjectName} (${facultyLabel})` : facultyLabel;
  const mutation = useMutation({
    mutationFn: () =>
      unwrap<{ deleted: number; assignmentsLeft: number }>(
        api.post("/academic-management/faculties/delete", {
          faculty: facultyValue,
          ...(subjectIds ? { subjectIds } : {}),
        }),
      ),
    onSuccess: async (data) => {
      toast.success(
        data.assignmentsLeft > 0
          ? `${target} deleted. Teacher assignments are kept; change them in Subject Assignments.`
          : `${target} deleted`,
      );
      await refreshAcademicData();
      onClose();
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  return (
    <form
      className={cn("space-y-2 rounded-xl border border-red-200 bg-red-50/60 p-3", className)}
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmed) mutation.mutate();
      }}
    >
      <p className="text-xs font-medium text-red-700">
        Delete <span className="font-semibold">{target}</span>?
      </p>
      <p className="text-xs text-slate-600">
        All its syllabi, session plans, lesson plans and log books will be removed.
        Type <span className="font-semibold text-slate-900">{DELETE_WORD}</span> to confirm.
      </p>
      <Input
        autoFocus
        value={typed}
        aria-label={`Type ${DELETE_WORD} to confirm`}
        placeholder={DELETE_WORD}
        className="h-9"
        onChange={(event) => setTyped(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!confirmed || mutation.isPending}
          className="bg-red-600 text-white hover:bg-red-700"
        >
          {mutation.isPending ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </form>
  );
};

/** Faculty / Program names already in use (tree + subject assignments), deduped. */
export const facultyNamesFrom = (
  ...sources: Array<Array<string | null | undefined>>
): string[] => {
  const byKey = new Map<string, string>();
  for (const name of sources.flat()) {
    const trimmed = (name ?? "").trim();
    if (trimmed && !byKey.has(trimmed.toLowerCase())) {
      byKey.set(trimmed.toLowerCase(), trimmed);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
};

/** Pick a Faculty / Program from the ones already listed (no free typing). */
export const FacultySelect = ({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  className?: string;
}) => {
  const current = value.trim();
  // Keep an existing record's faculty selectable even if no longer listed
  const listed =
    current && !options.some((name) => name.toLowerCase() === current.toLowerCase())
      ? [current, ...options]
      : options;
  const selected =
    listed.find((name) => name.toLowerCase() === current.toLowerCase()) ?? "";

  return (
    <Select
      aria-label="Faculty / Program"
      value={selected}
      className={className}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">General / All Programs</option>
      {listed.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </Select>
  );
};
