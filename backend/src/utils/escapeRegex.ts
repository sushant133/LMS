/**
 * Escape user-controlled strings before embedding in MongoDB `$regex` patterns.
 * Prevents ReDoS and unintended regex metacharacter behavior.
 */
export const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
