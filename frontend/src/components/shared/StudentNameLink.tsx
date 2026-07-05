import { Link } from "react-router-dom";
import { cn } from "lib/utils";

interface StudentNameLinkProps {
  studentId: string;
  name: string;
  className?: string;
  subtitle?: string;
}

export const StudentNameLink = ({ studentId, name, className, subtitle }: StudentNameLinkProps) => (
  <div>
    <Link
      to={`/students/${studentId}/profile`}
      className={cn("font-medium text-blue-700 hover:text-blue-900 hover:underline", className)}
    >
      {name}
    </Link>
    {subtitle ? <div className="text-xs text-slate-500">{subtitle}</div> : null}
  </div>
);