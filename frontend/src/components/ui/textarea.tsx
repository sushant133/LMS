import * as React from "react";
import { nepaliTextClass } from "lib/nepaliSubject";
import { ensureUnicodeNepali } from "lib/preetiToUnicode";
import { cn } from "lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /**
   * Nepali subject content only.
   * Full Unicode typing (all letters, matras, conjuncts). Preeti converts on blur only.
   */
  nepali?: boolean;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      nepali = false,
      lang,
      onChange,
      onBlur,
      onPaste,
      onCompositionStart,
      onCompositionEnd,
      ...props
    },
    ref,
  ) => {
    const composingRef = React.useRef(false);

    const handlePaste: React.ClipboardEventHandler<HTMLTextAreaElement> = (
      event,
    ) => {
      onPaste?.(event);
    };

    const handleCompositionStart: React.CompositionEventHandler<HTMLTextAreaElement> =
      (event) => {
        composingRef.current = true;
        onCompositionStart?.(event);
      };

    const handleCompositionEnd: React.CompositionEventHandler<HTMLTextAreaElement> =
      (event) => {
        composingRef.current = false;
        onCompositionEnd?.(event);
        if (nepali && onChange) {
          const target = event.currentTarget;
          const raw = target.value;
          if (/[\u0900-\u097F]/.test(raw)) {
            const nfc = raw.normalize("NFC");
            if (nfc !== raw) {
              const proto = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value",
              );
              proto?.set?.call(target, nfc);
              onChange({
                target,
                currentTarget: target,
              } as React.ChangeEvent<HTMLTextAreaElement>);
            }
          }
        }
      };

    /** No transform while typing — every Devanagari letter/matra is kept as typed. */
    const handleChange: React.ChangeEventHandler<HTMLTextAreaElement> = (
      event,
    ) => {
      onChange?.(event);
    };

    const handleBlur: React.FocusEventHandler<HTMLTextAreaElement> = (
      event,
    ) => {
      if (
        nepali &&
        onChange &&
        !composingRef.current &&
        typeof event.currentTarget.value === "string"
      ) {
        const raw = event.currentTarget.value;
        const next = ensureUnicodeNepali(raw);
        if (next !== raw) {
          const target = event.currentTarget;
          const proto = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            "value",
          );
          proto?.set?.call(target, next);
          onChange({
            target,
            currentTarget: target,
          } as React.ChangeEvent<HTMLTextAreaElement>);
        }
      }
      onBlur?.(event);
    };

    return (
      <textarea
        ref={ref}
        {...props}
        lang={nepali ? lang || "ne" : lang}
        spellCheck={nepali ? false : props.spellCheck}
        autoCorrect={nepali ? "off" : props.autoCorrect}
        autoCapitalize={nepali ? "off" : props.autoCapitalize}
        autoComplete={nepali ? "off" : props.autoComplete}
        dir={nepali ? "auto" : props.dir}
        onChange={handleChange}
        onPaste={handlePaste}
        onBlur={handleBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        className={cn(
          "min-h-[110px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500",
          nepali && "min-h-[7.5rem] text-base",
          nepali && nepaliTextClass,
          nepali && "border-amber-200 focus:border-amber-500",
          className,
        )}
      />
    );
  },
);

Textarea.displayName = "Textarea";
