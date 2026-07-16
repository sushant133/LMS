import * as React from "react";
import { nepaliTextClass } from "lib/nepaliSubject";
import { cn } from "lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Devanagari-friendly font + lang=ne for Nepali subject content. */
  nepali?: boolean;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, nepali = false, lang, ...props }, ref) => (
    <textarea
      ref={ref}
      lang={nepali ? lang || "ne" : lang}
      spellCheck={nepali ? false : props.spellCheck}
      className={cn(
        "min-h-[110px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500",
        nepali && nepaliTextClass,
        nepali && "border-amber-200 focus:border-amber-500",
        className,
      )}
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";
