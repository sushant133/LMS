import type { InventoryStockStatus } from "@phit-erp/shared";
export {
  enrichEquipmentInventory,
  getIssuedQuantity,
  getLabStockStatus
} from "./laboratoryInventory.js";

export const getStockStatus = (available: number, total: number): InventoryStockStatus => {
  if (available <= 0) {
    return "OUT_OF_STOCK";
  }

  const lowThreshold = Math.max(1, Math.floor(total * 0.2));
  if (available <= Math.max(1, Math.floor(lowThreshold * 0.5))) {
    return "CRITICAL_STOCK";
  }
  if (available <= lowThreshold) {
    return "LOW_STOCK";
  }

  return "AVAILABLE";
};

export const enrichBookInventory = <T extends { totalCopies: number; availableCopies: number }>(book: T) => ({
  ...book,
  issuedCopies: Math.max(0, book.totalCopies - book.availableCopies),
  status: getStockStatus(book.availableCopies, book.totalCopies)
});