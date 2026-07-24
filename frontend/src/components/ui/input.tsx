import * as React from "react";
import { nepaliTextClass } from "lib/nepaliSubject";
import { ensureUnicodeNepali } from "lib/preetiToUnicode";
import { cn, formatNumberInputValue } from "lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /**
   * Nepali subject content only:
   * - Devanagari font + lang=ne for correct matras/conjuncts while typing
   * - Native Unicode paste (Word/Docs) is NEVER rewritten
   * - On blur (after composition ends): convert clear Preeti ASCII → Unicode if needed
   */
  nepali?: boolean;
};

/**
 * Generic text/file/etc input. Prefer `NumberInput` for all numeric fields so
 * empty-while-editing behavior stays consistent ERP-wide.
 *
 * If `type="number"` is used here for legacy reasons, empty/NaN still display blank
 * and are not coerced to 0 by this component.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      value,
      onChange,
      onBlur,
      onPaste,
      onCompositionStart,
      onCompositionEnd,
      nepali = false,
      lang,
      onWheel,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    const isNumberInput = type === "number";
    /** Track IME composition so we never rewrite mid-syllable (Windows/Mac Nepali). */
    const composingRef = React.useRef(false);
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );

    // Non-passive wheel block for legacy type="number" inputs
    React.useEffect(() => {
      if (!isNumberInput) return;
      const el = inputRef.current;
      if (!el) return;
      const onWheelNative = (event: WheelEvent) => {
        event.preventDefault();
      };
      el.addEventListener("wheel", onWheelNative, { passive: false });
      return () => el.removeEventListener("wheel", onWheelNative);
    }, [isNumberInput]);

    const resolvedValue = isNumberInput
      ? formatNumberInputValue(
          typeof value === "number" ||
            typeof value === "string" ||
            value === null ||
            value === undefined
            ? value
            : String(value),
        )
      : value;

    /**
     * Native paste only — do not intercept.
     * Word / Google Docs / websites put proper UTF-8 in text/plain.
     */
    const handlePaste: React.ClipboardEventHandler<HTMLInputElement> = (
      event,
    ) => {
      onPaste?.(event);
    };

    const handleCompositionStart: React.CompositionEventHandler<HTMLInputElement> =
      (event) => {
        composingRef.current = true;
        onCompositionStart?.(event);
      };

    const handleCompositionEnd: React.CompositionEventHandler<HTMLInputElement> =
      (event) => {
        composingRef.current = false;
        onCompositionEnd?.(event);
        // After IME commits a syllable, keep value as-is (Unicode). No Preeti rewrite mid-type.
        if (nepali && onChange && !isNumberInput && type !== "file") {
          const target = event.currentTarget;
          // NFC only when already Devanagari — never Preeti-map during typing
          const raw = target.value;
          if (/[\u0900-\u097F]/.test(raw)) {
            const nfc = raw.normalize("NFC");
            if (nfc !== raw) {
              const proto = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value",
              );
              proto?.set?.call(target, nfc);
              onChange({
                target,
                currentTarget: target,
              } as React.ChangeEvent<HTMLInputElement>);
            }
          }
        }
      };

    /**
     * Pass every keystroke through unchanged (all Devanagari letters/matras).
     * Do not transform onChange — that breaks half-forms while typing.
     */
    const handleChange: React.ChangeEventHandler<HTMLInputElement> = (
      event,
    ) => {
      onChange?.(event);
    };

    /** Convert Preeti → Unicode only after focus leaves (and not mid-IME). */
    const handleBlur: React.FocusEventHandler<HTMLInputElement> = (event) => {
      if (
        nepali &&
        onChange &&
        !isNumberInput &&
        type !== "file" &&
        !composingRef.current &&
        typeof event.currentTarget.value === "string"
      ) {
        const raw = event.currentTarget.value;
        const next = ensureUnicodeNepali(raw);
        if (next !== raw) {
          const target = event.currentTarget;
          const proto = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          );
          proto?.set?.call(target, next);
          onChange({
            target,
            currentTarget: target,
          } as React.ChangeEvent<HTMLInputElement>);
        }
      }
      onBlur?.(event);
    };

    const handleWheel: React.WheelEventHandler<HTMLInputElement> = (event) => {
      if (isNumberInput) {
        event.preventDefault();
      }
      onWheel?.(event);
    };

    const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (
      event,
    ) => {
      // Number fields: no arrow-key rolling
      if (
        isNumberInput &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
      }
      onKeyDown?.(event);
    };

    return (
      <input
        ref={setRefs}
        type={type}
        {...props}
        value={resolvedValue}
        onChange={handleChange}
        onPaste={handlePaste}
        onBlur={handleBlur}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        lang={nepali ? lang || "ne" : lang}
        spellCheck={nepali ? false : props.spellCheck}
        autoCorrect={nepali ? "off" : props.autoCorrect}
        autoCapitalize={nepali ? "off" : props.autoCapitalize}
        autoComplete={nepali ? "off" : props.autoComplete}
        inputMode={
          nepali && !isNumberInput
            ? "text"
            : isNumberInput
              ? props.inputMode ?? "decimal"
              : props.inputMode
        }
        dir={nepali ? "auto" : props.dir}
        className={cn(
          "flex h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition placeholder:text-slate-400 focus:border-brand-500",
          isNumberInput && "number-input-no-spin",
          /* Nepali: drop fixed h-10 (clips matras); font-nepali CSS sets min-height */
          nepali && "h-auto min-h-11 text-base",
          nepali && nepaliTextClass,
          nepali && "border-amber-200 focus:border-amber-500",
          className,
        )}
      />
    );
  },
);

Input.displayName = "Input";
