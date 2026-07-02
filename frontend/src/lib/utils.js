import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs) => twMerge(clsx(inputs));
export const formatCurrencyNpr = (amount) => new Intl.NumberFormat("en-NP", {
    style: "currency",
    currency: "NPR",
    maximumFractionDigits: 2
}).format(amount);
export const parseErrorMessage = (error) => {
    if (typeof error === "object" && error && "response" in error) {
        const response = error.response;
        return response?.data?.message ?? "Something went wrong";
    }
    if (error instanceof Error) {
        return error.message;
    }
    return "Something went wrong";
};
