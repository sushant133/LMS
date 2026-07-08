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
  inferAcademicYearFromDateBs,
  listAcademicCalendarEvents,
  listAcademicYears,
  resolveHolidayFlag
} from "../utils/academicCalendarService.js";
import {
  notifyCalendarEventCreated,
  notifyCalendarEventDeleted,
  notifyCalendarEventUpdated
} from "../utils/academicCalendarNotifications.js";
import { bsToAdDate, ensureValidBsDate } from "../utils/nepaliDate.js";
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
  const event = await AcademicCalendarEvent.findOne({ _id: req.params.id, schoolId }).lean();
  if (!event) {
    throw new ApiError(404, "Calendar event not found");
  }

  const events = await listAcademicCalendarEvents(schoolId, { dateFromBs: event.dateBs, dateToBs: event.dateBs });
  const match = events.find((item) => item._id === event._id.toString());
  sendSuccess(res, "Calendar event fetched", match ?? null);
});

export const createEvent = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const parsed = academicCalendarEventInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid event payload");
  }

  const payload = parsed.data;
  const dateBs = ensureValidBsDate(payload.dateBs);
  const { dateAd, dayOfWeek } = bsToAdDate(dateBs);
  const academicYearBs = payload.academicYearBs || inferAcademicYearFromDateBs(dateBs);

  const created = await AcademicCalendarEvent.create({
    schoolId,
    academicYearBs,
    dateBs,
    dateAd,
    dayOfWeek,
    name: payload.name,
    eventType: payload.eventType,
    reason: payload.reason,
    isHoliday: resolveHolidayFlag(payload.eventType),
    audit: { createdBy: req.user?.userId }
  });

  await recordAudit(req, {
    action: "academic_calendar.event.create",
    entity: "ACADEMIC_CALENDAR_EVENT",
    entityId: created._id.toString(),
    after: created.toObject()
  });

  const [record] = await listAcademicCalendarEvents(schoolId, { dateFromBs: dateBs, dateToBs: dateBs });
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

  const existing = await AcademicCalendarEvent.findOne({ _id: req.params.id, schoolId });
  if (!existing) {
    throw new ApiError(404, "Calendar event not found");
  }

  const before = existing.toObject();
  const payload = parsed.data;

  if (payload.dateBs) {
    const dateBs = ensureValidBsDate(payload.dateBs);
    const { dateAd, dayOfWeek } = bsToAdDate(dateBs);
    existing.dateBs = dateBs;
    existing.dateAd = dateAd;
    existing.dayOfWeek = dayOfWeek;
    if (!payload.academicYearBs) {
      existing.academicYearBs = inferAcademicYearFromDateBs(dateBs);
    }
  }

  if (payload.academicYearBs) existing.academicYearBs = payload.academicYearBs;
  if (payload.name) existing.name = payload.name;
  if (payload.eventType) {
    existing.eventType = payload.eventType;
    existing.isHoliday = resolveHolidayFlag(payload.eventType);
  }
  if (payload.reason !== undefined) existing.reason = payload.reason;

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

  const [record] = await listAcademicCalendarEvents(schoolId, {
    dateFromBs: existing.dateBs,
    dateToBs: existing.dateBs
  });
  if (record) {
    await notifyCalendarEventUpdated(schoolId.toString(), record);
  }
  sendSuccess(res, "Calendar event updated", record);
});

export const deleteEvent = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const existing = await AcademicCalendarEvent.findOne({ _id: req.params.id, schoolId });
  if (!existing) {
    throw new ApiError(404, "Calendar event not found");
  }

  const before = existing.toObject();
  await notifyCalendarEventDeleted(schoolId.toString(), {
    name: existing.name,
    dateBs: existing.dateBs
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