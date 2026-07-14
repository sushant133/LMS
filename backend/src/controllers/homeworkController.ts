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
import { notifyParentsOfStudent, sendNotification } from "../utils/notificationService.js";
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

/** Keep only academic scope fields that match the institution type (college ↔ batch/year, school ↔ class/section). */
const sanitizeAssignmentAcademicScope = (
  institutionType: Awaited<ReturnType<typeof getInstitutionType>>,
  payload: {
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
  }
) => {
  if (isCollege(institutionType)) {
    return {
      batchId: payload.batchId,
      yearId: payload.yearId,
      classId: undefined,
      sectionId: undefined
    };
  }
  return {
    classId: payload.classId,
    sectionId: payload.sectionId,
    batchId: undefined,
    yearId: undefined
  };
};

const assignmentMatchesStudentScope = (
  assignment: AssignmentLean | Record<string, unknown>,
  academicFilter: Record<string, unknown>
): boolean =>
  Object.entries(academicFilter).every(([key, expected]) => {
    const actual = (assignment as Record<string, unknown>)[key] as ObjectIdLike | undefined | null;
    return actual?.toString() === String(expected ?? "");
  });

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
    const enrolledSubjectIds = (
      await Subject.find(buildSubjectEnrollmentFilter(profile, institutionType, tenantObjectId(req))).distinct("_id")
    ).map((id) => id.toString());

    Object.assign(filter, buildStudentAcademicFilter(profile, institutionType));
    filter.visibleTo = "STUDENT";

    // Keep teacher-posted subject filter when it is one of the student's enrolled subjects.
    const requestedSubjectId = typeof req.query.subjectId === "string" ? req.query.subjectId : undefined;
    if (requestedSubjectId && enrolledSubjectIds.includes(requestedSubjectId)) {
      filter.subjectId = requestedSubjectId;
    } else {
      filter.subjectId = { $in: enrolledSubjectIds };
    }
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

  const objectAssignmentIds = assignmentIds.map((id) => new mongoose.Types.ObjectId(id));

  const [teachers, subjects, classes, sections, batches, years, commentCounts, submissions, submissionCounts] =
    await Promise.all([
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
            assignmentId: { $in: objectAssignmentIds }
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
        : Promise.resolve([]),
      // Teachers (no single studentId) get aggregate submission counts to verify student linkage.
      !studentId && assignmentIds.length > 0
        ? AssignmentSubmission.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
            {
              $match: {
                schoolId,
                assignmentId: { $in: objectAssignmentIds },
                status: { $in: ["SUBMITTED", "GRADED"] }
              }
            },
            { $group: { _id: "$assignmentId", count: { $sum: 1 } } }
          ])
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
  const submissionCountByAssignment = new Map(submissionCounts.map((c) => [c._id.toString(), c.count]));

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
      commentCount: commentCountByAssignment.get(id) ?? 0,
      submissionCount: submissionCountByAssignment.get(id) ?? (submission ? 1 : 0)
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
  const role = req.user?.role ?? "";

  if (!["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "STUDENT", "PARENT"].includes(role)) {
    throw new ApiError(403, "You do not have permission to view this post");
  }

  const assignment = await Assignment.findOne(withTenantScope(req, { _id: assignmentId })).lean();
  if (!assignment) throw new ApiError(404, "Assignment not found");

  if (role === "TEACHER") {
    await assertTeacherOwnsAssignment(req, assignmentId);
  }

  let studentId: string | undefined;
  if (req.user?.role === "STUDENT") {
    const profile = await requireStudentProfile(req);
    studentId = profile.studentId;
    const institutionType = await getInstitutionType(req);
    // Same enrollment + academic filters as listFeed so teacher-posted work is openable by students.
    const enrolledSubjectIds = await Subject.find(
      buildSubjectEnrollmentFilter(profile, institutionType, tenantObjectId(req))
    ).distinct("_id");

    const subjectId = assignment.subjectId?.toString();
    const academicFilter = buildStudentAcademicFilter(profile, institutionType);
    const matchesScope = assignmentMatchesStudentScope(assignment as AssignmentLean, academicFilter);

    if (
      !matchesScope ||
      !assignment.visibleTo.includes("STUDENT") ||
      !subjectId ||
      !enrolledSubjectIds.some((id) => id.toString() === subjectId)
    ) {
      throw new ApiError(403, "You do not have access to this post");
    }
  }

  if (req.user?.role === "PARENT") {
    if (!assignment.visibleTo.includes("PARENT")) {
      throw new ApiError(403, "You do not have access to this post");
    }
    const linkedStudentIds = await getLinkedStudentIds(req);
    const { Student } = await import("../models/Student.js");
    const children = await Student.find({ _id: { $in: linkedStudentIds } }).lean();
    const institutionType = await getInstitutionType(req);
    const college = isCollege(institutionType);
    const matchesChild = children.some((child) =>
      college
        ? assignment.batchId?.toString() === child.batchId?.toString() &&
          assignment.yearId?.toString() === child.yearId?.toString()
        : assignment.classId?.toString() === child.classId?.toString() &&
          assignment.sectionId?.toString() === child.sectionId?.toString()
    );
    if (!matchesChild) {
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
  const academicScope = sanitizeAssignmentAcademicScope(institutionType, payload);

  const assignment = await Assignment.create({
    type: payload.type,
    title: payload.title,
    description: payload.description,
    ...academicScope,
    subjectId: payload.subjectId,
    topic: payload.topic || undefined,
    dueDateBs: payload.dueDateBs || undefined,
    maxMarks: payload.maxMarks,
    rubric: payload.rubric || undefined,
    visibleTo: payload.visibleTo?.length ? payload.visibleTo : ["STUDENT", "PARENT"],
    allowSubmission: payload.allowSubmission ?? true,
    isPinned: payload.isPinned ?? false,
    attachments: payload.attachments ?? [],
    links: payload.links ?? [],
    schoolId: req.tenantSchoolId,
    teacherId
  });

  if (payload.type === "HOMEWORK" || payload.type === "CAS") {
    const { Student } = await import("../models/Student.js");
    const studentFilter: Record<string, unknown> = {
      schoolId: tenantObjectId(req),
      ...academicScope
    };
    // Notify only students who are also enrolled in this subject (same rule as student feed).
    const enrolledStudents = await Student.find(studentFilter).select("_id user").lean();
    const subjectFilter = isCollege(institutionType)
      ? { _id: payload.subjectId, schoolId: tenantObjectId(req), yearIds: academicScope.yearId }
      : { _id: payload.subjectId, schoolId: tenantObjectId(req), classIds: academicScope.classId };
    const subjectExists = await Subject.findOne(subjectFilter).select("_id").lean();

    if (subjectExists) {
      const label = payload.type === "HOMEWORK" ? "Assignment" : "CAS";
      const title = `New ${label}: ${payload.title}`;
      const message = payload.description.slice(0, 120);

      await Promise.all(
        enrolledStudents.flatMap((student) => {
          const jobs: Promise<unknown>[] = [
            notifyParentsOfStudent(req.tenantSchoolId!, student._id.toString(), title, message, "HOMEWORK")
          ];
          if (student.user) {
            jobs.push(
              sendNotification({
                schoolId: req.tenantSchoolId!,
                recipientUserId: student.user.toString(),
                title,
                message,
                type: "HOMEWORK",
                channel: "IN_APP",
                metadata: { assignmentId: assignment._id.toString(), studentId: student._id.toString() }
              })
            );
          }
          return jobs;
        })
      );
    }
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

  const institutionType = await getInstitutionType(req);
  const existing = await Assignment.findOne(withTenantScope(req, { _id: assignmentId })).lean();
  if (!existing) throw new ApiError(404, "Assignment not found");

  const nextScope = {
    classId: payload.classId ?? existing.classId?.toString(),
    sectionId: payload.sectionId ?? existing.sectionId?.toString(),
    batchId: payload.batchId ?? existing.batchId?.toString(),
    yearId: payload.yearId ?? existing.yearId?.toString()
  };
  const subjectId = payload.subjectId ?? existing.subjectId?.toString();
  if (!subjectId) {
    throw new ApiError(400, "Subject is required");
  }

  await assertTeacherSubjectAcademicScope(req, subjectId, nextScope);
  validateAssignmentScope(institutionType, nextScope);

  const academicScope = sanitizeAssignmentAcademicScope(institutionType, nextScope);
  const update: Record<string, unknown> = {
    ...payload,
    ...academicScope,
    subjectId,
    topic: payload.topic === "" ? undefined : (payload.topic ?? existing.topic),
    dueDateBs: payload.dueDateBs === "" ? undefined : (payload.dueDateBs ?? existing.dueDateBs)
  };

  // Explicitly clear opposite-institution fields so student filters stay aligned.
  if (isCollege(institutionType)) {
    update.$unset = { classId: 1, sectionId: 1 };
    delete update.classId;
    delete update.sectionId;
  } else {
    update.$unset = { batchId: 1, yearId: 1 };
    delete update.batchId;
    delete update.yearId;
  }

  const assignment = await Assignment.findOneAndUpdate(withTenantScope(req, { _id: assignmentId }), update, {
    new: true
  });
  if (!assignment) throw new ApiError(404, "Assignment not found");

  // When attachment list is replaced, drop files removed from Cloudinary/local storage
  if (payload.attachments) {
    const { collectAttachmentUrls, deleteStoredMediaUrls } = await import("../utils/mediaCleanup.js");
    const nextUrls = new Set(collectAttachmentUrls(payload.attachments));
    const removed = collectAttachmentUrls(
      existing.attachments as Array<{ url?: string }> | undefined
    ).filter((url) => !nextUrls.has(url));
    await deleteStoredMediaUrls(removed);
  }

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

  const submissions = await AssignmentSubmission.find({ assignmentId })
    .select("attachmentUrl attachments")
    .lean();
  await Promise.all([
    AssignmentSubmission.deleteMany({ assignmentId }),
    AssignmentComment.deleteMany({ assignmentId })
  ]);

  const { collectAttachmentUrls, deleteStoredMediaUrls } = await import("../utils/mediaCleanup.js");
  const urls = [
    ...collectAttachmentUrls(deleted.attachments as Array<{ url?: string }> | undefined),
    ...submissions.flatMap((s) => {
      const row = s as { attachmentUrl?: string; attachments?: Array<{ url?: string }> };
      return [
        ...(row.attachmentUrl ? [row.attachmentUrl] : []),
        ...collectAttachmentUrls(row.attachments)
      ];
    })
  ];
  await deleteStoredMediaUrls(urls);

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
  const role = req.user?.role ?? "";

  // Only academic roles may list submissions (route also enforces; defense in depth)
  if (!["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER", "STUDENT", "PARENT"].includes(role)) {
    throw new ApiError(403, "You do not have permission to view submissions");
  }

  if (role === "TEACHER") {
    await assertTeacherOwnsAssignment(req, assignmentId);
  }

  const filter = withTenantScope(req, { assignmentId });
  if (role === "PARENT" || role === "STUDENT") {
    const studentIds: string[] = [];
    if (role === "PARENT") {
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
    const institutionType = await getInstitutionType(req);
    const academicFilter = buildStudentAcademicFilter(profile, institutionType);
    const matchesScope = assignmentMatchesStudentScope(assignment as AssignmentLean, academicFilter);

    if (!matchesScope) {
      throw new ApiError(403, "This assignment is not for your academic group");
    }

    const enrolledSubjectIds = await Subject.find(
      buildSubjectEnrollmentFilter(profile, institutionType, tenantObjectId(req))
    ).distinct("_id");
    const subjectId = assignment.subjectId?.toString();
    if (!subjectId || !enrolledSubjectIds.some((id) => id.toString() === subjectId)) {
      throw new ApiError(403, "You are not enrolled in this subject");
    }
  }

  const previousSubmission = await AssignmentSubmission.findOne(
    withTenantScope(req, { assignmentId: payload.assignmentId, studentId: payload.studentId })
  )
    .select("attachmentUrl")
    .lean();

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

  // Replace old submission file on Cloudinary/local when student re-submits
  const nextAttachment =
    typeof (payload as { attachmentUrl?: string }).attachmentUrl === "string"
      ? (payload as { attachmentUrl?: string }).attachmentUrl
      : submission.attachmentUrl;
  if (previousSubmission?.attachmentUrl && previousSubmission.attachmentUrl !== nextAttachment) {
    const { deleteStoredMediaUrl } = await import("../utils/mediaCleanup.js");
    await deleteStoredMediaUrl(previousSubmission.attachmentUrl);
  }

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