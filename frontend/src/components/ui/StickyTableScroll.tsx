import {
  useCallback,
  useRef,
  type ReactNode,
  type UIEvent,
} from "react";
import { cn } from "lib/utils";

interface StickyTableScrollProps {
  /** Fixed header content (usually a full <table> with only thead). */
  header: ReactNode;
  /** Scrollable body content (usually a full <table> with only tbody). */
  body: ReactNode;
  /** Max height of the body scroll area. */
  maxHeightClassName?: string;
  className?: string;
}

/**
 * Reliable "sticky header" for wide HTML tables.
 *
 * Browser sticky on <th> is fragile (border-collapse, overflow ancestors).
 * This keeps the header in a non-scrolling strip and scrolls only the body,
 * with synchronized horizontal scroll between header and body.
 */
export const StickyTableScroll = ({
  header,
  body,
  maxHeightClassName = "max-h-[min(70vh,720px)]",
  className,
}: StickyTableScrollProps) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const syncScroll = useCallback((source: "header" | "body", left: number) => {
    if (syncing.current) return;
    syncing.current = true;
    if (source === "body" && headerRef.current) {
      headerRef.current.scrollLeft = left;
    }
    if (source === "header" && bodyRef.current) {
      bodyRef.current.scrollLeft = left;
    }
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, []);

  const onHeaderScroll = (event: UIEvent<HTMLDivElement>) => {
    syncScroll("header", event.currentTarget.scrollLeft);
  };

  const onBodyScroll = (event: UIEvent<HTMLDivElement>) => {
    syncScroll("body", event.currentTarget.scrollLeft);
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* Always-visible header strip (does not scroll vertically) */}
      <div
        ref={headerRef}
        className="shrink-0 overflow-x-auto overflow-y-hidden border-b border-slate-200 bg-slate-50 [scrollbar-gutter:stable] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={onHeaderScroll}
      >
        {header}
      </div>

      {/* Only the body scrolls vertically; horizontal scroll stays in sync with header */}
      <div
        ref={bodyRef}
        className={cn(
          "min-h-0 overflow-auto overscroll-contain [scrollbar-gutter:stable] [scrollbar-width:thin]",
          maxHeightClassName,
        )}
        onScroll={onBodyScroll}
      >
        {body}
      </div>
    </div>
  );
};
