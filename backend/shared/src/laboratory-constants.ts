import type { UserRole } from "./types.js";

export const LABORATORY_TYPES = ["COMPUTER", "PHYSICS", "CHEMISTRY", "BIOLOGY", "OTHER"] as const;

export const DEFAULT_LAB_CATEGORIES: Record<(typeof LABORATORY_TYPES)[number], string[]> = {
  COMPUTER: [
    "Computers",
    "Laptops",
    "Monitors",
    "Keyboards",
    "Mouse",
    "Printers",
    "UPS",
    "Projectors",
    "Networking Devices",
    "Software/Licenses",
    "Other Equipment"
  ],
  PHYSICS: [
    "Measuring Instruments",
    "Electrical Equipment",
    "Optical Equipment",
    "Mechanical Equipment",
    "Safety Equipment",
    "Other Equipment"
  ],
  CHEMISTRY: [
    "Chemicals",
    "Glassware",
    "Laboratory Instruments",
    "Measuring Equipment",
    "Safety Equipment",
    "Other Equipment"
  ],
  BIOLOGY: [
    "Microscopes",
    "Slides",
    "Models & Specimens",
    "Dissection Kits",
    "Laboratory Instruments",
    "Safety Equipment",
    "Other Equipment"
  ],
  OTHER: ["Other Equipment"]
};

/** High-level equipment kind: consumables vs durable assets. */
export const LABORATORY_ITEM_KINDS = ["DISPOSABLE", "NON_DISPOSABLE"] as const;

export const LABORATORY_ITEM_KIND_LABELS: Record<(typeof LABORATORY_ITEM_KINDS)[number], string> = {
  DISPOSABLE: "Disposable / Destroyable",
  NON_DISPOSABLE: "Non-Disposable / Non-Destroyable"
};

export const LABORATORY_EQUIPMENT_CONDITIONS = ["NEW", "GOOD", "FAIR", "DAMAGED"] as const;

export const LABORATORY_EQUIPMENT_STATUSES = [
  "AVAILABLE",
  "IN_USE",
  "UNDER_MAINTENANCE",
  "DISPOSED"
] as const;

export const LABORATORY_STOCK_MOVEMENT_TYPES = [
  "INCREASE",
  "REDUCE",
  "CONSUME",
  "DAMAGE",
  "DISPOSE",
  "LOST",
  "MAINTENANCE",
  "ISSUE",
  "RETURN",
  "PURCHASE_RECEIVED",
  "ADJUSTMENT"
] as const;

export const LABORATORY_STOCK_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "PURCHASED",
  "RECEIVED",
  "REJECTED"
] as const;

export const LABORATORY_STOCK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const LABORATORY_INVENTORY_STOCK_STATUSES = [
  "AVAILABLE",
  "LOW_STOCK",
  "CRITICAL_STOCK",
  "OUT_OF_STOCK"
] as const;

export const LABORATORY_REPORT_TYPES = [
  "LABORATORY_INVENTORY",
  "EQUIPMENT",
  "CATEGORY",
  "STOCK_MOVEMENT",
  "LOW_STOCK",
  "OUT_OF_STOCK",
  "DAMAGED",
  "PURCHASE_REQUEST",
  "INVENTORY_VALUATION",
  "LABORATORY_ASSETS"
] as const;

/** Roles that can manage all laboratories (not scoped to assignment). */
export const LABORATORY_GLOBAL_MANAGER_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "LABORATORY_STAFF"
];

/** Roles allowed into the laboratory module (includes assigned teachers). */
export const LABORATORY_ACCESS_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "LABORATORY_STAFF",
  "TEACHER"
];
