import type { InventoryStockStatus } from "@phit-erp/shared";
import { Badge } from "components/ui/badge";

const statusStyles: Record<InventoryStockStatus, string> = {
  AVAILABLE: "bg-brand-100 text-brand-800",
  LOW_STOCK: "bg-amber-100 text-amber-800",
  OUT_OF_STOCK: "bg-rose-100 text-rose-800",
};

const statusLabels: Record<InventoryStockStatus, string> = {
  AVAILABLE: "Available",
  LOW_STOCK: "Low Stock",
  OUT_OF_STOCK: "Out of Stock",
};

export const StockStatusBadge = ({
  status,
}: {
  status: InventoryStockStatus;
}) => <Badge className={statusStyles[status]}>{statusLabels[status]}</Badge>;
