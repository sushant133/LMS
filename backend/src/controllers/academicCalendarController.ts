import type { Request, Response } from "express";
import {
  academicCalendarEventInputSchema,
  academicCalendarEventUpdateSchema,
  academicCalendarFiltersSchema
} from "@phit-erp/shared";
import { AcademicCalendarEvent } from "../models/AcademicCalendarEvent.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { recordAudit } from "../utils/audit.js";
import { ApiError } from "../utils/apiError.js";
import {
  buildAcademicCalendarDashboard,
  enrichEventById,
  inferAcademicYearFromDateBs,
  listAcademicCalendarEvents,
  listAcademicYears,
  prepareEventDateFields,
  resolveHolidayFlag
} from "../utils/academicCalendarService.js";
import {
  notifyCalendarEventCreated,
  notifyCalendarEventDeleted,
  notifyCalendarEventUpdated
} from "../utils/academicCalendarNotifications.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

const parseFilters = (req: Request) => {
  const parsed = academicCalendarFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid calendar filters");
  }
  return parsed.data;
};

export const getAcademicCalendarDashboard = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const academicYearBs = typeof req.query.academicYearBs === "string" ? req.query.academicYearBs : undefined;
  const dashboard = await buildAcademicCalendarDashboard(schoolId, academicYearBs);
  sendSuccess(res, "Academic calendar dashboard fetched", dashboard);
});

export const listAcademicCalendarYears = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const years = await listAcademicYears(schoolId);
  sendSuccess(res, "Academic years fetched", years);
});

export const listEvents = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const filters = parseFilters(req);
  const events = await listAcademicCalendarEvents(schoolId, filters);
  sendSuccess(res, "Calendar events fetched", events);
});

export const getEvent = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const eventId = String(req.params.id ?? "");
  const record = await enrichEventById(schoolId, eventId);
  if (!record) {
    throw new ApiError(404, "Calendar event not found");
  }
  sendSuccess(res, "Calendar event fetched", record);
});

export const createEvent = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const parsed = academicCalendarEventInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid event payload");
  }

  const payload = parsed.data;
  const startDateBs = ensureValidBsDate(payload.startDateBs);
  const endDateBs = ensureValidBsDate(payload.endDateBs);
  const academicYearBs = payload.academicYearBs || inferAcademicYearFromDateBs(startDateBs);
  const dateFields = prepareEventDateFields(startDateBs, endDateBs);
  const isWorkingDayOverride = payload.eventType === "WORKING_DAY";

  const created = await AcademicCalendarEvent.create({
    schoolId,
    academicYearBs,
    ...dateFields,
    name: payload.name,
    eventType: payload.eventType,
    reason: payload.reason,
    isHoliday: resolveHolidayFlag(payload.eventType),
    status: payload.status ?? "ACTIVE",
    isWorkingDayOverride,
    audit: { createdBy: req.user?.userId }
  });

  await recordAudit(req, {
    action: "academic_calendar.event.create",
    entity: "ACADEMIC_CALENDAR_EVENT",
    entityId: created._id.toString(),
    after: created.toObject()
  });

  const record = await enrichEventById(schoolId, created._id.toString());
  if (record) {
    await notifyCalendarEventCreated(schoolId.toString(), record);
  }
  sendSuccess(res, "Calendar event created", record, 201);
});

export const updateEvent = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const parsed = academicCalendarEventUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid event payload");
  }

  const eventId = String(req.params.id ?? "");
  const existing = await AcademicCalendarEvent.findOne({ _id: eventId, schoolId });
  if (!existing) {
    throw new ApiError(404, "Calendar event not found");
  }

  const before = existing.toObject();
  const payload = parsed.data;

  const nextStart = payload.startDateBs || payload.dateBs || existing.startDateBs || existing.dateBs;
  const nextEnd = payload.endDateBs || existing.endDateBs || nextStart;

  if (payload.startDateBs || payload.endDateBs || payload.dateBs) {
    const startDateBs = ensureValidBsDate(nextStart);
    const endDateBs = ensureValidBsDate(nextEnd);
    if (endDateBs < startDateBs) {
      throw new ApiError(400, "End date must be on or after the start date");
    }
    const dateFields = prepareEventDateFields(startDateBs, endDateBs);
    Object.assign(existing, dateFields);
    if (!payload.academicYearBs) {
      existing.academicYearBs = inferAcademicYearFromDateBs(startDateBs);
    }
  }

  if (payload.academicYearBs) existing.academicYearBs = payload.academicYearBs;
  if (payload.name) existing.name = payload.name;
  if (payload.eventType) {
    existing.eventType = payload.eventType;
    existing.isHoliday = resolveHolidayFlag(payload.eventType);
    existing.isWorkingDayOverride = payload.eventType === "WORKING_DAY";
  }
  if (payload.reason !== undefined) {
    existing.reason = payload.reason ?? undefined;
  }
  if (payload.status) {
    existing.status = payload.status;
  }

  existing.audit = {
    ...existing.audit,
    updatedBy: req.user?.userId as never
  };

  await existing.save();

  await recordAudit(req, {
    action: "academic_calendar.event.update",
    entity: "ACADEMIC_CALENDAR_EVENT",
    entityId: existing._id.toString(),
    before,
    after: existing.toObject()
  });

  const record = await enrichEventById(schoolId, existing._id.toString());
  if (record) {
    await notifyCalendarEventUpdated(schoolId.toString(), record);
  }
  sendSuccess(res, "Calendar event updated", record);
});

export const deleteEvent = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const eventId = String(req.params.id ?? "");
  const existing = await AcademicCalendarEvent.findOne({ _id: eventId, schoolId });
  if (!existing) {
    throw new ApiError(404, "Calendar event not found");
  }

  const before = existing.toObject();
  const start = existing.startDateBs || existing.dateBs;
  const end = existing.endDateBs || existing.dateBs;
  await notifyCalendarEventDeleted(schoolId.toString(), {
    name: existing.name,
    dateBs: start === end ? start : `${start} → ${end}`
  });
  await existing.deleteOne();

  await recordAudit(req, {
    action: "academic_calendar.event.delete",
    entity: "ACADEMIC_CALENDAR_EVENT",
    entityId: existing._id.toString(),
    before
  });

  sendSuccess(res, "Calendar event deleted", { deleted: true });
});
