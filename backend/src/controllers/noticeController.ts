import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { noticeSchema } from "@nepal-school-erp/shared";
import { Notice } from "../models/Notice.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { compareBsDates, ensureValidBsDate, getTodayBs } from "../utils/nepaliDate.js";
import { getLinkedStudentIds } from "../utils/parentScope.js";
import { getStudentProfile } from "../utils/studentScope.js";
import {
  assertTeacherClassSection,
  assertTeacherSubject,
  getTeacherScope,
  requireTeacherScope
} from "../utils/teacherScope.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

type NoticeLean = {
  _id: Types.ObjectId;
  schoolId: Types.ObjectId;
  title: string;
  content: string;
  visibleTo: string[];
  publishDateBs: string;
  expiresAtBs?: string;
  subjectId?: Types.ObjectId;
  classId?: Types.ObjectId;
  sectionId?: Types.ObjectId;
  teacherId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

const buildActiveNoticeFilter = (todayBs: string) => ({
  publishDateBs: { $lte: todayBs },
  $or: [{ expiresAtBs: { $exists: false } }, { expiresAtBs: null }, { expiresAtBs: "" }, { expiresAtBs: { $gte: todayBs } }]
});

const buildStudentNoticeScope = (classId: string, sectionId: string, enrolledSubjectIds: Types.ObjectId[]) => ({
  $or: [
    {
      $and: [
        { $or: [{ subjectId: { $exists: false } }, { subjectId: null }] },
        { $or: [{ classId: { $exists: false } }, { classId: null }] }
      ]
    },
    {
      $and: [
        { $or: [{ subjectId: { $exists: false } }, { subjectId: null }] },
        { classId },
        { $or: [{ sectionId: { $exists: false } }, { sectionId: null }, { sectionId }] }
      ]
    },
    {
      subjectId: { $in: enrolledSubjectIds },
      classId,
      $or: [{ sectionId: { $exists: false } }, { sectionId: null }, { sectionId }]
    }
  ]
});

const enrichNotices = async (notices: NoticeLean[]) => {
  const userIds = [...new Set(notices.map((notice) => notice.createdBy.toString()))];
  const teacherIds = [...new Set(notices.map((notice) => notice.teacherId?.toString()).filter(Boolean))] as string[];
  const subjectIds = [...new Set(notices.map((notice) => notice.subjectId?.toString()).filter(Boolean))] as string[];

  const [users, teachers, subjects] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select("fullName role").lean(),
    Teacher.find({ _id: { $in: teacherIds } })
      .populate("user", "fullName")
      .lean(),
    Subject.find({ _id: { $in: subjectIds } }).select("name code").lean()
  ]);

  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  const teacherById = new Map(teachers.map((teacher) => [teacher._id.toString(), teacher]));
  const subjectById = new Map(subjects.map((subject) => [subject._id.toString(), subject]));

  return notices.map((notice) => {
    const teacher = notice.teacherId ? teacherById.get(notice.teacherId.toString()) : undefined;
    const creator = userById.get(notice.createdBy.toString());
    const subject = notice.subjectId ? subjectById.get(notice.subjectId.toString()) : undefined;
    const teacherName = (teacher?.user as { fullName?: string } | null)?.fullName;

    return {
      ...notice,
      _id: notice._id.toString(),
      schoolId: notice.schoolId.toString(),
      subjectId: notice.subjectId?.toString(),
      classId: notice.classId?.toString(),
      sectionId: notice.sectionId?.toString(),
      teacherId: notice.teacherId?.toString(),
      createdBy: notice.createdBy.toString(),
      authorName: teacherName ?? creator?.fullName ?? "School Administration",
      subjectName: subject?.name
    };
  });
};

export const listNotices = asyncHandler(async (req: Request, res: Response) => {
  const adminLike = req.user?.role === "SCHOOL_ADMIN" || req.user?.role === "SUPER_ADMIN";
  const schoolId = tenantObjectId(req);

  if (adminLike) {
    const notices = await Notice.find(withTenantScope(req)).sort({ publishDateBs: -1 });
    return sendSuccess(res, "Notices fetched", notices);
  }

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    const notices = await Notice.find({
      schoolId,
      teacherId: teacherScope.teacherId,
      visibleTo: "STUDENT"
    }).sort({ publishDateBs: -1 });
    return sendSuccess(res, "Notices fetched", notices);
  }

  const todayBs = getTodayBs();
  const activeNoticeFilter = buildActiveNoticeFilter(todayBs);

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    const enrolledSubjectIds = await Subject.find({ schoolId, classIds: studentProfile.classId }).distinct("_id");
    const notices = await Notice.find({
      schoolId,
      visibleTo: "STUDENT",
      ...activeNoticeFilter,
      ...buildStudentNoticeScope(studentProfile.classId, studentProfile.sectionId, enrolledSubjectIds)
    })
      .sort({ publishDateBs: -1, createdAt: -1 })
      .lean();
    return sendSuccess(res, "Notices fetched", await enrichNotices(notices as NoticeLean[]));
  }

  if (req.user?.role === "PARENT") {
    const studentIds = await getLinkedStudentIds(req);
    const { Student } = await import("../models/Student.js");
    const students = await Student.find({ _id: { $in: studentIds } }).lean();
    const classIds = [...new Set(students.map((student) => student.classId.toString()))];
    const sectionIds = [...new Set(students.map((student) => student.sectionId.toString()))];
    const enrolledSubjectIds = await Subject.find({ schoolId, classIds: { $in: classIds } }).distinct("_id");

    const notices = await Notice.find({
      schoolId,
      visibleTo: "PARENT",
      ...activeNoticeFilter,
      $or: [
        {
          $and: [
            { $or: [{ subjectId: { $exists: false } }, { subjectId: null }] },
            { $or: [{ classId: { $exists: false } }, { classId: null }] }
          ]
        },
        {
          $and: [
            { $or: [{ subjectId: { $exists: false } }, { subjectId: null }] },
            { classId: { $in: classIds } },
            { $or: [{ sectionId: { $exists: false } }, { sectionId: null }, { sectionId: { $in: sectionIds } }] }
          ]
        },
        {
          subjectId: { $in: enrolledSubjectIds },
          classId: { $in: classIds },
          $or: [{ sectionId: { $exists: false } }, { sectionId: null }, { sectionId: { $in: sectionIds } }]
        }
      ]
    })
      .sort({ publishDateBs: -1, createdAt: -1 })
      .lean();
    return sendSuccess(res, "Notices fetched", await enrichNotices(notices as NoticeLean[]));
  }

  const notices = await Notice.find({
    ...withTenantScope(req, { visibleTo: req.user?.role }),
    ...activeNoticeFilter
  })
    .sort({ publishDateBs: -1, createdAt: -1 })
    .lean();
  return sendSuccess(res, "Notices fetched", await enrichNotices(notices as NoticeLean[]));
});

export const createNotice = asyncHandler(async (req: Request, res: Response) => {
  const payload = noticeSchema.parse(req.body);
  ensureValidBsDate(payload.publishDateBs);
  if (payload.expiresAtBs) ensureValidBsDate(payload.expiresAtBs);

  let teacherId: string | undefined;

  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    teacherId = scope.teacherId;
    payload.visibleTo = ["STUDENT"];

    if (payload.subjectId) {
      await assertTeacherSubject(req, payload.subjectId);
    }
    if (payload.classId && payload.sectionId) {
      await assertTeacherClassSection(req, payload.classId, payload.sectionId);
    }
  }

  const notice = await Notice.create({
    ...payload,
    schoolId: tenantObjectId(req),
    expiresAtBs: payload.expiresAtBs || undefined,
    teacherId,
    createdBy: req.user?.userId
  });

  return sendSuccess(res, "Notice created successfully", notice, 201);
});

export const updateNotice = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    const existing = await Notice.findOne(withTenantScope(req, { _id: req.params.id })).lean();
    if (!existing || existing.teacherId?.toString() !== scope.teacherId) {
      throw new ApiError(403, "You can only update your own notices");
    }
  }

  const payload = noticeSchema.parse(req.body);
  ensureValidBsDate(payload.publishDateBs);
  if (payload.expiresAtBs) ensureValidBsDate(payload.expiresAtBs);

  if (req.user?.role === "TEACHER") {
    payload.visibleTo = ["STUDENT"];
    if (payload.subjectId) await assertTeacherSubject(req, payload.subjectId);
    if (payload.classId && payload.sectionId) await assertTeacherClassSection(req, payload.classId, payload.sectionId);
  }

  const notice = await Notice.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    {
      ...payload,
      expiresAtBs: payload.expiresAtBs || undefined
    },
    { new: true }
  );

  if (!notice) {
    throw new ApiError(404, "Notice not found");
  }

  return sendSuccess(res, "Notice updated successfully", notice);
});

export const deleteNotice = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role === "TEACHER") {
    const scope = await requireTeacherScope(req);
    const existing = await Notice.findOne(withTenantScope(req, { _id: req.params.id })).lean();
    if (!existing || existing.teacherId?.toString() !== scope.teacherId) {
      throw new ApiError(403, "You can only delete your own notices");
    }
  }

  const notice = await Notice.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));

  if (!notice) {
    throw new ApiError(404, "Notice not found");
  }

  return sendSuccess(res, "Notice deleted successfully");
});