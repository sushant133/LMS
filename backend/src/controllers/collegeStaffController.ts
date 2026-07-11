import type { Request, Response } from "express";
import type { Types } from "mongoose";
import {
  COLLEGE_STAFF_CATEGORY_LABELS,
  COLLEGE_STAFF_CATEGORY_ROLES,
  collegeStaffPasswordResetSchema,
  collegeStaffReportQuerySchema,
  collegeStaffSchema,
  type CollegeStaffCategory,
  type UserRole
} from "@phit-erp/shared";
import { Accountant } from "../models/Accountant.js";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import {
  buildCredentialsAdminMessage,
  notifyAccountCredentials,
  resolvePortalPassword
} from "../utils/credentialEmail.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { throwIfDuplicateKey } from "../utils/mongoErrors.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import {
  abortTransaction,
  commitTransaction,
  createSession,
  endSession,
  getSessionOption
} from "../utils/transaction.js";

type CollegeStaffLean = {
  _id: Types.ObjectId;
  schoolId: Types.ObjectId;
  user?: Types.ObjectId;
  staffId: string;
  fullName: string;
  photoUrl?: string;
  gender: string;
  dateOfBirthBs?: string;
  phone: string;
  email?: string;
  address: {
    province: string;
    district: string;
    municipality: string;
    ward: string;
    streetAddress: string;
  };
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  joinedDateBs: string;
  designation: string;
  department?: string;
  category: CollegeStaffCategory;
  customRoleLabel?: string;
  qualification?: string;
  experienceYears?: number;
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN";
  basicSalaryNpr: number;
  remarks?: string;
  status: "ACTIVE" | "INACTIVE";
  enableLogin: boolean;
  credentialsEmailStatus?: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  credentialsEmailError?: string;
  credentialsEmailSentAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

const emptyToUndef = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const roleForCategory = (category: CollegeStaffCategory): UserRole =>
  COLLEGE_STAFF_CATEGORY_ROLES[category] ?? "COLLEGE_STAFF";

const serializeStaff = async (staff: CollegeStaffLean) => {
  const user = staff.user
    ? await User.findById(staff.user).select("-password").lean()
    : null;

  return {
    _id: staff._id.toString(),
    schoolId: staff.schoolId.toString(),
    user: user
      ? {
          _id: user._id.toString(),
          schoolId: user.schoolId?.toString(),
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          phone: user.phone,
          isActive: user.isActive,
          mustChangePassword: user.mustChangePassword
        }
      : undefined,
    staffId: staff.staffId,
    fullName: staff.fullName,
    photoUrl: staff.photoUrl,
    gender: staff.gender,
    dateOfBirthBs: staff.dateOfBirthBs,
    phone: staff.phone,
    email: staff.email,
    address: staff.address,
    emergencyContactName: staff.emergencyContactName,
    emergencyContactPhone: staff.emergencyContactPhone,
    joinedDateBs: staff.joinedDateBs,
    designation: staff.designation,
    department: staff.department,
    category: staff.category,
    customRoleLabel: staff.customRoleLabel,
    qualification: staff.qualification,
    experienceYears: staff.experienceYears ?? 0,
    employmentType: staff.employmentType,
    basicSalaryNpr: staff.basicSalaryNpr,
    remarks: staff.remarks,
    status: staff.status,
    enableLogin: staff.enableLogin,
    credentialsEmailStatus: staff.credentialsEmailStatus,
    credentialsEmailError: staff.credentialsEmailError,
    credentialsEmailSentAt: staff.credentialsEmailSentAt?.toISOString(),
    createdAt: staff.createdAt?.toISOString(),
    updatedAt: staff.updatedAt?.toISOString()
  };
};

const enrichStaffList = async (records: CollegeStaffLean[]) =>
  Promise.all(records.map((record) => serializeStaff(record)));

const syncAccountantProfile = async (params: {
  schoolId: Types.ObjectId | string;
  userId: Types.ObjectId;
  staffId: string;
  gender: string;
  address: CollegeStaffLean["address"];
  joinedDateBs: string;
  photoUrl?: string;
  status: "ACTIVE" | "INACTIVE";
  session: Awaited<ReturnType<typeof createSession>> | null;
}) => {
  const existing = await Accountant.findOne({ user: params.userId }).session(params.session);
  if (existing) {
    existing.employeeId = params.staffId;
    existing.gender = params.gender;
    existing.address = params.address;
    existing.joinedDateBs = params.joinedDateBs;
    existing.photoUrl = params.photoUrl;
    existing.status = params.status;
    existing.isDeleted = false;
    await existing.save(getSessionOption(params.session));
    return existing;
  }

  const [created] = await Accountant.create(
    [
      {
        schoolId: params.schoolId,
        user: params.userId,
        employeeId: params.staffId,
        gender: params.gender,
        address: params.address,
        joinedDateBs: params.joinedDateBs,
        photoUrl: params.photoUrl,
        status: params.status
      }
    ],
    getSessionOption(params.session)
  );
  return created;
};

const applyStaffProfileFields = (
  target: InstanceType<typeof CollegeStaff>,
  payload: Partial<{
    staffId: string;
    fullName: string;
    photoUrl?: string;
    gender: string;
    dateOfBirthBs?: string;
    phone: string;
    email?: string;
    address: CollegeStaffLean["address"];
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    joinedDateBs: string;
    designation: string;
    department?: string;
    category: CollegeStaffCategory;
    customRoleLabel?: string;
    qualification?: string;
    experienceYears?: number;
    employmentType: CollegeStaffLean["employmentType"];
    basicSalaryNpr: number;
    remarks?: string;
    status: "ACTIVE" | "INACTIVE";
    enableLogin: boolean;
  }>
) => {
  if (payload.staffId) target.staffId = payload.staffId;
  if (payload.fullName) target.fullName = payload.fullName;
  if (payload.photoUrl !== undefined) target.photoUrl = emptyToUndef(payload.photoUrl);
  if (payload.gender) target.gender = payload.gender;
  if (payload.dateOfBirthBs !== undefined) {
    target.dateOfBirthBs = emptyToUndef(payload.dateOfBirthBs);
  }
  if (payload.phone) target.phone = payload.phone;
  if (payload.email !== undefined) target.email = payload.email?.toLowerCase().trim();
  if (payload.address) target.address = payload.address;
  if (payload.emergencyContactName !== undefined) {
    target.emergencyContactName = emptyToUndef(payload.emergencyContactName);
  }
  if (payload.emergencyContactPhone !== undefined) {
    target.emergencyContactPhone = emptyToUndef(payload.emergencyContactPhone);
  }
  if (payload.joinedDateBs) target.joinedDateBs = payload.joinedDateBs;
  if (payload.designation) target.designation = payload.designation;
  if (payload.department !== undefined) target.department = emptyToUndef(payload.department);
  if (payload.category) target.category = payload.category;
  if (payload.customRoleLabel !== undefined) {
    target.customRoleLabel = emptyToUndef(payload.customRoleLabel);
  }
  if (payload.qualification !== undefined) {
    target.qualification = emptyToUndef(payload.qualification);
  }
  if (payload.experienceYears !== undefined) target.experienceYears = payload.experienceYears;
  if (payload.employmentType) target.employmentType = payload.employmentType;
  if (payload.basicSalaryNpr !== undefined) target.basicSalaryNpr = payload.basicSalaryNpr;
  if (payload.remarks !== undefined) target.remarks = emptyToUndef(payload.remarks);
  if (payload.status) target.status = payload.status;
  if (payload.enableLogin !== undefined) target.enableLogin = payload.enableLogin;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const listCollegeStaff = asyncHandler(async (req: Request, res: Response) => {
  const category = req.query.category as CollegeStaffCategory | undefined;
  const status = req.query.status as "ACTIVE" | "INACTIVE" | undefined;
  const department = typeof req.query.department === "string" ? req.query.department.trim() : "";
  const designation =
    typeof req.query.designation === "string" ? req.query.designation.trim() : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const accountStatus = typeof req.query.accountStatus === "string" ? req.query.accountStatus : "";

  const filter: Record<string, unknown> = { isDeleted: false };
  if (category && category in COLLEGE_STAFF_CATEGORY_ROLES) {
    filter.category = category;
  }
  if (status === "ACTIVE" || status === "INACTIVE") filter.status = status;
  if (department) filter.department = { $regex: escapeRegex(department), $options: "i" };
  if (designation) filter.designation = { $regex: escapeRegex(designation), $options: "i" };
  if (search) {
    const term = escapeRegex(search);
    filter.$or = [
      { staffId: { $regex: term, $options: "i" } },
      { fullName: { $regex: term, $options: "i" } },
      { email: { $regex: term, $options: "i" } },
      { phone: { $regex: term, $options: "i" } }
    ];
  }

  let staff = await CollegeStaff.find(withTenantScope(req, filter)).sort({ createdAt: -1 }).lean();

  if (accountStatus === "ACTIVE" || accountStatus === "INACTIVE") {
    const wantActive = accountStatus === "ACTIVE";
    const enriched = await enrichStaffList(staff as CollegeStaffLean[]);
    return sendSuccess(
      res,
      "College staff fetched",
      enriched.filter((item) => Boolean(item.user?.isActive) === wantActive)
    );
  }

  return sendSuccess(res, "College staff fetched", await enrichStaffList(staff as CollegeStaffLean[]));
});

export const getCollegeStaffById = asyncHandler(async (req: Request, res: Response) => {
  const staff = await CollegeStaff.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  ).lean();
  if (!staff) {
    throw new ApiError(404, "College staff not found");
  }
  return sendSuccess(res, "College staff fetched", await serializeStaff(staff as CollegeStaffLean));
});

export const getMyCollegeStaffProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.userId) {
    throw new ApiError(401, "Authentication required");
  }

  const staff = await CollegeStaff.findOne(
    withTenantScope(req, { user: req.user.userId, isDeleted: false })
  ).lean();

  if (!staff) {
    throw new ApiError(404, "Staff profile not found");
  }

  return sendSuccess(res, "Staff profile fetched", await serializeStaff(staff as CollegeStaffLean));
});

export const createCollegeStaff = asyncHandler(async (req: Request, res: Response) => {
  const payload = collegeStaffSchema.parse(req.body);
  ensureValidBsDate(payload.joinedDateBs);
  if (payload.dateOfBirthBs) ensureValidBsDate(payload.dateOfBirthBs);

  const email = payload.email.toLowerCase().trim();
  const role = roleForCategory(payload.category);
  const schoolId = tenantObjectId(req);

  const session = await createSession();
  try {
    const existingUser = await User.findOne({ email }).session(session);
    if (existingUser) {
      throw new ApiError(409, "A user with this email already exists");
    }

    const resolved = resolvePortalPassword(payload.password);
    const [user] = await User.create(
      [
        {
          schoolId,
          fullName: payload.fullName,
          email,
          phone: payload.phone,
          password: resolved.password,
          role,
          isActive: payload.status === "ACTIVE",
          mustChangePassword: resolved.wasGenerated
        }
      ],
      getSessionOption(session)
    );

    const [staff] = await CollegeStaff.create(
      [
        {
          schoolId,
          user: user!._id,
          staffId: payload.staffId,
          fullName: payload.fullName,
          photoUrl: emptyToUndef(payload.photoUrl),
          gender: payload.gender,
          dateOfBirthBs: emptyToUndef(payload.dateOfBirthBs),
          phone: payload.phone,
          email,
          address: payload.address,
          emergencyContactName: emptyToUndef(payload.emergencyContactName),
          emergencyContactPhone: emptyToUndef(payload.emergencyContactPhone),
          joinedDateBs: payload.joinedDateBs,
          designation: payload.designation,
          department: emptyToUndef(payload.department),
          category: payload.category,
          customRoleLabel: emptyToUndef(payload.customRoleLabel),
          qualification: emptyToUndef(payload.qualification),
          experienceYears: payload.experienceYears ?? 0,
          employmentType: payload.employmentType,
          basicSalaryNpr: payload.basicSalaryNpr,
          remarks: emptyToUndef(payload.remarks),
          status: payload.status,
          enableLogin: true,
          credentialsEmailStatus: "PENDING"
        }
      ],
      getSessionOption(session)
    );

    if (payload.category === "ACCOUNTANT") {
      await syncAccountantProfile({
        schoolId,
        userId: user!._id,
        staffId: payload.staffId,
        gender: payload.gender,
        address: payload.address,
        joinedDateBs: payload.joinedDateBs,
        photoUrl: emptyToUndef(payload.photoUrl),
        status: payload.status,
        session
      });
    }

    await commitTransaction(session);

    const credentialsEmail = await notifyAccountCredentials({
      userId: user!._id.toString(),
      fullName: payload.fullName,
      email,
      password: resolved.password,
      schoolId: schoolId.toString(),
      req
    });

    await CollegeStaff.findByIdAndUpdate(staff!._id, {
      credentialsEmailStatus: credentialsEmail.sent
        ? "SENT"
        : credentialsEmail.skipped
          ? "SKIPPED"
          : "FAILED",
      credentialsEmailError: credentialsEmail.error,
      credentialsEmailSentAt: credentialsEmail.sent ? new Date() : undefined
    });

    const refreshed = await CollegeStaff.findById(staff!._id).lean();
    const serialized = await serializeStaff(refreshed as CollegeStaffLean);

    await recordAudit(req, {
      action: "CREATE",
      entity: "CollegeStaff",
      entityId: staff!._id.toString(),
      after: serialized
    });

    return sendSuccess(
      res,
      buildCredentialsAdminMessage(credentialsEmail),
      {
        staff: serialized,
        loginEmail: email,
        defaultPassword: resolved.password,
        credentialsEmail
      },
      201
    );
  } catch (error) {
    await abortTransaction(session);
    throwIfDuplicateKey(error);
    throw error;
  } finally {
    await endSession(session);
  }
});

export const updateCollegeStaff = asyncHandler(async (req: Request, res: Response) => {
  const payload = collegeStaffSchema.partial().parse(req.body);
  if (payload.joinedDateBs) ensureValidBsDate(payload.joinedDateBs);
  if (payload.dateOfBirthBs) ensureValidBsDate(payload.dateOfBirthBs);

  const existing = await CollegeStaff.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!existing) {
    throw new ApiError(404, "College staff not found");
  }

  const before = existing.toObject();
  const nextCategory = (payload.category ?? existing.category) as CollegeStaffCategory;
  const nextRole = roleForCategory(nextCategory);
  let createdLoginEmail: string | undefined;
  let createdDefaultPassword: string | undefined;
  let credentialsEmail: Awaited<ReturnType<typeof notifyAccountCredentials>> | undefined;

  if (existing.user) {
    const user = await User.findById(existing.user);
    if (user) {
      if (payload.fullName) user.fullName = payload.fullName;
      if (payload.phone) user.phone = payload.phone;
      if (payload.password) {
        user.password = payload.password;
        user.mustChangePassword = false;
      }
      if (payload.email) {
        const email = payload.email.toLowerCase().trim();
        const duplicate = await User.findOne({ email, _id: { $ne: user._id } });
        if (duplicate) throw new ApiError(409, "A user with this email already exists");
        user.email = email;
      }
      user.role = nextRole;
      if (payload.status) {
        user.isActive = payload.status === "ACTIVE";
      }
      if (payload.enableLogin === false) {
        user.isActive = false;
      } else if (
        payload.enableLogin === true &&
        (payload.status ?? existing.status) === "ACTIVE"
      ) {
        user.isActive = true;
      }
      await user.save();
    }
  } else {
    // Ensure login account exists (required for all non-teaching staff)
    const email = (payload.email ?? existing.email)?.toLowerCase().trim();
    if (!email) {
      throw new ApiError(400, "Email is required to create staff login");
    }
    const duplicate = await User.findOne({ email });
    if (duplicate) throw new ApiError(409, "A user with this email already exists");

    const resolved = resolvePortalPassword(payload.password);
    const user = await User.create({
      schoolId: tenantObjectId(req),
      fullName: payload.fullName ?? existing.fullName,
      email,
      phone: payload.phone ?? existing.phone,
      password: resolved.password,
      role: nextRole,
      isActive: (payload.status ?? existing.status) === "ACTIVE",
      mustChangePassword: resolved.wasGenerated
    });
    existing.user = user._id;
    existing.enableLogin = true;
    createdLoginEmail = email;
    createdDefaultPassword = resolved.password;

    credentialsEmail = await notifyAccountCredentials({
      userId: user._id.toString(),
      fullName: user.fullName,
      email,
      password: resolved.password,
      schoolId: tenantObjectId(req).toString(),
      req
    });

    existing.credentialsEmailStatus = credentialsEmail.sent
      ? "SENT"
      : credentialsEmail.skipped
        ? "SKIPPED"
        : "FAILED";
    existing.credentialsEmailError = credentialsEmail.error;
    if (credentialsEmail.sent) existing.credentialsEmailSentAt = new Date();
  }

  const previousCategory = existing.category as CollegeStaffCategory;
  applyStaffProfileFields(existing, payload);

  try {
    await existing.save();
  } catch (error) {
    throwIfDuplicateKey(error);
    throw error;
  }

  if (existing.user) {
    const userId = existing.user as Types.ObjectId;
    if (nextCategory === "ACCOUNTANT") {
      await syncAccountantProfile({
        schoolId: existing.schoolId,
        userId,
        staffId: existing.staffId,
        gender: existing.gender,
        address: existing.address as CollegeStaffLean["address"],
        joinedDateBs: existing.joinedDateBs,
        photoUrl: existing.photoUrl ?? undefined,
        status: existing.status as "ACTIVE" | "INACTIVE",
        session: null
      });
    } else if (previousCategory === "ACCOUNTANT") {
      // Role moved away from finance — deactivate linked accountant profile, keep user.
      await Accountant.findOneAndUpdate(
        { user: userId },
        { isDeleted: true, status: "INACTIVE" }
      );
    }
  }

  const serialized = await serializeStaff(existing.toObject() as CollegeStaffLean);

  await recordAudit(req, {
    action: "UPDATE",
    entity: "CollegeStaff",
    entityId: existing._id.toString(),
    before,
    after: serialized
  });

  if (createdLoginEmail && createdDefaultPassword) {
    const emailResult = credentialsEmail ?? {
      sent: false,
      email: createdLoginEmail,
      error: "Credential email was not sent"
    };
    return sendSuccess(res, buildCredentialsAdminMessage(emailResult), {
      staff: serialized,
      loginEmail: createdLoginEmail,
      defaultPassword: createdDefaultPassword,
      credentialsEmail: emailResult
    });
  }

  return sendSuccess(res, "College staff updated", serialized);
});

export const setCollegeStaffStatus = asyncHandler(async (req: Request, res: Response) => {
  const status = req.body?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  const staff = await CollegeStaff.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!staff) {
    throw new ApiError(404, "College staff not found");
  }

  staff.status = status;
  if (status === "INACTIVE") {
    staff.enableLogin = false;
  } else {
    staff.enableLogin = true;
  }
  await staff.save();

  if (staff.user) {
    await User.findByIdAndUpdate(staff.user, { isActive: status === "ACTIVE" });
    if (staff.category === "ACCOUNTANT") {
      await Accountant.findOneAndUpdate(
        { user: staff.user },
        { status, isDeleted: status === "INACTIVE" }
      );
    }
  }

  await recordAudit(req, {
    action: status === "ACTIVE" ? "ACTIVATE" : "DEACTIVATE",
    entity: "CollegeStaff",
    entityId: staff._id.toString(),
    after: { status }
  });

  return sendSuccess(
    res,
    status === "ACTIVE" ? "Staff activated" : "Staff deactivated",
    await serializeStaff(staff.toObject() as CollegeStaffLean)
  );
});

export const resetCollegeStaffPassword = asyncHandler(async (req: Request, res: Response) => {
  const payload = collegeStaffPasswordResetSchema.parse(req.body ?? {});
  const staff = await CollegeStaff.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!staff) {
    throw new ApiError(404, "College staff not found");
  }
  if (!staff.user) {
    throw new ApiError(400, "Staff does not have a login account");
  }

  const user = await User.findById(staff.user);
  if (!user) {
    throw new ApiError(404, "Login account not found");
  }

  const resolved = resolvePortalPassword(payload.password);
  user.password = resolved.password;
  user.mustChangePassword = resolved.wasGenerated;
  user.isActive = staff.status === "ACTIVE";
  await user.save();

  const credentialsEmail = await notifyAccountCredentials({
    userId: user._id.toString(),
    fullName: staff.fullName,
    email: user.email,
    password: resolved.password,
    schoolId: tenantObjectId(req).toString(),
    req,
    emailType: "PASSWORD_RESET"
  });

  staff.credentialsEmailStatus = credentialsEmail.sent
    ? "SENT"
    : credentialsEmail.skipped
      ? "SKIPPED"
      : "FAILED";
  staff.credentialsEmailError = credentialsEmail.error;
  if (credentialsEmail.sent) staff.credentialsEmailSentAt = new Date();
  await staff.save();

  await recordAudit(req, {
    action: "RESET_PASSWORD",
    entity: "CollegeStaff",
    entityId: staff._id.toString()
  });

  return sendSuccess(res, buildCredentialsAdminMessage(credentialsEmail), {
    loginEmail: user.email,
    defaultPassword: resolved.password,
    credentialsEmail,
    staff: await serializeStaff(staff.toObject() as CollegeStaffLean)
  });
});

export const resendCollegeStaffCredentials = asyncHandler(async (req: Request, res: Response) => {
  const staff = await CollegeStaff.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!staff) {
    throw new ApiError(404, "College staff not found");
  }
  if (!staff.user) {
    throw new ApiError(400, "Staff does not have a login account");
  }

  // Delegate to the shared user credentials resend by generating a new password
  const resolved = resolvePortalPassword(undefined);
  const user = await User.findById(staff.user);
  if (!user) {
    throw new ApiError(404, "Login account not found");
  }

  user.password = resolved.password;
  user.mustChangePassword = true;
  await user.save();

  const credentialsEmail = await notifyAccountCredentials({
    userId: user._id.toString(),
    fullName: staff.fullName,
    email: user.email,
    password: resolved.password,
    schoolId: tenantObjectId(req).toString(),
    req
  });

  staff.credentialsEmailStatus = credentialsEmail.sent
    ? "SENT"
    : credentialsEmail.skipped
      ? "SKIPPED"
      : "FAILED";
  staff.credentialsEmailError = credentialsEmail.error;
  if (credentialsEmail.sent) staff.credentialsEmailSentAt = new Date();
  await staff.save();

  return sendSuccess(res, buildCredentialsAdminMessage(credentialsEmail), {
    loginEmail: user.email,
    defaultPassword: resolved.password,
    credentialsEmail
  });
});

export const deleteCollegeStaff = asyncHandler(async (req: Request, res: Response) => {
  const staff = await CollegeStaff.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!staff) {
    throw new ApiError(404, "College staff not found");
  }

  const before = staff.toObject();
  staff.isDeleted = true;
  staff.status = "INACTIVE";
  staff.enableLogin = false;
  staff.staffId = `${staff.staffId}__deleted__${staff._id.toString().slice(-6)}`;
  await staff.save();

  if (staff.user) {
    await User.findByIdAndUpdate(staff.user, { isActive: false });
    if (staff.category === "ACCOUNTANT") {
      await Accountant.findOneAndUpdate({ user: staff.user }, { isDeleted: true, status: "INACTIVE" });
    }
  }

  await recordAudit(req, {
    action: "DELETE",
    entity: "CollegeStaff",
    entityId: staff._id.toString(),
    before
  });

  return sendSuccess(res, "College staff deleted");
});

export const getCollegeStaffReports = asyncHandler(async (req: Request, res: Response) => {
  const query = collegeStaffReportQuerySchema.parse({
    reportType: req.query.reportType,
    category: req.query.category || undefined,
    format: req.query.format || "json"
  });

  const filter: Record<string, unknown> = { isDeleted: false };
  if (query.category) filter.category = query.category;
  if (query.reportType === "ACTIVE") filter.status = "ACTIVE";
  if (query.reportType === "INACTIVE") filter.status = "INACTIVE";

  const staff = (await CollegeStaff.find(withTenantScope(req, filter))
    .sort({ fullName: 1 })
    .lean()) as CollegeStaffLean[];
  const enriched = await enrichStaffList(staff);

  let rows: Record<string, unknown>[] = [];
  const summary: Record<string, number | string> = {};

  switch (query.reportType) {
    case "DIRECTORY":
    case "ACTIVE":
    case "INACTIVE":
      rows = enriched.map((s) => ({
        staffId: s.staffId,
        name: s.fullName,
        role: COLLEGE_STAFF_CATEGORY_LABELS[s.category] ?? s.category,
        customRole: s.customRoleLabel ?? "",
        department: s.department ?? "",
        designation: s.designation,
        email: s.email ?? s.user?.email ?? "",
        phone: s.phone,
        status: s.status,
        joined: s.joinedDateBs
      }));
      break;
    case "ROLE_WISE": {
      const byRole = new Map<string, number>();
      for (const s of enriched) {
        const label = COLLEGE_STAFF_CATEGORY_LABELS[s.category] ?? s.category;
        byRole.set(label, (byRole.get(label) ?? 0) + 1);
      }
      rows = [...byRole.entries()].map(([role, count]) => ({ role, count }));
      break;
    }
    case "DEPARTMENT_WISE": {
      const byDept = new Map<string, number>();
      for (const s of enriched) {
        const dept = s.department?.trim() || "Unassigned";
        byDept.set(dept, (byDept.get(dept) ?? 0) + 1);
      }
      rows = [...byDept.entries()].map(([department, count]) => ({ department, count }));
      break;
    }
    case "LOGIN_ACCOUNTS":
      rows = enriched.map((s) => ({
        staffId: s.staffId,
        name: s.fullName,
        loginId: s.user?.email ?? s.email ?? "",
        role: s.user?.role ?? roleForCategory(s.category),
        accountActive: s.user?.isActive ? "Yes" : "No",
        employmentStatus: s.status
      }));
      break;
    case "EMAIL_DELIVERY":
      rows = enriched.map((s) => ({
        staffId: s.staffId,
        name: s.fullName,
        email: s.email ?? s.user?.email ?? "",
        deliveryStatus: s.credentialsEmailStatus ?? "PENDING",
        error: s.credentialsEmailError ?? "",
        sentAt: s.credentialsEmailSentAt ?? ""
      }));
      break;
    default:
      rows = [];
  }

  summary.rowCount = rows.length;
  summary.activeCount = enriched.filter((s) => s.status === "ACTIVE").length;
  summary.inactiveCount = enriched.filter((s) => s.status === "INACTIVE").length;

  if (query.format === "csv") {
    const headers = rows.length > 0 ? Object.keys(rows[0]!) : ["message"];
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      headers.join(","),
      ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="staff-report-${query.reportType.toLowerCase()}.csv"`
    );
    return res.send("\uFEFF" + lines.join("\n"));
  }

  return sendSuccess(res, "College staff report generated", {
    reportType: query.reportType,
    generatedAt: new Date().toISOString(),
    rows,
    summary
  });
});
