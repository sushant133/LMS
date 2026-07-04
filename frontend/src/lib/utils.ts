import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

export const formatCurrencyNpr = (amount: number): string =>
  new Intl.NumberFormat("en-NP", {
    style: "currency",
    currency: "NPR",
    maximumFractionDigits: 2
  }).format(amount);

/** Display value for controlled number inputs — empty field when cleared (NaN sentinel). */
export const formatNumberInputValue = (value: number | undefined | null): number | "" => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "";
  }
  return value;
};

export const parseErrorMessage = (error: unknown): string => {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Something went wrong";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong";
};

