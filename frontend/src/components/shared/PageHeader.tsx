import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export const PageHeader = ({ title, description, action }: PageHeaderProps) => (
  <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
    <div className="min-w-0 flex-1">
      <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
      {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
    </div>
    {action ? <div className="shrink-0">{action}</div> : null}
  </div>
);

