import {
  useCallback,
  useEffect,
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
  /** Show a horizontal scrollbar on the header so sideways scroll is reachable without going to the bottom. */
  showHeaderScrollbar?: boolean;
  className?: string;
}

/**
 * Reliable "sticky header" for wide HTML tables.
 *
 * Browser sticky on <th> is fragile (border-collapse, overflow ancestors).
 * This keeps the header in a non-scrolling strip and scrolls only the body,
 * with synchronized horizontal scroll between header and body.
 *
 * Use matching <colgroup> + table-fixed on both header and body tables so
 * columns stay aligned. Vertical scrollbar width is mirrored on the header
 * so header/body table widths match.
 */
export const StickyTableScroll = ({
  header,
  body,
  maxHeightClassName = "max-h-[min(70vh,720px)]",
  showHeaderScrollbar = false,
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

  /** Keep header right padding equal to body vertical scrollbar width. */
  const syncScrollbarPadding = useCallback(() => {
    const bodyEl = bodyRef.current;
    const headerEl = headerRef.current;
    if (!bodyEl || !headerEl) return;
    const scrollbarWidth = Math.max(0, bodyEl.offsetWidth - bodyEl.clientWidth);
    headerEl.style.paddingRight = scrollbarWidth > 0 ? `${scrollbarWidth}px` : "";
  }, []);

  const onHeaderScroll = (event: UIEvent<HTMLDivElement>) => {
    syncScroll("header", event.currentTarget.scrollLeft);
  };

  const onBodyScroll = (event: UIEvent<HTMLDivElement>) => {
    syncScroll("body", event.currentTarget.scrollLeft);
  };

  useEffect(() => {
    syncScrollbarPadding();
    const bodyEl = bodyRef.current;
    if (!bodyEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncScrollbarPadding());
    ro.observe(bodyEl);
    return () => ro.disconnect();
  }, [syncScrollbarPadding, header, body]);

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col isolate", className)}>
      {/* Always-visible header strip (does not scroll vertically) */}
      <div
        ref={headerRef}
        className={cn(
          "shrink-0 overflow-x-auto overflow-y-hidden border-b border-slate-200 bg-slate-50 [-webkit-overflow-scrolling:touch] [touch-action:pan-x]",
          showHeaderScrollbar
            ? "[scrollbar-width:thin] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-slate-100"
            : "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
        onScroll={onHeaderScroll}
      >
        {header}
      </div>

      {/* Body: vertical + horizontal scroll; horizontal stays in sync with header */}
      <div
        ref={bodyRef}
        className={cn(
          "min-h-0 min-w-0 overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch] [touch-action:pan-x_pan-y]",
          /* Clear left-right slider (thumb) like other fixed tables */
          "[scrollbar-width:auto] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar]:w-2.5",
          "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300",
          "[&::-webkit-scrollbar-track]:bg-slate-100",
          maxHeightClassName,
        )}
        onScroll={onBodyScroll}
      >
        {body}
      </div>
    </div>
  );
};
