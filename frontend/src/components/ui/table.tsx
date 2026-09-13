import {
  createContext,
  useContext,
  type HTMLAttributes,
  type ReactNode,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { cn } from "lib/utils";

/**
 * Tables are wider than a phone. By default every <Table> renders inside its
 * own horizontally scrollable container, so the *table* scrolls sideways and
 * the page never does — cards, headings, filters and buttons stay put.
 *
 * The container is inert when the table already fits (no scrollbar, no layout
 * change), so desktop rendering is unchanged.
 *
 * Layouts that already own the scrolling (StickyTableScroll, print/PDF views)
 * turn this off through the context instead of passing a prop at every one of
 * the ~70 call sites.
 */
const TableAutoScrollContext = createContext(true);

export const TableAutoScrollProvider = ({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) => (
  <TableAutoScrollContext.Provider value={enabled}>
    {children}
  </TableAutoScrollContext.Provider>
);

/** Standalone scroll container, for raw <table> markup that is not <Table>. */
export const TableScroll = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    data-table-scroll=""
    className={cn(
      "w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]",
      "[scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent",
      // From md up the wrapper is transparent, so desktop/laptop render exactly
      // as before this change (a wide table spills and <main> scrolls it).
      "md:overflow-x-visible",
      className,
    )}
    {...props}
  />
);

interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Opt out of the automatic scroll container for this table only. */
  unwrapped?: boolean;
  /** Classes for the generated scroll container. */
  scrollClassName?: string;
}

export const Table = ({
  className,
  unwrapped,
  scrollClassName,
  ...props
}: TableProps) => {
  const autoScroll = useContext(TableAutoScrollContext) && !unwrapped;

  const table = (
    <table
      className={cn(
        "min-w-full divide-y divide-slate-200 text-left text-sm",
        className,
      )}
      {...props}
    />
  );

  if (!autoScroll) return table;
  return <TableScroll className={scrollClassName}>{table}</TableScroll>;
};

export const TableHead = ({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn("bg-slate-50", className)} {...props} />
);

export const TableBody = ({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody
    className={cn("divide-y divide-slate-100 bg-white", className)}
    {...props}
  />
);

export const Th = ({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn("px-4 py-3 font-medium text-slate-600", className)}
    {...props}
  />
);

export const Td = ({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-4 py-3 text-slate-700", className)} {...props} />
);
