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
      ...props
    },
    ref,
  ) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const displayValue = formatNumberInputValue(value);

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
      onValueChange?.(parseNumberInput(event));
      onChange?.(event);
    };

    const handleWheel: React.WheelEventHandler<HTMLInputElement> = (event) => {
      event.preventDefault();
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
        value={displayValue}
        onChange={handleChange}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        className={cn(
          "number-input-no-spin flex h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition placeholder:text-slate-400 focus:border-brand-500",
          className,
        )}
      />
    );
  },
);

NumberInput.displayName = "NumberInput";
