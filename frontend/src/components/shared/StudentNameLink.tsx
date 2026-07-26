import { Link } from "react-router-dom";
import { cn } from "lib/utils";

interface StudentNameLinkProps {
  studentId: string;
  name: string;
  className?: string;
  subtitle?: string;
}

export const StudentNameLink = ({ studentId, name, className, subtitle }: StudentNameLinkProps) => (
  <div className="min-w-0">
    <Link
      to={`/students/${studentId}/profile`}
      className={cn(
        "block truncate font-medium text-blue-700 hover:text-blue-900 hover:underline",
        className,
      )}
      title={name}
    >
      {name}
    </Link>
    {subtitle ? (
      <div className="truncate text-xs text-slate-500" title={subtitle}>
        {subtitle}
      </div>
    ) : null}
  </div>
);