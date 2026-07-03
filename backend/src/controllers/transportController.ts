import type { Request, Response } from "express";
import { transportAssignmentSchema, transportRouteSchema } from "@nepal-school-erp/shared";
import { TransportAssignment, TransportRoute } from "../models/TransportRoute.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { notifyParentsOfStudent } from "../utils/notificationService.js";
import { sendSuccess } from "../utils/response.js";
import { withTenantScope } from "../utils/tenant.js";

export const listRoutes = asyncHandler(async (req: Request, res: Response) => {
  const routes = await TransportRoute.find(withTenantScope(req)).sort({ name: 1 });
  return sendSuccess(res, "Transport routes fetched", routes);
});

export const createRoute = asyncHandler(async (req: Request, res: Response) => {
  const payload = transportRouteSchema.parse(req.body);
  const route = await TransportRoute.create({ ...payload, schoolId: req.tenantSchoolId });
  return sendSuccess(res, "Transport route created", route, 201);
});

export const updateRoute = asyncHandler(async (req: Request, res: Response) => {
  const payload = transportRouteSchema.partial().parse(req.body);
  const route = await TransportRoute.findOneAndUpdate(withTenantScope(req, { _id: req.params.id }), payload, { new: true });
  if (!route) throw new ApiError(404, "Route not found");
  return sendSuccess(res, "Transport route updated", route);
});

export const deleteRoute = asyncHandler(async (req: Request, res: Response) => {
  const route = await TransportRoute.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!route) throw new ApiError(404, "Route not found");
  await TransportAssignment.deleteMany({ routeId: route._id });
  return sendSuccess(res, "Transport route deleted");
});

export const listAssignments = asyncHandler(async (req: Request, res: Response) => {
  const filter = withTenantScope(req);
  if (typeof req.query.routeId === "string") filter.routeId = req.query.routeId;
  const assignments = await TransportAssignment.find(filter).populate("routeId").populate("studentId");
  return sendSuccess(res, "Transport assignments fetched", assignments);
});

export const assignStudent = asyncHandler(async (req: Request, res: Response) => {
  const payload = transportAssignmentSchema.parse(req.body);
  const route = await TransportRoute.findOne(withTenantScope(req, { _id: payload.routeId }));
  if (!route) throw new ApiError(404, "Route not found");

  const assignment = await TransportAssignment.findOneAndUpdate(
    withTenantScope(req, { studentId: payload.studentId }),
    { ...payload, schoolId: req.tenantSchoolId },
    { upsert: true, new: true }
  );

  await notifyParentsOfStudent(
    req.tenantSchoolId!,
    payload.studentId,
    "Transport assigned",
    `${route.name} — pickup: ${payload.pickupStop}`,
    "TRANSPORT"
  );

  return sendSuccess(res, "Student assigned to route", assignment, 201);
});

export const removeAssignment = asyncHandler(async (req: Request, res: Response) => {
  const assignment = await TransportAssignment.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!assignment) throw new ApiError(404, "Assignment not found");
  return sendSuccess(res, "Transport assignment removed");
});