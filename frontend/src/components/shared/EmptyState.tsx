interface EmptyStateProps {
  title: string;
  description?: string;
}

export const EmptyState = ({ title, description }: EmptyStateProps) => (
  <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
    <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
    {description ? (
      <p className="mt-2 text-sm text-slate-500">{description}</p>
    ) : null}
  </div>
);

