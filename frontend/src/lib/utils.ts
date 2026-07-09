import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

export const formatCurrencyNpr = (amount: number): string =>
  new Intl.NumberFormat("en-NP", {
    style: "currency",
    currency: "NPR",
    maximumFractionDigits: 2,
  }).format(amount);

/**
 * Display value for controlled number inputs.
 * Empty / null / undefined / NaN → "" so the field can be cleared while editing.
 * Does not coerce empty to 0.
 */
export const formatNumberInputValue = (
  value: number | string | undefined | null,
): number | "" => {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return "";
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? "" : parsed;
  }
  if (Number.isNaN(value)) {
    return "";
  }
  return value;
};

/**
 * Parse a number input change. Empty or invalid → undefined (never 0).
 * Use at onChange for optional numeric fields; validate required fields on submit/blur.
 */
export const parseNumberInput = (event: {
  target: { value: string; valueAsNumber: number };
}): number | undefined => {
  if (event.target.value === "" || Number.isNaN(event.target.valueAsNumber)) {
    return undefined;
  }
  return event.target.valueAsNumber;
};

/**
 * Parse a number input into a number for form state typed as `number`.
 * Empty → NaN (display as blank via formatNumberInputValue). Never forces 0 on clear.
 */
export const parseNumberInputAsNumber = (event: {
  target: { value: string; valueAsNumber: number };
}): number => {
  if (event.target.value === "" || Number.isNaN(event.target.valueAsNumber)) {
    return Number.NaN;
  }
  return event.target.valueAsNumber;
};

/** True when a number field has a real numeric value (not empty/NaN). */
export const hasNumberInputValue = (
  value: number | string | undefined | null,
): boolean => {
  if (value === undefined || value === null || value === "") return false;
  const n = typeof value === "number" ? value : Number(value);
  return !Number.isNaN(n);
};

export const parseErrorMessage = (error: unknown): string => {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } })
      .response;
    return response?.data?.message ?? "Something went wrong";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong";
};
