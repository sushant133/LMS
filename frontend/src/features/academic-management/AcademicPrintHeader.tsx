import { CollegeLogo } from "components/shared/CollegeLogo";

interface AcademicPrintHeaderProps {
  institutionName: string;
  title: string;
  subtitle?: string;
  academicYearBs?: string;
  generatedAt?: string;
}

/** Shown in on-screen print area and PDF export (institution branding). */
export const AcademicPrintHeader = ({
  institutionName,
  title,
  subtitle,
  academicYearBs,
  generatedAt,
}: AcademicPrintHeaderProps) => (
  <div className="mb-6 border-b border-slate-300 pb-4 print:mb-4">
    <div className="flex items-center gap-4">
      <CollegeLogo className="h-14 w-14 shrink-0" />
      <div className="min-w-0">
        <p className="text-lg font-bold text-slate-900">{institutionName}</p>
        <p className="text-base font-semibold text-slate-800">{title}</p>
        {subtitle ? (
          <p className="text-sm text-slate-600">{subtitle}</p>
        ) : null}
        <p className="mt-1 text-xs text-slate-500">
          {academicYearBs ? `Academic Year: ${academicYearBs}` : null}
          {academicYearBs && generatedAt ? " · " : null}
          {generatedAt ? `Generated: ${generatedAt}` : null}
        </p>
      </div>
    </div>
  </div>
);

export const AcademicPrintFooter = () => (
  <div className="mt-8 border-t border-slate-300 pt-3 text-xs text-slate-500 print:mt-6">
    <p>
      Generated from Academic Management · Confidential academic record · Page
      numbers appear when printing/exporting to PDF
    </p>
  </div>
);
