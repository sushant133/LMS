import type { Request, Response } from "express";
import { leaveRequestSchema, leaveStatusSchema, payrollSchema } from "@nepal-school-erp/shared";
import { LeaveRequest, Payroll } from "../models/LeaveRequest.js";
import { Teacher } from "../models/Teacher.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { sendNotification } from "../utils/notificationService.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

export const listLeaveRequests = asyncHandler(async (req: Request, res: Response) => {
  const filter = withTenantScope(req);
  if (req.user?.role === "TEACHER") {
    const teacher = await Teacher.findOne({ schoolId: tenantObjectId(req), user: req.user.userId }).lean();
    if (teacher) filter.teacherId = teacher._id;
  }
  const leaves = await LeaveRequest.find(filter)
    .populate({ path: "teacherId", populate: { path: "user", select: "-password" } })
    .sort({ createdAt: -1 });
  return sendSuccess(res, "Leave requests fetched", leaves);
});

export const createLeaveRequest = asyncHandler(async (req: Request, res: Response) => {
  const payload = leaveRequestSchema.parse(req.body);
  const leave = await LeaveRequest.create({ ...payload, schoolId: req.tenantSchoolId });
  return sendSuccess(res, "Leave request submitted", leave, 201);
});

export const updateLeaveStatus = asyncHandler(async (req: Request, res: Response) => {
  const payload = leaveStatusSchema.parse(req.body);
  const leave = await LeaveRequest.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    { status: payload.status, approvedBy: req.user?.userId },
    { new: true }
  ).populate({ path: "teacherId", populate: { path: "user", select: "-password" } });

  if (!leave) throw new ApiError(404, "Leave request not found");

  const teacher = leave.teacherId as { user?: { _id?: { toString(): string } } } | null;
  if (teacher?.user?._id) {
    await sendNotification({
      schoolId: req.tenantSchoolId!,
      recipientUserId: teacher.user._id.toString(),
      title: `Leave ${payload.status.toLowerCase()}`,
      message: `Your leave request from ${leave.startDateBs} to ${leave.endDateBs} was ${payload.status.toLowerCase()}.`,
      type: "PAYROLL",
      channel: "BOTH"
    });
  }

  return sendSuccess(res, "Leave status updated", leave);
});

export const listPayroll = asyncHandler(async (req: Request, res: Response) => {
  const filter = withTenantScope(req);
  if (typeof req.query.monthBs === "string") filter.monthBs = req.query.monthBs;
  if (req.user?.role === "TEACHER") {
    const teacher = await Teacher.findOne({ schoolId: tenantObjectId(req), user: req.user.userId }).lean();
    if (teacher) filter.teacherId = teacher._id;
  }
  const payrolls = await Payroll.find(filter)
    .populate({ path: "teacherId", populate: { path: "user", select: "-password" } })
    .sort({ monthBs: -1 });
  return sendSuccess(res, "Payroll records fetched", payrolls);
});

export const createPayroll = asyncHandler(async (req: Request, res: Response) => {
  const payload = payrollSchema.parse(req.body);
  const netSalaryNpr = payload.basicSalaryNpr + payload.allowancesNpr - payload.deductionsNpr;
  const payroll = await Payroll.create({
    ...payload,
    schoolId: req.tenantSchoolId,
    netSalaryNpr
  });

  const teacher = await Teacher.findById(payload.teacherId).lean();
  if (teacher?.user) {
    await sendNotification({
      schoolId: req.tenantSchoolId!,
      recipientUserId: teacher.user.toString(),
      title: "Salary processed",
      message: `Payroll for ${payload.monthBs}: NPR ${netSalaryNpr.toLocaleString()}`,
      type: "PAYROLL",
      channel: "BOTH"
    });
  }

  return sendSuccess(res, "Payroll record created", payroll, 201);
});

export const updatePayroll = asyncHandler(async (req: Request, res: Response) => {
  const payload = payrollSchema.partial().parse(req.body);
  const existing = await Payroll.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!existing) throw new ApiError(404, "Payroll record not found");

  const basic = payload.basicSalaryNpr ?? existing.basicSalaryNpr;
  const allowances = payload.allowancesNpr ?? existing.allowancesNpr;
  const deductions = payload.deductionsNpr ?? existing.deductionsNpr;

  const payroll = await Payroll.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    { ...payload, netSalaryNpr: basic + allowances - deductions },
    { new: true }
  );

  return sendSuccess(res, "Payroll record updated", payroll);
});