import type { InventoryStockStatus } from "@phit-erp/shared";
import { Badge } from "components/ui/badge";

const statusStyles: Record<InventoryStockStatus, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800",
  LOW_STOCK: "bg-amber-100 text-amber-800",
  CRITICAL_STOCK: "bg-orange-100 text-orange-800",
  OUT_OF_STOCK: "bg-rose-100 text-rose-800",
};

const statusLabels: Record<InventoryStockStatus, string> = {
  AVAILABLE: "Available",
  LOW_STOCK: "Low Stock",
  CRITICAL_STOCK: "Critical Stock",
  OUT_OF_STOCK: "Out of Stock",
};

export const StockStatusBadge = ({
  status,
}: {
  status: InventoryStockStatus;
}) => (
  <Badge className={statusStyles[status] ?? "bg-slate-100 text-slate-700"}>
    {statusLabels[status] ?? status}
  </Badge>
);
