import type { HTMLAttributes } from "react";
import { cn } from "lib/utils";

export const Badge = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn(
      // max-w-full keeps a long label inside its card on a phone; the fixed
      // min-height keeps a wrapped badge row evenly spaced.
      "inline-flex max-w-full min-h-6 items-center rounded-full bg-brand-100 px-2.5 py-1 text-center text-xs leading-tight font-semibold text-brand-700",
      className,
    )}
    {...props}
  />
);
