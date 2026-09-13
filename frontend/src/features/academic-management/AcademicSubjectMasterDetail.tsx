import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "components/ui/button";
import { cn } from "lib/utils";

interface AcademicSubjectMasterDetailProps {
  /** Current subject key, or undefined when nothing is picked. */
  selectionKey?: string;
  /** Clears the selection so the subject tree comes back (phones only). */
  onClearSelection: () => void;
  /** Left pane — the faculty → year → subject tree. */
  tree: ReactNode;
  /** Right pane — whatever the panel shows for the chosen subject. */
  children: ReactNode;
}

/** Phones switch panes below this width; lg+ keeps the two-column layout. */
const PHONE_QUERY = "(max-width: 767.98px)";

/**
 * True on a phone-width viewport.
 *
 * Panels use this to skip their "select the first subject automatically"
 * default: on a wide screen that is a helpful starting view because the tree
 * stays visible beside it, but on a phone the detail REPLACES the tree, so
 * auto-selecting would drop the user inside a subject they never chose.
 */
export const isPhoneViewport = (): boolean =>
  typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;

/**
 * Two-pane subject layout shared by Syllabus, Session Plan, Lesson Plan and
 * Log Book.
 *
 * On a laptop or desktop both panes sit side by side, exactly as before.
 *
 * On a phone the two panes stacked, so picking a subject left its content far
 * below the fold and the user had to scroll to reach it. Here the panes swap
 * instead: choosing a subject replaces the tree with that subject's content
 * (scrolled to the top), and a back button returns to the tree.
 */
export const AcademicSubjectMasterDetail = ({
  selectionKey,
  onClearSelection,
  tree,
  children,
}: AcademicSubjectMasterDetailProps) => {
  const detailRef = useRef<HTMLDivElement>(null);
  const selected = Boolean(selectionKey);

  useEffect(() => {
    if (!selectionKey) return;
    if (typeof window === "undefined" || !window.matchMedia(PHONE_QUERY).matches) return;
    // The detail has just taken the tree's place; start it at the top rather
    // than at whatever offset the tree was scrolled to.
    const frame = requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [selectionKey]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(260px,320px)_1fr]">
      <div className={cn("no-print", selected && "max-md:hidden")}>{tree}</div>

      <div
        ref={detailRef}
        className={cn("min-w-0 space-y-4", !selected && "max-md:hidden")}
      >
        {selected ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="no-print md:hidden"
            onClick={onClearSelection}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            All subjects
          </Button>
        ) : null}
        {children}
      </div>
    </div>
  );
};
