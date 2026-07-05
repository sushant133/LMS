import type { InventoryStockStatus } from "@phit-erp/shared";

export const getIssuedQuantity = (total: number, available: number): number => Math.max(0, total - available);

export const getStockStatus = (available: number, total: number): InventoryStockStatus => {
  if (available <= 0) {
    return "OUT_OF_STOCK";
  }

  const lowThreshold = Math.max(1, Math.floor(total * 0.2));
  if (available <= lowThreshold) {
    return "LOW_STOCK";
  }

  return "AVAILABLE";
};

export const enrichBookInventory = <T extends { totalCopies: number; availableCopies: number }>(book: T) => ({
  ...book,
  issuedCopies: getIssuedQuantity(book.totalCopies, book.availableCopies),
  status: getStockStatus(book.availableCopies, book.totalCopies)
});

export const enrichEquipmentInventory = <T extends { quantity: number; availableQuantity: number }>(item: T) => ({
  ...item,
  issuedQuantity: getIssuedQuantity(item.quantity, item.availableQuantity),
  status: getStockStatus(item.availableQuantity, item.quantity)
});