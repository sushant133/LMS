import crypto from "crypto";

export const generateReceiptVerificationCode = (
  schoolId: string,
  receiptNumber: string,
  amountNpr: number,
  paidDateBs: string
): string => {
  const payload = `${schoolId}|${receiptNumber}|${amountNpr}|${paidDateBs}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12).toUpperCase();
};

