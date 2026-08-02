import type { ClientSession, Types } from "mongoose";
import { FeeCollection } from "../models/FeeCollection.js";
import { Student } from "../models/Student.js";

/**
 * Security deposit rules:
 * - securityDepositExpectedNpr = planned amount at admission (student form). NOT paid.
 * - securityDepositNpr = amount collected/held — only from Accounts fee receipts
 *   (securityDepositPaidNpr on FeeCollection).
 * - securityDepositRefundedNpr = cumulative refunds after pass-out.
 *
 * Older records sometimes stored the admission plan in securityDepositNpr (held),
 * which made it look paid. This sync moves that phantom amount back to expected
 * and sets held = sum of deposit lines on fee collections.
 */
export async function syncStudentSecurityDepositHeldFromLedger(
  studentId: Types.ObjectId | string,
  schoolId: Types.ObjectId | string,
  session?: ClientSession | null
): Promise<{
  expectedNpr: number;
  heldNpr: number;
  refundedNpr: number;
  ledgerDepositPaidNpr: number;
  corrected: boolean;
}> {
  const studentQuery = Student.findOne({ _id: studentId, schoolId });
  if (session) studentQuery.session(session);
  const student = await studentQuery;
  if (!student) {
    return {
      expectedNpr: 0,
      heldNpr: 0,
      refundedNpr: 0,
      ledgerDepositPaidNpr: 0,
      corrected: false
    };
  }

  if (student.securityDepositWaived) {
    const expectedNpr = 0;
    const heldNpr = Math.max(0, Number(student.securityDepositNpr) || 0);
    const refundedNpr = Math.max(0, Number(student.securityDepositRefundedNpr) || 0);
    return {
      expectedNpr,
      heldNpr,
      refundedNpr,
      ledgerDepositPaidNpr: heldNpr,
      corrected: false
    };
  }

  const collQuery = FeeCollection.find({
    studentId: student._id,
    schoolId,
    isDeleted: false
  }).select("securityDepositPaidNpr");
  if (session) collQuery.session(session);
  const collections = await collQuery.lean();

  const ledgerDepositPaidNpr = collections.reduce((sum, row) => {
    const paid =
      Number((row as { securityDepositPaidNpr?: number }).securityDepositPaidNpr) || 0;
    return sum + Math.max(0, paid);
  }, 0);

  let expectedNpr = Math.max(0, Number(student.securityDepositExpectedNpr) || 0);
  let heldNpr = Math.max(0, Number(student.securityDepositNpr) || 0);
  let refundedNpr = Math.max(0, Number(student.securityDepositRefundedNpr) || 0);
  let corrected = false;

  /**
   * Held = sum of deposit lines on fee receipts only.
   * Never inflate the admission plan when removing phantom held:
   * - Legacy: plan was stored only in securityDepositNpr, expected=0 → move to expected
   * - Bug: plan 15k + phantom 15k + paid 15k → held 30k, ledger 15k → held becomes 15k, plan stays 15k
   */
  if (Math.abs(heldNpr - ledgerDepositPaidNpr) > 0.001) {
    if (heldNpr > ledgerDepositPaidNpr && expectedNpr <= 0) {
      // No plan on file — treat old held as planned amount (not collected)
      expectedNpr = heldNpr;
    }
    heldNpr = ledgerDepositPaidNpr;
    corrected = true;
  }

  // Planned amount still missing but real collections exist
  if (expectedNpr <= 0 && heldNpr > 0) {
    expectedNpr = heldNpr;
    corrected = true;
  }

  // Refunded cannot exceed held
  if (refundedNpr > heldNpr + 0.001) {
    refundedNpr = heldNpr;
    corrected = true;
  }

  if (corrected) {
    student.securityDepositExpectedNpr = expectedNpr;
    student.securityDepositNpr = heldNpr;
    student.securityDepositRefundedNpr = refundedNpr;
    await student.save(session ? { session } : undefined);
  }

  return {
    expectedNpr,
    heldNpr,
    refundedNpr,
    ledgerDepositPaidNpr,
    corrected
  };
}
