import { jsx as _jsx } from "react/jsx-runtime";
import { Picker, parseBsDate } from "@munatech/nepali-datepicker";
import "@munatech/nepali-datepicker/styles.css";
export const NepaliDateField = ({ value, onChange, placeholder }) => (_jsx("div", { className: "rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-emerald-500", children: _jsx(Picker, { language: "en", value: value ? parseBsDate(value) ?? undefined : undefined, onChange: (date) => {
            if (!date) {
                onChange("");
                return;
            }
            onChange(`${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`);
        }, placeholder: placeholder, className: "w-full justify-between rounded-lg border-none bg-transparent px-0 py-0 text-sm text-slate-900 shadow-none outline-none" }) }));
