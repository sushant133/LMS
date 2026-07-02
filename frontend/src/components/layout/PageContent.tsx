import type { PropsWithChildren } from "react";
import { cn } from "lib/utils";

interface PageContentProps extends PropsWithChildren {
  className?: string;
}

export const PageContent = ({ children, className }: PageContentProps) => (
  <div className={cn("min-w-0 w-full", className)}>{children}</div>
);