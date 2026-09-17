import * as React from "react";
import { NEPALI_CHAR_GROUPS, nepaliCharLabel } from "lib/nepaliChars";
import { nepaliTextClass } from "lib/nepaliSubject";
import { cn } from "lib/utils";

type NepaliField = HTMLInputElement | HTMLTextAreaElement;

const FIELD_SELECTOR =
  'input[data-nepali="true"], textarea[data-nepali="true"]';

const isNepaliField = (node: EventTarget | null): node is NepaliField =>
  node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
    ? node.matches(FIELD_SELECTOR)
    : false;

/**
 * Write through the native value setter so React's onChange still fires for a
 * controlled field — the same technique Input/Textarea use on blur.
 */
const insertAtCaret = (field: NepaliField, text: string): void => {
  const proto =
    field instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) return;

  const current = field.value;
  const start = field.selectionStart ?? current.length;
  const end = field.selectionEnd ?? start;
  const next = `${current.slice(0, start)}${text}${current.slice(end)}`;

  setter.call(field, next);
  field.dispatchEvent(new Event("input", { bubbles: true }));

  const caret = start + text.length;
  field.setSelectionRange(caret, caret);
  field.focus();
};

/**
 * Floating insert palette for Nepali-subject fields.
 *
 * Mounted once at the app root: it follows whichever `nepali` Input/Textarea has
 * focus and inserts at the caret. The Nepali keyboard layouts cannot reach ऋ,
 * ं and ः, so those have to be clickable somewhere.
 */
export const NepaliCharPad = (): JSX.Element | null => {
  const [field, setField] = React.useState<NepaliField | null>(null);
  const [open, setOpen] = React.useState(false);
  const [rect, setRect] = React.useState<{ top: number; left: number } | null>(
    null,
  );
  const padRef = React.useRef<HTMLDivElement | null>(null);

  const place = React.useCallback((target: NepaliField) => {
    const box = target.getBoundingClientRect();
    setRect({ top: box.bottom + 6, left: box.left });
  }, []);

  React.useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (isNepaliField(target)) {
        setField(target);
        place(target);
        return;
      }
      // Clicking inside the pad must not count as leaving the field.
      if (
        target instanceof Node &&
        padRef.current &&
        padRef.current.contains(target)
      ) {
        return;
      }
      setField(null);
      setOpen(false);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [place]);

  React.useEffect(() => {
    if (!field) return;
    const reposition = () => {
      if (!field.isConnected) {
        setField(null);
        setOpen(false);
        return;
      }
      place(field);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [field, place]);

  if (!field || !rect) return null;

  /** Keep focus (and the caret) on the field while the palette is used. */
  const hold: React.MouseEventHandler = (event) => event.preventDefault();

  return (
    <div
      ref={padRef}
      className="fixed z-50 max-w-[min(30rem,calc(100vw-1.5rem))]"
      style={{ top: rect.top, left: Math.max(12, rect.left) }}
    >
      {open ? (
        <div className="rounded-xl border border-amber-200 bg-white p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <span className="text-[11px] font-medium text-slate-500">
              कीबोर्डमा नभएका अक्षर · Keyboard-missing characters
            </span>
            <button
              type="button"
              onMouseDown={hold}
              onClick={() => setOpen(false)}
              className="rounded px-1.5 text-xs text-slate-500 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto pr-1">
            {NEPALI_CHAR_GROUPS.map((group) => (
              <div key={group.label} className="mb-2 last:mb-0">
                <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-slate-400">
                  <span className={nepaliTextClass}>{group.label}</span> ·{" "}
                  {group.hint}
                </p>
                <div className="flex flex-wrap gap-1">
                  {group.chars.map((char) => (
                    <button
                      key={char}
                      type="button"
                      lang="ne"
                      title={char}
                      onMouseDown={hold}
                      onClick={() => insertAtCaret(field, char)}
                      className={cn(
                        "min-w-9 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-base leading-tight text-slate-800 transition hover:border-amber-400 hover:bg-amber-50",
                        nepaliTextClass,
                      )}
                    >
                      {nepaliCharLabel(char)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          type="button"
          lang="ne"
          onMouseDown={hold}
          onClick={() => setOpen(true)}
          className={cn(
            "rounded-lg border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 shadow-sm transition hover:bg-amber-100",
            nepaliTextClass,
          )}
        >
          ऋ ं ः — अक्षर थप्नुहोस्
        </button>
      )}
    </div>
  );
};
