import type { ReactNode } from "react";
import { cn } from "lib/utils";

/**
 * Build a dialer-safe tel: href.
 * Keeps a leading + for international numbers; strips other non-digits.
 */
export const toTelHref = (phone: string): string | null => {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return `tel:${hasPlus ? `+${digits}` : digits}`;
};

interface PhoneLinkProps {
  phone?: string | null;
  className?: string;
  empty?: ReactNode;
}

/** Clickable phone number that opens the device dialer (`tel:`). */
export const PhoneLink = ({
  phone,
  className,
  empty = "—",
}: PhoneLinkProps) => {
  const display = phone?.trim() || "";
  const href = display ? toTelHref(display) : null;

  if (!display || !href) {
    return <span className={cn("text-slate-500", className)}>{empty}</span>;
  }

  return (
    <a
      href={href}
      className={cn(
        "whitespace-nowrap tabular-nums text-brand-700 hover:text-brand-900 hover:underline",
        className,
      )}
      title={`Call ${display}`}
      aria-label={`Call ${display}`}
    >
      {display}
    </a>
  );
};
