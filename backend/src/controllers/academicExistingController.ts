import type { Request, Response } from "express";
import { z } from "zod";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

const querySchema = z.object({
  kind: z.enum(["syllabus", "session-plan"]),
  academicYearBs: z.string().trim().min(1)
});

const idText = (value: unknown) => (value ? String(value) : undefined);

/**
 * GET /academic-management/existing?kind=syllabus|session-plan&academicYearBs=
 *
 * Every syllabus / session plan already made for an academic year, school-wide
 * (whoever made it). Create forms use it to leave out subjects that already
 * have one — the same rule the server enforces on save — and to offer the
 * existing record instead. Only identifying fields are returned.
 */
export const listExistingAcademicRecords = asyncHandler(async (req: Request, res: Response) => {
  const { kind, academicYearBs } = querySchema.parse(req.query);
  const schoolId = tenantObjectId(req);
  const filter = { schoolId, academicYearBs, isDeleted: false };

  const rows =
    kind === "syllabus"
      ? await AcademicSyllabus.find(filter)
          .select("subjectId yearId batchId classId sectionId status")
          .lean()
      : await AcademicSessionPlan.find(filter)
          .select("subjectId yearId batchId classId sectionId status teacherId")
          .lean();

  const subjectIds = [...new Set(rows.map((row) => String(row.subjectId)))];
  const yearIds = [...new Set(rows.map((row) => idText(row.yearId)).filter(Boolean))] as string[];
  const teacherIds = [
    ...new Set(
      rows.map((row) => idText((row as { teacherId?: unknown }).teacherId)).filter(Boolean)
    )
  ] as string[];

  const [subjects, years, teachers] = await Promise.all([
    Subject.find({ _id: { $in: subjectIds }, schoolId }).select("name code masterSubjectId").lean(),
    Year.find({ _id: { $in: yearIds }, schoolId }).select("name level").lean(),
    teacherIds.length
      ? Teacher.find({ _id: { $in: teacherIds }, schoolId }).populate("user", "fullName").select("user").lean()
      : Promise.resolve([])
  ]);
  const subjectById = new Map(subjects.map((s) => [s._id.toString(), s]));
  const yearById = new Map(years.map((y) => [y._id.toString(), y]));
  const teacherNameById = new Map(
    teachers.map((t) => [
      t._id.toString(),
      (t.user as { fullName?: string } | null)?.fullName ?? "Teacher"
    ])
  );

  const data = rows.map((row) => {
    const subject = subjectById.get(String(row.subjectId));
    const year = row.yearId ? yearById.get(String(row.yearId)) : undefined;
    const teacherId = idText((row as { teacherId?: unknown }).teacherId);
    return {
      _id: row._id.toString(),
      subjectId: String(row.subjectId),
      subjectName: subject?.name ?? "Subject",
      subjectCode: subject?.code,
      masterSubjectId: idText(subject?.masterSubjectId),
      yearId: idText(row.yearId),
      yearName: year?.name,
      yearLevel: year?.level,
      batchId: idText(row.batchId),
      classId: idText(row.classId),
      sectionId: idText(row.sectionId),
      status: String(row.status ?? "DRAFT"),
      teacherId,
      teacherName: teacherId ? teacherNameById.get(teacherId) : undefined
    };
  });

  return sendSuccess(res, "Existing academic records fetched", data);
});
