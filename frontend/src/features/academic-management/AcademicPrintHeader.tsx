import { CollegeLogo } from "components/shared/CollegeLogo";
import { getPrintInstitutionBranding } from "lib/printBranding";
import { nepaliStructuralLabels, nepaliTextClass } from "lib/nepaliSubject";
import { cn } from "lib/utils";

interface AcademicPrintHeaderProps {
  institutionName: string;
  /** Optional; falls back to print branding cache from AppLayout. */
  institutionAddress?: string;
  title: string;
  subtitle?: string;
  academicYearBs?: string;
  /** Nepali subject documents print their chrome in Nepali too. */
  nepaliText?: boolean;
}

/** Shown in on-screen print area and PDF export (institution branding). */
export const AcademicPrintHeader = ({
  institutionName,
  institutionAddress,
  title,
  subtitle,
  academicYearBs,
  nepaliText = false,
}: AcademicPrintHeaderProps) => {
  const branding = getPrintInstitutionBranding();
  const address =
    institutionAddress?.trim() || branding.address?.trim() || "";

  return (
    <div className="mb-6 border-b border-slate-300 pb-4 print:mb-4">
      <div className="flex items-center gap-4">
        <CollegeLogo className="h-14 w-14 shrink-0" />
        <div className="min-w-0">
          <p className="text-lg font-bold text-slate-900">{institutionName}</p>
          {address ? (
            <p className="text-sm text-slate-600">{address}</p>
          ) : null}
          <p
            className={cn(
              "text-base font-semibold text-slate-800",
              nepaliText && nepaliTextClass,
            )}
            {...(nepaliText ? { lang: "ne" } : {})}
          >
            {title}
          </p>
          {subtitle ? (
            <p
              className={cn("text-sm text-slate-600", nepaliText && nepaliTextClass)}
              {...(nepaliText ? { lang: "ne" } : {})}
            >
              {subtitle}
            </p>
          ) : null}
          {academicYearBs ? (
            <p
              className={cn("mt-1 text-xs text-slate-500", nepaliText && nepaliTextClass)}
              {...(nepaliText ? { lang: "ne" } : {})}
            >
              {nepaliText ? nepaliStructuralLabels.academicYear : "Academic Year"}:{" "}
              {academicYearBs}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const AcademicPrintFooter = () => (
  <div className="mt-8 border-t border-slate-300 pt-3 text-xs text-slate-500 print:mt-6">
    <p>
      Confidential academic record · Page numbers appear when
      printing/exporting to PDF
    </p>
  </div>
);
