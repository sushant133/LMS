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

  // Held must match accounting collections (source of truth for "deposit paid")
  if (Math.abs(heldNpr - ledgerDepositPaidNpr) > 0.001) {
    // Excess held without ledger = admission plan wrongly stored as collected
    if (heldNpr > ledgerDepositPaidNpr) {
      const phantom = heldNpr - ledgerDepositPaidNpr;
      expectedNpr = Math.max(expectedNpr, ledgerDepositPaidNpr + phantom);
    }
    heldNpr = ledgerDepositPaidNpr;
    corrected = true;
  }

  // Planned amount missing but student has deposit history
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
