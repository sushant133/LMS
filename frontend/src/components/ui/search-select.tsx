import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "lib/utils";

export interface SearchSelectOption {
  value: string;
  label: string;
  /** Smaller text under the label (roll no., account no. …). */
  hint?: string;
  /** Options with the same group are listed under that heading. */
  group?: string;
  /** Extra words the search matches on. */
  keywords?: string;
}

interface SearchSelectProps {
  options: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  /** Show at most this many matches (long student lists). */
  maxResults?: number;
}

/**
 * Type-to-search dropdown: type to filter, ↑ / ↓ to move, Enter to pick,
 * Esc to close. Shows the selected option's label when not focused.
 */
export const SearchSelect = ({
  options,
  value,
  onChange,
  placeholder = "Search…",
  emptyText = "No match",
  disabled,
  className,
  maxResults = 80,
  ...rest
}: SearchSelectProps) => {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** Fixed position next to the input — the list renders on <body> so a scrolling table cannot clip it. */
  const [listStyle, setListStyle] = useState<CSSProperties>({});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((option) => option.value === value);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? options.filter((option) =>
          `${option.label} ${option.hint ?? ""} ${option.keywords ?? ""} ${option.group ?? ""}`
            .toLowerCase()
            .includes(q),
        )
      : options;
    return list.slice(0, maxResults);
  }, [options, query, maxResults]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  // Place the list under the input, or above it when there is no room below;
  // follow the input while the page or a table scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 4;
      const maxHeight = 288;
      const below = window.innerHeight - rect.bottom - gap - 8;
      const above = rect.top - gap - 8;
      const openUp = below < Math.min(maxHeight, 200) && above > below;
      const width = Math.max(rect.width, 256);
      const left = Math.min(rect.left, window.innerWidth - width - 8);
      setListStyle({
        position: "fixed",
        left: Math.max(8, left),
        width,
        maxHeight: Math.max(120, Math.min(maxHeight, openUp ? above : below)),
        ...(openUp ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap })
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const pick = (option: SearchSelectOption) => {
    onChange(option.value);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={rest["aria-label"]}
        disabled={disabled}
        className="flex h-10 w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-slate-50"
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : selected?.label ?? ""}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, matches.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            if (open && matches[active]) {
              event.preventDefault();
              pick(matches[active]);
            }
          } else if (event.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          } else if (event.key === "Tab") {
            setOpen(false);
          }
        }}
      />
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      {open ? createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          style={listStyle}
          className="z-[1000] overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">{emptyText}</li>
          ) : (
            matches.map((option, index) => {
              const showGroup = option.group && option.group !== matches[index - 1]?.group;
              return (
                <li key={option.value} role="presentation">
                  {showGroup ? (
                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {option.group}
                    </div>
                  ) : null}
                  <div
                    role="option"
                    aria-selected={option.value === value}
                    className={cn(
                      "cursor-pointer px-3 py-1.5 text-sm",
                      index === active ? "bg-brand-50 text-brand-800" : "text-slate-800",
                      option.value === value && "font-semibold",
                    )}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      pick(option);
                    }}
                  >
                    <div>{option.label}</div>
                    {option.hint ? <div className="text-xs text-slate-500">{option.hint}</div> : null}
                  </div>
                </li>
              );
            })
          )}
        </ul>,
        document.body,
      ) : null}
    </div>
  );
};
