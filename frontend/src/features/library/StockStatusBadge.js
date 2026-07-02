import { jsx as _jsx } from "react/jsx-runtime";
import { Badge } from "components/ui/badge";
const statusStyles = {
    AVAILABLE: "bg-emerald-100 text-emerald-800",
    LOW_STOCK: "bg-amber-100 text-amber-800",
    OUT_OF_STOCK: "bg-rose-100 text-rose-800"
};
const statusLabels = {
    AVAILABLE: "Available",
    LOW_STOCK: "Low Stock",
    OUT_OF_STOCK: "Out of Stock"
};
export const StockStatusBadge = ({ status }) => (_jsx(Badge, { className: statusStyles[status], children: statusLabels[status] }));
