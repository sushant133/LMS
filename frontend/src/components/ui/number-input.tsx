import * as React from "react";
import { cn, formatNumberInputValue, parseNumberInput } from "lib/utils";

export type NumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "defaultValue"
> & {
  /**
   * Controlled numeric value. Empty / null / undefined / NaN render as a blank field
   * so users can clear with Backspace/Delete without the value snapping back to 0.
   */
  value?: number | string | null;
  /**
   * Native-compatible change handler. When the field is empty:
   * `event.target.value === ""` and `event.target.valueAsNumber` is `NaN`.
   * Do not coerce empty to 0 in the parent — validate on submit/blur instead.
   */
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  /**
   * Preferred callback: `undefined` when cleared, otherwise the numeric value.
   * Prefer this over reading `valueAsNumber` when you want optional empty state.
   */
  onValueChange?: (value: number | undefined) => void;
  /**
   * The parent's "nothing entered" value (default 0). It renders as a blank box,
   * and a cleared box stays blank even if the parent stores this value back.
   * Typing the number itself still shows it.
   */
  emptyValue?: number;
};

const toNumberOrNull = (value: number | string | null | undefined): number | null => {
  const formatted = formatNumberInputValue(value);
  return formatted === "" || Number.isNaN(formatted) ? null : formatted;
};

/** Box text for a value coming from the parent: blank for empty / emptyValue. */
const textFor = (value: number | string | null | undefined, emptyValue: number): string => {
  const numeric = toNumberOrNull(value);
  return numeric === null || numeric === emptyValue ? "" : String(numeric);
};

/** Whether the box text already represents the parent's value. */
const textMatches = (
  text: string,
  value: number | string | null | undefined,
  emptyValue: number,
): boolean => {
  const numeric = toNumberOrNull(value);
  if (text.trim() === "") return numeric === null || numeric === emptyValue;
  const typed = Number(text);
  return numeric !== null && !Number.isNaN(typed) && typed === numeric;
};

/**
 * Standardized ERP number input.
 * - No spinner / step buttons (CSS)
 * - No mouse-wheel rolling
 * - No arrow-key up/down rolling
 * - Allows full clear while editing (empty string, not forced 0)
 * - Validation should run on submit/blur, not by auto-filling 0 on change
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      className,
      value,
      onChange,
      onValueChange,
      onWheel,
      onKeyDown,
      emptyValue = 0,
      ...props
    },
    ref,
  ) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    // Own the box text so a default 0 (or emptyValue) shows blank and clearing
    // stays blank, even when the parent stores 0 back on change.
    const [text, setText] = React.useState(() => textFor(value, emptyValue));
    React.useEffect(() => {
      setText((current) =>
        textMatches(current, value, emptyValue) ? current : textFor(value, emptyValue),
      );
    }, [value, emptyValue]);

    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );

    // Non-passive wheel listener: browsers ignore preventDefault on passive handlers
    React.useEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      const onWheelNative = (event: WheelEvent) => {
        event.preventDefault();
      };
      el.addEventListener("wheel", onWheelNative, { passive: false });
      return () => el.removeEventListener("wheel", onWheelNative);
    }, []);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      setText(event.target.value);
      onValueChange?.(parseNumberInput(event));
      onChange?.(event);
    };

    // Do NOT call preventDefault on React's onWheel — React registers passive
    // listeners and spams console. Native non-passive listener above handles it.
    const handleWheel: React.WheelEventHandler<HTMLInputElement> = (event) => {
      onWheel?.(event);
    };

    const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (
      event,
    ) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
      }
      onKeyDown?.(event);
    };

    return (
      <input
        ref={setRefs}
        type="number"
        inputMode="decimal"
        {...props}
        value={text}
        onChange={handleChange}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        className={cn(
          "number-input-no-spin flex h-10 w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition placeholder:text-slate-400 focus:border-brand-500",
          className,
        )}
      />
    );
  },
);

NumberInput.displayName = "NumberInput";
