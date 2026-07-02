export function formatCurrencyNpr(amount: number): string {
  return `Rs. ${Number(amount || 0).toLocaleString("en-IN")}`;
}
