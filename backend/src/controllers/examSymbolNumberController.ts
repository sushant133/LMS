import type { Request, Response } from "express";
import { examSymbolNumberBulkSchema } from "@phit-erp/shared";
import { Exam } from "../models/Exam.js";
import { ExamSymbolNumber } from "../models/ExamSymbolNumber.js";
import { Student } from "../models/Student.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { assertInstitutionWrite } from "../utils/institutionAccess.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

const getExamOrThrow = async (req: Request, examId: string) => {
  const exam = await Exam.findOne(withTenantScope(req, { _id: examId })).lean();
  if (!exam) {
    throw new ApiError(404, "Exam not found");
  }
  return exam;
};

/** Every symbol number issued for one exam. */
export const listExamSymbolNumbers = asyncHandler(async (req: Request, res: Response) => {
  const examId = String(req.params.examId);
  await getExamOrThrow(req, examId);

  const rows = await ExamSymbolNumber.find(withTenantScope(req, { examId }))
    .sort({ symbolNumber: 1 })
    .lean();

  return sendSuccess(res, "Symbol numbers fetched", rows);
});

/**
 * Save a batch of hand-entered symbol numbers. The panel sends only the rows the
 * office touched, so anything absent is left alone; a blank value clears that
 * student's number rather than storing an empty string.
 */
export const saveExamSymbolNumbers = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req, "Only administrators can issue symbol numbers");
  const examId = String(req.params.examId);
  await getExamOrThrow(req, examId);

  const parsed = examSymbolNumberBulkSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid symbol numbers");
  }

  const schoolId = tenantObjectId(req);

  /** Last write wins if the same student appears twice in one payload. */
  const byStudent = new Map<string, string>();
  for (const entry of parsed.data.entries) {
    byStudent.set(entry.studentId, entry.symbolNumber.trim());
  }

  const studentIds = [...byStudent.keys()];
  const students = await Student.find({ _id: { $in: studentIds }, schoolId })
    .select("_id")
    .lean();
  const knownStudentIds = new Set(students.map((student) => student._id.toString()));
  const unknown = studentIds.filter((id) => !knownStudentIds.has(id));
  if (unknown.length > 0) {
    throw new ApiError(400, `${unknown.length} student(s) do not belong to this institution`);
  }

  // A symbol number must be unique within the exam — catch it here so the office
  // gets a readable message instead of a duplicate-key error.
  const assigned = new Set<string>();
  for (const symbolNumber of byStudent.values()) {
    if (!symbolNumber) continue;
    const key = symbolNumber.toLowerCase();
    if (assigned.has(key)) {
      throw new ApiError(400, `Symbol number ${symbolNumber} is used more than once`);
    }
    assigned.add(key);
  }

  if (assigned.size > 0) {
    const existing = await ExamSymbolNumber.find({
      schoolId,
      examId,
      studentId: { $nin: studentIds }
    })
      .select("symbolNumber")
      .lean();
    for (const row of existing) {
      const taken = String(row.symbolNumber ?? "").toLowerCase();
      if (assigned.has(taken)) {
        throw new ApiError(400, `Symbol number ${row.symbolNumber} is already issued in this exam`);
      }
    }
  }

  // Clear first, then insert. Swapping two students' numbers inside one payload
  // would otherwise trip the unique index halfway through the batch. The rows
  // are kept aside so a failed insert — a racing writer taking one of these
  // numbers — does not leave the office with numbers simply gone.
  const replaced = await ExamSymbolNumber.find({
    schoolId,
    examId,
    studentId: { $in: studentIds }
  })
    .select("studentId symbolNumber")
    .lean();

  await ExamSymbolNumber.deleteMany({ schoolId, examId, studentId: { $in: studentIds } });

  const inserts = [...byStudent]
    .filter(([, symbolNumber]) => Boolean(symbolNumber))
    .map(([studentId, symbolNumber]) => ({ schoolId, examId, studentId, symbolNumber }));

  if (inserts.length > 0) {
    try {
      await ExamSymbolNumber.insertMany(inserts);
    } catch {
      if (replaced.length > 0) {
        await ExamSymbolNumber.insertMany(
          replaced.map((row) => ({
            schoolId,
            examId,
            studentId: row.studentId,
            symbolNumber: row.symbolNumber
          })),
          { ordered: false }
        ).catch(() => undefined);
      }
      throw new ApiError(
        409,
        "Those symbol numbers could not be saved — one is already issued in this exam"
      );
    }
  }

  const rows = await ExamSymbolNumber.find({ schoolId, examId }).sort({ symbolNumber: 1 }).lean();
  return sendSuccess(res, "Symbol numbers saved", rows);
});

/** Wipe every symbol number issued for an exam, so a block can be re-issued. */
export const clearExamSymbolNumbers = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req, "Only administrators can issue symbol numbers");
  const examId = String(req.params.examId);
  await getExamOrThrow(req, examId);

  const result = await ExamSymbolNumber.deleteMany(withTenantScope(req, { examId }));
  return sendSuccess(res, "Symbol numbers cleared", { removed: result.deletedCount ?? 0 });
});
