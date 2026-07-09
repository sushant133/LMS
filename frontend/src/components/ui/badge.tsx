import type { HTMLAttributes } from "react";
import { cn } from "lib/utils";

export const Badge = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-700",
      className,
    )}
    {...props}
  />
);
