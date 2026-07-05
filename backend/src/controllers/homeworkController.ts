import type { Request, Response } from "express";
import mongoose from "mongoose";
import type { AssignmentAttachment, AssignmentDeadlineStatus, AssignmentSubmissionStatus } from "@phit-erp/shared";
import {
  assignmentCommentSchema,
  assignmentSchema,
  assignmentSubmissionSchema,
  gradeSubmissionSchema
} from "@phit-erp/shared";
import { Assignment, AssignmentSubmission } from "../models/Assignment.js";
import { AssignmentComment } from "../models/AssignmentComment.js";
import { Batch } from "../models/Batch.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Year } from "../models/Year.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { compareBsDates, getDeadlineStatus, getTodayBs } from "../utils/nepaliDate.js";
import { notifyParentsOfStudent } from "../utils/notificationService.js";
import { assertParentAccessToStudent, getLinkedStudentIds } from "../utils/parentScope.js";
import { assertStudentOwnRecord, getStudentProfile, requireStudentProfile } from "../utils/studentScope.js";
import { validateAssignmentScope } from "../utils/academicValidation.js";
import { buildStudentAcademicFilter, buildSubjectEnrollmentFilter } from "../utils/academicScope.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import {
  assertTeacherQueryScope,
  assertTeacherSubjectAcademicScope,
  getTeacherScope,
  requireTeacherScope
} from "../utils/teacherScope.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

type ObjectIdLike = { toString(): string };

type AssignmentLean = {
  _id: ObjectIdLike;
  schoolId: ObjectIdLike;
  type: string;
  title: string;
  description: string;
  classId?: ObjectIdLike;
  sectionId?: ObjectIdLike;
  batchId?: ObjectIdLike;
  yearId?: ObjectIdLike;
  subjectId?: ObjectIdLike;
  teacherId: ObjectIdLike;
  topic?: string;
  dueDateBs?: string;
  maxMarks?: number;
  rubric?: string;
  visibleTo: string[];
  allowSubmission?: boolean;
  isPinned?: boolean;
  attachments?: unknown;
  links?: Array<{ title: string; url: string }>;
  createdAt?: Date;
  updatedAt?: Date;
};

const toOptionalId = (value?: ObjectIdLike | null): string | undefined => (value ? value.toString() : undefined);

const collectOptionalIds = (assignments: AssignmentLean[], field: keyof Pick<AssignmentLean, "classId" | "sectionId" | "batchId" | "yearId">): string[] =>
  [...new Set(assignments.map((assignment) => toOptionalId(assignment[field])).filter(Boolean))] as string[];

const normalizeAttachments = (raw: unknown): AssignmentAttachment[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (typeof item === "string") {
      return { url: item, name: item.split("/").pop() ?? "Attachment" };
    }
    const attachment = item as AssignmentAttachment;
    return {
      url: attachment.url,
      name: attachment.name,
      mimeType: attachment.mimeType,
      kind: attachment.kind
    };
  });
};

const assertTeacherOwnsAssignment = async (req: Request, assignmentId: string) => {
  if (req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Only teachers can manage assignments and CAS posts");
  }

  const scope = await requireTeacherScope(req);
  const assignment = await Assignment.findOne({
    _id: assignmentId,
    schoolId: tenantObjectId(req),
    teacherId: scope.teacherId
  }).lean();

  if (!assignment) {
    throw new ApiError(403, "You can only manage your own assignments");
  }

  return assignment;
};

const buildAssignmentFilter = async (req: Request): Promise<Record<string, unknown>> => {
  const filter: Record<string, unknown> = withTenantScope(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  if (typeof req.query.classId === "string") filter.classId = req.query.classId;
  if (typeof req.query.sectionId === "string") filter.sectionId = req.query.sectionId;
  if (typeof req.query.batchId === "string") filter.batchId = req.query.batchId;
  if (typeof req.query.yearId === "string") filter.yearId = req.query.yearId;
  if (typeof req.query.subjectId === "string") filter.subjectId = req.query.subjectId;
  if (typeof req.query.type === "string") filter.type = req.query.type;
  if (typeof req.query.topic === "string" && req.query.topic.trim()) {
    filter.topic = req.query.topic.trim();
  }

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    assertTeacherQueryScope(teacherScope, {
      classId: typeof req.query.classId === "string" ? req.query.classId : undefined,
      sectionId: typeof req.query.sectionId === "string" ? req.query.sectionId : undefined,
      batchId: typeof req.query.batchId === "string" ? req.query.batchId : undefined,
      yearId: typeof req.query.yearId === "string" ? req.query.yearId : undefined,
      subjectId: typeof req.query.subjectId === "string" ? req.query.subjectId : undefined,
      isCollege: college
    });
    filter.teacherId = teacherScope.teacherId;
    if (college) {
      filter.batchId = typeof req.query.batchId === "string" ? req.query.batchId : { $in: teacherScope.batchIds };
      filter.yearId = typeof req.query.yearId === "string" ? req.query.yearId : { $in: teacherScope.yearIds };
    } else {
      filter.classId = typeof req.query.classId === "string" ? req.query.classId : { $in: teacherScope.classIds };
      filter.sectionId = typeof req.query.sectionId === "string" ? req.query.sectionId : { $in: teacherScope.sectionIds };
    }
    filter.subjectId = typeof req.query.subjectId === "string" ? req.query.subjectId : { $in: teacherScope.subjectIds };
  }

  if (req.user?.role === "STUDENT") {
    const profile = await requireStudentProfile(req);
    const enrolledSubjectIds = await Subject.find(
      buildSubjectEnrollmentFilter(profile, institutionType, tenantObjectId(req))
    ).distinct("_id");

    Object.assign(filter, buildStudentAcademicFilter(profile, institutionType));
    filter.subjectId = { $in: enrolledSubjectIds };
    filter.visibleTo = "STUDENT";
  }

  if (req.user?.role === "PARENT") {
    const studentIds = await getLinkedStudentIds(req);
    const { Student } = await import("../models/Student.js");
    const students = await Student.find({ _id: { $in: studentIds } }).lean();
    if (college) {
      const batchIds = [...new Set(students.map((s) => s.batchId?.toString()).filter(Boolean))];
      const yearIds = [...new Set(students.map((s) => s.yearId?.toString()).filter(Boolean))];
      filter.batchId = { $in: batchIds };
      filter.yearId = { $in: yearIds };
    } else {
      const classIds = [...new Set(students.map((s) => s.classId?.toString()).filter(Boolean))];
      const sectionIds = [...new Set(students.map((s) => s.sectionId?.toString()).filter(Boolean))];
      filter.classId = { $in: classIds };
      filter.sectionId = { $in: sectionIds };
    }
    filter.visibleTo = "PARENT";
  }

  return filter;
};

const enrichAssignments = async (
  req: Request,
  assignments: AssignmentLean[],
  studentId?: string
) => {
  const schoolId = tenantObjectId(req);
  const todayBs = getTodayBs();

  const teacherIds = [...new Set(assignments.map((a) => a.teacherId.toString()))];
  const subjectIds = [...new Set(assignments.map((a) => a.subjectId?.toString()).filter(Boolean))] as string[];
  const classIds = collectOptionalIds(assignments, "classId");
  const sectionIds = collectOptionalIds(assignments, "sectionId");
  const batchIds = collectOptionalIds(assignments, "batchId");
  const yearIds = collectOptionalIds(assignments, "yearId");
  const assignmentIds = assignments.map((a) => a._id.toString());

  const [teachers, subjects, classes, sections, batches, years, commentCounts, submissions] = await Promise.all([
    Teacher.find({ schoolId, _id: { $in: teacherIds } })
      .populate("user", "fullName")
      .lean(),
    subjectIds.length > 0
      ? Subject.find({ schoolId, _id: { $in: subjectIds } }).lean()
      : Promise.resolve([]),
    classIds.length > 0
      ? SchoolClass.find({ schoolId, _id: { $in: classIds } }).lean()
      : Promise.resolve([]),
    sectionIds.length > 0
      ? Section.find({ schoolId, _id: { $in: sectionIds } }).lean()
      : Promise.resolve([]),
    batchIds.length > 0 ? Batch.find({ schoolId, _id: { $in: batchIds } }).lean() : Promise.resolve([]),
    yearIds.length > 0 ? Year.find({ schoolId, _id: { $in: yearIds } }).lean() : Promise.resolve([]),
    AssignmentComment.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
      {
        $match: {
          schoolId,
          assignmentId: { $in: assignmentIds.map((id) => new mongoose.Types.ObjectId(id)) }
        }
      },
      { $group: { _id: "$assignmentId", count: { $sum: 1 } } }
    ]),
    studentId
      ? AssignmentSubmission.find({
          schoolId,
          assignmentId: { $in: assignmentIds },
          studentId
        }).lean()
      : Promise.resolve([])
  ]);

  const teacherNameById = new Map(
    teachers.map((t) => [
      t._id.toString(),
      (t.user as { fullName?: string } | null)?.fullName ?? "Teacher"
    ])
  );
  const subjectById = new Map(subjects.map((s) => [s._id.toString(), s]));
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));
  const batchById = new Map(batches.map((b) => [b._id.toString(), b]));
  const yearById = new Map(years.map((y) => [y._id.toString(), y]));
  const commentCountByAssignment = new Map(commentCounts.map((c) => [c._id.toString(), c.count]));
  const submissionByAssignment = new Map(submissions.map((s) => [s.assignmentId.toString(), s]));

  return assignments.map((assignment) => {
    const id = assignment._id.toString();
    const subject = assignment.subjectId ? subjectById.get(assignment.subjectId.toString()) : undefined;
    const submission = submissionByAssignment.get(id);
    const hasDueDate = Boolean(assignment.dueDateBs) && assignment.type !== "NOTE";
    const deadlineStatus: AssignmentDeadlineStatus | null = hasDueDate
      ? getDeadlineStatus(assignment.dueDateBs, todayBs)
      : null;

    let submissionStatus: AssignmentSubmissionStatus | null = null;
    if (assignment.type !== "NOTE" && assignment.allowSubmission !== false) {
      submissionStatus = (submission?.status as AssignmentSubmissionStatus | undefined) ?? "PENDING";
    }

    const classId = toOptionalId(assignment.classId);
    const sectionId = toOptionalId(assignment.sectionId);
    const batchId = toOptionalId(assignment.batchId);
    const yearId = toOptionalId(assignment.yearId);

    return {
      _id: id,
      schoolId: assignment.schoolId.toString(),
      type: assignment.type,
      title: assignment.title,
      description: assignment.description,
      classId,
      sectionId,
      batchId,
      yearId,
      subjectId: assignment.subjectId?.toString(),
      teacherId: assignment.teacherId.toString(),
      topic: assignment.topic,
      dueDateBs: assignment.dueDateBs,
      maxMarks: assignment.maxMarks,
      rubric: assignment.rubric,
      visibleTo: assignment.visibleTo,
      allowSubmission: assignment.allowSubmission ?? true,
      isPinned: assignment.isPinned ?? false,
      attachments: normalizeAttachments(assignment.attachments),
      links: assignment.links ?? [],
      createdAt: assignment.createdAt?.toISOString(),
      updatedAt: assignment.updatedAt?.toISOString(),
      teacherName: teacherNameById.get(assignment.teacherId.toString()) ?? "Teacher",
      subjectName: subject?.name ?? "General",
      subjectCode: subject?.code ?? "",
      className: classId ? classById.get(classId)?.name ?? "" : batchId ? batchById.get(batchId)?.name ?? "" : "",
      sectionName: sectionId ? sectionById.get(sectionId)?.name ?? "" : yearId ? yearById.get(yearId)?.name ?? "" : "",
      deadlineStatus,
      submissionStatus,
      submissionId: submission?._id.toString(),
      marks: submission?.marks,
      feedback: submission?.feedback,
      commentCount: commentCountByAssignment.get(id) ?? 0
    };
  });
};

const applyFeedFilters = (
  posts: Awaited<ReturnType<typeof enrichAssignments>>,
  query: Request["query"]
) => {
  let filtered = [...posts];

  const status = typeof query.status === "string" ? query.status : undefined;
  if (status) {
    filtered = filtered.filter((post) => {
      if (status === "SUBMITTED" || status === "GRADED" || status === "PENDING") {
        return post.submissionStatus === status;
      }
      if (status === "UPCOMING" || status === "DUE_TODAY" || status === "OVERDUE") {
        return post.deadlineStatus === status;
      }
      return true;
    });
  }

  const dateFrom = typeof query.dateFrom === "string" ? query.dateFrom : undefined;
  const dateTo = typeof query.dateTo === "string" ? query.dateTo : undefined;
  if (dateFrom || dateTo) {
    filtered = filtered.filter((post) => {
      const dateKey = post.dueDateBs ?? post.createdAt?.slice(0, 10) ?? "";
      if (!dateKey) return false;
      if (dateFrom && compareBsDates(dateKey, dateFrom) < 0) return false;
      if (dateTo && compareBsDates(dateKey, dateTo) > 0) return false;
      return true;
    });
  }

  return filtered.sort((a, b) => {
    const pinDiff = Number(b.isPinned) - Number(a.isPinned);
    if (pinDiff !== 0) return pinDiff;
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
};

export const listAssignments = asyncHandler(async (req: Request, res: Response) => {
  const filter = await buildAssignmentFilter(req);
  const assignments = await Assignment.find(filter).sort({ isPinned: -1, createdAt: -1 }).lean();
  const enriched = await enrichAssignments(req, assignments as AssignmentLean[]);
  return sendSuccess(res, "Assignments fetched", enriched);
});

export const listFeed = asyncHandler(async (req: Request, res: Response) => {
  const filter = await buildAssignmentFilter(req);
  const assignments = await Assignment.find(filter).sort({ isPinned: -1, createdAt: -1 }).lean();

  let studentId: string | undefined;
  if (req.user?.role === "STUDENT") {
    const profile = await requireStudentProfile(req);
    studentId = profile.studentId;
  }

  const enriched = await enrichAssignments(req, assignments as AssignmentLean[], studentId);
  const posts = applyFeedFilters(enriched, req.query);
  const topics = [...new Set(assignments.map((a) => a.topic).filter((t): t is string => Boolean(t?.trim())))];

  return sendSuccess(res, "Classroom feed fetched", {
    posts,
    topics: topics.sort(),
    todayBs: getTodayBs(),
    studentId
  });
});

export const listTopics = asyncHandler(async (req: Request, res: Response) => {
  const filter = await buildAssignmentFilter(req);
  const topics = await Assignment.distinct("topic", { ...filter, topic: { $exists: true, $ne: "" } });
  return sendSuccess(res, "Topics fetched", topics.filter(Boolean).sort());
});

export const getAssignment = asyncHandler(async (req: Request, res: Response) => {
  const assignmentId = String(req.params.id);
  const assignment = await Assignment.findOne(withTenantScope(req, { _id: assignmentId })).lean();
  if (!assignment) throw new ApiError(404, "Assignment not found");

  if (req.user?.role === "TEACHER") {
    await assertTeacherOwnsAssignment(req, assignmentId);
  }

  let studentId: string | undefined;
  if (req.user?.role === "STUDENT") {
    const profile = await requireStudentProfile(req);
    studentId = profile.studentId;
    const enrolledSubjectIds = await Subject.find({
      schoolId: tenantObjectId(req),
      classIds: profile.classId
    }).distinct("_id");

    const subjectId = assignment.subjectId?.toString();
    const matchesScope =
      profile.batchId && profile.yearId
        ? assignment.batchId?.toString() === profile.batchId && assignment.yearId?.toString() === profile.yearId
        : assignment.classId?.toString() === profile.classId && assignment.sectionId?.toString() === profile.sectionId;

    if (
      !matchesScope ||
      !assignment.visibleTo.includes("STUDENT") ||
      !subjectId ||
      !enrolledSubjectIds.some((id) => id.toString() === subjectId)
    ) {
      throw new ApiError(403, "You do not have access to this post");
    }
  }

  const [post] = await enrichAssignments(req, [assignment as AssignmentLean], studentId);
  const comments = await AssignmentComment.find(withTenantScope(req, { assignmentId }))
    .sort({ createdAt: 1 })
    .lean();

  return sendSuccess(res, "Assignment fetched", {
    post,
    comments: comments.map((c) => ({
      _id: c._id.toString(),
      schoolId: c.schoolId.toString(),
      assignmentId: c.assignmentId.toString(),
      authorUserId: c.authorUserId.toString(),
      authorName: c.authorName,
      authorRole: c.authorRole,
      content: c.content,
      createdAt: c.createdAt?.toISOString()
    }))
  });
});

export const createAssignment = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Only teachers can create assignments and CAS posts");
  }

  const payload = assignmentSchema.parse(req.body);
  const institutionType = await getInstitutionType(req);
  validateAssignmentScope(institutionType, payload);
  const scope = await assertTeacherSubjectAcademicScope(req, payload.subjectId, payload);
  const teacherId = scope.teacherId;

  const assignment = await Assignment.create({
    ...payload,
    schoolId: req.tenantSchoolId,
    teacherId
  });

  if (payload.type === "HOMEWORK" || payload.type === "CAS") {
    const { Student } = await import("../models/Student.js");
    const studentFilter: Record<string, unknown> = { schoolId: tenantObjectId(req) };
    if (isCollege(institutionType)) {
      studentFilter.batchId = payload.batchId;
      studentFilter.yearId = payload.yearId;
    } else {
      studentFilter.classId = payload.classId;
      studentFilter.sectionId = payload.sectionId;
    }
    const students = await Student.find(studentFilter).lean();

    await Promise.all(
      students.map((student) =>
        notifyParentsOfStudent(
          req.tenantSchoolId!,
          student._id.toString(),
          `New ${payload.type === "HOMEWORK" ? "Assignment" : payload.type}: ${payload.title}`,
          payload.description.slice(0, 120),
          "HOMEWORK"
        )
      )
    );
  }

  return sendSuccess(res, "Assignment created", assignment, 201);
});

export const updateAssignment = asyncHandler(async (req: Request, res: Response) => {
  const assignmentId = String(req.params.id);
  await assertTeacherOwnsAssignment(req, assignmentId);
  const payload = assignmentSchema.partial().parse(req.body);

  if (req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Only teachers can update assignments and CAS posts");
  }

  if (payload.subjectId) {
    const institutionType = await getInstitutionType(req);
    const existing = await Assignment.findOne(withTenantScope(req, { _id: assignmentId })).lean();
    await assertTeacherSubjectAcademicScope(req, payload.subjectId, {
      classId: payload.classId ?? existing?.classId?.toString(),
      sectionId: payload.sectionId ?? existing?.sectionId?.toString(),
      batchId: payload.batchId ?? existing?.batchId?.toString(),
      yearId: payload.yearId ?? existing?.yearId?.toString()
    });
    validateAssignmentScope(institutionType, {
      classId: payload.classId ?? existing?.classId?.toString(),
      sectionId: payload.sectionId ?? existing?.sectionId?.toString(),
      batchId: payload.batchId ?? existing?.batchId?.toString(),
      yearId: payload.yearId ?? existing?.yearId?.toString()
    });
  }

  const assignment = await Assignment.findOneAndUpdate(withTenantScope(req, { _id: assignmentId }), payload, { new: true });
  if (!assignment) throw new ApiError(404, "Assignment not found");
  return sendSuccess(res, "Assignment updated", assignment);
});

export const togglePin = asyncHandler(async (req: Request, res: Response) => {
  const assignmentId = String(req.params.id);
  await assertTeacherOwnsAssignment(req, assignmentId);
  const isPinned = Boolean(req.body.isPinned);

  const assignment = await Assignment.findOneAndUpdate(
    withTenantScope(req, { _id: assignmentId }),
    { isPinned },
    { new: true }
  );
  if (!assignment) throw new ApiError(404, "Assignment not found");
  return sendSuccess(res, isPinned ? "Post pinned" : "Post unpinned", assignment);
});

export const deleteAssignment = asyncHandler(async (req: Request, res: Response) => {
  const assignmentId = String(req.params.id);
  await assertTeacherOwnsAssignment(req, assignmentId);
  const deleted = await Assignment.findOneAndDelete(withTenantScope(req, { _id: assignmentId }));
  if (!deleted) throw new ApiError(404, "Assignment not found");
  await Promise.all([
    AssignmentSubmission.deleteMany({ assignmentId }),
    AssignmentComment.deleteMany({ assignmentId })
  ]);
  return sendSuccess(res, "Assignment deleted");
});

export const listComments = asyncHandler(async (req: Request, res: Response) => {
  const assignmentId = String(req.params.id);
  const assignment = await Assignment.findOne(withTenantScope(req, { _id: assignmentId })).lean();
  if (!assignment) throw new ApiError(404, "Assignment not found");

  const comments = await AssignmentComment.find(withTenantScope(req, { assignmentId })).sort({ createdAt: 1 });
  return sendSuccess(res, "Comments fetched", comments);
});

export const addComment = asyncHandler(async (req: Request, res: Response) => {
  const assignmentId = String(req.params.id);
  const payload = assignmentCommentSchema.parse(req.body);
  const assignment = await Assignment.findOne(withTenantScope(req, { _id: assignmentId })).lean();
  if (!assignment) throw new ApiError(404, "Assignment not found");

  const author = await User.findById(req.user!.userId).select("fullName").lean();
  const comment = await AssignmentComment.create({
    schoolId: req.tenantSchoolId,
    assignmentId,
    authorUserId: req.user!.userId,
    authorName: author?.fullName ?? req.user!.email,
    authorRole: req.user!.role,
    content: payload.content
  });

  return sendSuccess(res, "Comment added", comment, 201);
});

export const listSubmissions = asyncHandler(async (req: Request, res: Response) => {
  const assignmentId = String(req.params.assignmentId);
  if (req.user?.role === "TEACHER") {
    await assertTeacherOwnsAssignment(req, assignmentId);
  }

  const filter = withTenantScope(req, { assignmentId });
  if (req.user?.role === "PARENT" || req.user?.role === "STUDENT") {
    const studentIds: string[] = [];
    if (req.user.role === "PARENT") {
      studentIds.push(...(await getLinkedStudentIds(req)));
    } else {
      const profile = await getStudentProfile(req);
      if (profile) studentIds.push(profile.studentId);
    }
    Object.assign(filter, { studentId: { $in: studentIds } });
  }
  const submissions = await AssignmentSubmission.find(filter).populate("studentId");
  return sendSuccess(res, "Submissions fetched", submissions);
});

export const submitAssignment = asyncHandler(async (req: Request, res: Response) => {
  const payload = assignmentSubmissionSchema.parse(req.body);
  await assertParentAccessToStudent(req, payload.studentId);
  await assertStudentOwnRecord(req, payload.studentId);

  const assignment = await Assignment.findOne(withTenantScope(req, { _id: payload.assignmentId })).lean();
  if (!assignment) {
    throw new ApiError(404, "Assignment not found");
  }

  if (assignment.allowSubmission === false) {
    throw new ApiError(400, "Submissions are not enabled for this post");
  }

  if (req.user?.role === "STUDENT") {
    const profile = await requireStudentProfile(req);
    const matchesScope =
      profile.batchId && profile.yearId
        ? assignment.batchId?.toString() === profile.batchId && assignment.yearId?.toString() === profile.yearId
        : assignment.classId?.toString() === profile.classId && assignment.sectionId?.toString() === profile.sectionId;

    if (!matchesScope) {
      throw new ApiError(403, "This assignment is not for your academic group");
    }
  }

  const submission = await AssignmentSubmission.findOneAndUpdate(
    withTenantScope(req, { assignmentId: payload.assignmentId, studentId: payload.studentId }),
    {
      ...payload,
      schoolId: req.tenantSchoolId,
      status: "SUBMITTED",
      submittedAt: new Date()
    },
    { upsert: true, new: true }
  );

  return sendSuccess(res, "Assignment submitted", submission);
});

export const gradeSubmission = asyncHandler(async (req: Request, res: Response) => {
  const payload = gradeSubmissionSchema.parse(req.body);
  const submission = await AssignmentSubmission.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!submission) throw new ApiError(404, "Submission not found");

  await assertTeacherOwnsAssignment(req, submission.assignmentId.toString());

  const graded = await AssignmentSubmission.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    { ...payload, status: "GRADED" },
    { new: true }
  );
  if (!graded) throw new ApiError(404, "Submission not found");

  await notifyParentsOfStudent(
    req.tenantSchoolId!,
    graded.studentId.toString(),
    "Assignment graded",
    `Marks: ${payload.marks}${payload.feedback ? ` — ${payload.feedback}` : ""}`,
    "HOMEWORK"
  );

  return sendSuccess(res, "Submission graded", graded);
});