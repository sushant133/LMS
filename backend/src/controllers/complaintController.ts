import type { Request, Response } from "express";
import type { Types } from "mongoose";
import {
  canManageInstitution,
  COMPLAINANT_ROLES,
  createComplaintSchema,
  hasInstitutionAccess,
  normalizeUserRole,
  updateComplaintStatusSchema,
  type UserRole
} from "@phit-erp/shared";
import { Complaint } from "../models/Complaint.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { sendNotification } from "../utils/notificationService.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

type ComplaintLean = {
  _id: Types.ObjectId;
  schoolId: Types.ObjectId;
  submittedBy: Types.ObjectId;
  submitterRole: UserRole;
  subject: string;
  category: string;
  content: string;
  attachments: Array<{ url: string; name: string; mimeType?: string; kind?: string }>;
  status: string;
  adminResponse?: string;
  resolvedAt?: Date;
  resolvedBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

const isComplainantRole = (role: string): boolean => COMPLAINANT_ROLES.includes(normalizeUserRole(role));

const buildComplaintFilter = (req: Request, extra: Record<string, unknown> = {}): Record<string, unknown> => {
  const filter = withTenantScope(req, extra);
  if (!hasInstitutionAccess(req.user?.role ?? "")) {
    Object.assign(filter, { submittedBy: req.user?.userId });
  }
  return filter;
};

const enrichComplaints = async (complaints: ComplaintLean[], includeSubmitter = false) => {
  const userIds = new Set<string>();
  complaints.forEach((complaint) => {
    userIds.add(complaint.submittedBy.toString());
    if (complaint.resolvedBy) {
      userIds.add(complaint.resolvedBy.toString());
    }
  });

  const users = await User.find({ _id: { $in: [...userIds] } }).select("fullName role").lean();
  const userById = new Map(users.map((user) => [user._id.toString(), user]));

  return complaints.map((complaint) => {
    const submitter = userById.get(complaint.submittedBy.toString());
    const resolver = complaint.resolvedBy ? userById.get(complaint.resolvedBy.toString()) : undefined;

    return {
      ...complaint,
      _id: complaint._id.toString(),
      schoolId: complaint.schoolId.toString(),
      submittedBy: complaint.submittedBy.toString(),
      resolvedBy: complaint.resolvedBy?.toString(),
      submitterName: includeSubmitter ? submitter?.fullName ?? "Unknown User" : undefined,
      resolvedByName: resolver?.fullName,
      resolvedAt: complaint.resolvedAt?.toISOString()
    };
  });
};

const notifyCollegeAdmins = async (req: Request, subject: string, category: string) => {
  const schoolId = tenantObjectId(req);
  const admins = await User.find({
    schoolId,
    role: { $in: ["COLLEGE_ADMIN", "SUPER_ADMIN"] }
  })
    .select("_id")
    .lean();

  const submitter = await User.findById(req.user!.userId).select("fullName").lean();

  await Promise.all(
    admins.map((admin) =>
      sendNotification({
        schoolId: schoolId.toString(),
        recipientUserId: admin._id.toString(),
        title: "New complaint received",
        message: `${submitter?.fullName ?? "A user"} submitted a complaint about ${category}: ${subject}`,
        type: "COMPLAINT"
      })
    )
  );
};

export const listComplaints = asyncHandler(async (req: Request, res: Response) => {
  const canViewAll = hasInstitutionAccess(req.user?.role ?? "");
  const complaints = await Complaint.find(buildComplaintFilter(req)).sort({ createdAt: -1 }).limit(200).lean();
  const enriched = await enrichComplaints(complaints as ComplaintLean[], canViewAll);
  return sendSuccess(res, "Complaints fetched", enriched);
});

export const getComplaint = asyncHandler(async (req: Request, res: Response) => {
  const complaint = await Complaint.findOne(buildComplaintFilter(req, { _id: req.params.id })).lean();
  if (!complaint) {
    throw new ApiError(404, "Complaint not found");
  }

  const [enriched] = await enrichComplaints([complaint as ComplaintLean], hasInstitutionAccess(req.user?.role ?? ""));
  return sendSuccess(res, "Complaint fetched", enriched);
});

export const createComplaint = asyncHandler(async (req: Request, res: Response) => {
  const role = normalizeUserRole(req.user?.role ?? "");
  if (!isComplainantRole(role)) {
    throw new ApiError(403, "Your role cannot submit complaints");
  }

  const payload = createComplaintSchema.parse(req.body);
  const complaint = await Complaint.create({
    schoolId: tenantObjectId(req),
    submittedBy: req.user!.userId,
    submitterRole: role,
    subject: payload.subject,
    category: payload.category,
    content: payload.content,
    attachments: payload.attachments
  });

  await notifyCollegeAdmins(req, payload.subject, payload.category);

  const [enriched] = await enrichComplaints([complaint.toObject() as ComplaintLean]);
  return sendSuccess(res, "Complaint submitted successfully", enriched, 201);
});

export const updateComplaintStatus = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can update complaint status");
  }

  const payload = updateComplaintStatusSchema.parse(req.body);
  const resolvedStatuses = ["RESOLVED", "CLOSED"];
  const update: Record<string, unknown> = {
    status: payload.status,
    adminResponse: payload.adminResponse || undefined
  };
  const unset: Record<string, 1> = {};

  if (resolvedStatuses.includes(payload.status)) {
    update.resolvedAt = new Date();
    update.resolvedBy = req.user!.userId;
  } else {
    unset.resolvedAt = 1;
    unset.resolvedBy = 1;
  }

  const complaint = await Complaint.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    { $set: update, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { new: true }
  ).lean();
  if (!complaint) {
    throw new ApiError(404, "Complaint not found");
  }

  await sendNotification({
    schoolId: tenantObjectId(req).toString(),
    recipientUserId: complaint.submittedBy.toString(),
    title: "Complaint status updated",
    message: `Your complaint "${complaint.subject}" is now ${payload.status.replace(/_/g, " ").toLowerCase()}.`,
    type: "COMPLAINT"
  });

  const [enriched] = await enrichComplaints([complaint as ComplaintLean], true);
  return sendSuccess(res, "Complaint status updated", enriched);
});

export const deleteComplaint = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageInstitution(req.user?.role ?? "")) {
    throw new ApiError(403, "Only administrators can delete complaints");
  }

  const complaint = await Complaint.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!complaint) {
    throw new ApiError(404, "Complaint not found");
  }

  return sendSuccess(res, "Complaint deleted");
});