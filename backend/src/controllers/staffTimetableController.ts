import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { periodNumberFromStartTime, staffTimetableSlotSchema } from "@phit-erp/shared";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { StaffTimetableSlot } from "../models/StaffTimetableSlot.js";
import { ApiError } from "../utils/apiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { requireCollegeInstitution } from "../utils/institution.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

/** BREAK / DAY_OFF occupy no period column and carry no duty. */
const isNonDuty = (sessionType?: string) =>
  sessionType === "BREAK" || sessionType === "DAY_OFF";

const toMinutes = (time: string): number => {
  const parts = String(time ?? "00:00").split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/**
 * DUTY uses the period number the admin picked; BREAK / DAY_OFF get a synthetic
 * key from their start time so the unique index still separates them, mirroring
 * how the academic timetable stores BREAK / HOLIDAY.
 */
const resolvePeriodNumber = (
  sessionType: string | undefined,
  startTime: string,
  provided?: number | null
): number => {
  if (isNonDuty(sessionType)) return periodNumberFromStartTime(startTime);
  if (provided != null && provided >= 1 && provided <= 12) return provided;
  throw new ApiError(400, "Period number (1–12) is required for a duty slot");
};

interface ClashCheckParams {
  schoolId: Types.ObjectId;
  academicYearBs: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  staffId: string;
  room?: string;
  excludeId?: string;
}

/**
 * Reject a slot that double-books the staff member, or puts two people in the
 * same room at the same time.
 *
 * Overlap is compared on the actual clock times rather than the period column:
 * two entries can sit in different period columns and still overlap if their
 * times were edited, and that is exactly the mistake worth catching.
 *
 * A DAY_OFF is not a booking, so it is not treated as occupying the room.
 */
const assertNoStaffTimetableClash = async ({
  schoolId,
  academicYearBs,
  dayOfWeek,
  startTime,
  endTime,
  staffId,
  room,
  excludeId
}: ClashCheckParams): Promise<void> => {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);

  const sameDay = await StaffTimetableSlot.find({
    schoolId,
    academicYearBs,
    dayOfWeek,
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  })
    .populate("staffId", "fullName")
    .lean();

  const overlaps = (other: { startTime: string; endTime: string }) =>
    start < toMinutes(other.endTime) && toMinutes(other.startTime) < end;

  for (const other of sameDay) {
    if (!overlaps(other)) continue;

    const otherStaffId = String(
      (other.staffId as { _id?: unknown })?._id ?? other.staffId ?? ""
    );
    if (otherStaffId === staffId) {
      throw new ApiError(
        409,
        `This staff member is already scheduled ${other.startTime}–${other.endTime} that day` +
          (other.dutyTitle ? ` (${other.dutyTitle})` : "")
      );
    }

    const trimmedRoom = (room ?? "").trim();
    if (
      trimmedRoom &&
      other.sessionType !== "DAY_OFF" &&
      (other.room ?? "").trim().toLowerCase() === trimmedRoom.toLowerCase()
    ) {
      const otherName =
        (other.staffId as { fullName?: string })?.fullName ?? "another staff member";
      throw new ApiError(
        409,
        `${trimmedRoom} is already assigned to ${otherName} ${other.startTime}–${other.endTime} that day`
      );
    }
  }
};

/** Staff record for the slot, and the department to snapshot onto it. */
const loadStaff = async (schoolId: Types.ObjectId, staffId: string) => {
  const staff = await CollegeStaff.findOne({ _id: staffId, schoolId })
    .select("fullName department designation status")
    .lean();
  if (!staff) throw new ApiError(404, "College staff member not found");
  return staff;
};

export const listStaffTimetable = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const filter: Record<string, unknown> = withTenantScope(req);

  if (typeof req.query.staffId === "string" && req.query.staffId.trim()) {
    filter.staffId = req.query.staffId.trim();
  }
  if (typeof req.query.academicYearBs === "string" && req.query.academicYearBs.trim()) {
    filter.academicYearBs = req.query.academicYearBs.trim();
  }
  if (typeof req.query.department === "string" && req.query.department.trim()) {
    filter.department = {
      $regex: new RegExp(`^${escapeRegex(req.query.department.trim())}$`, "i")
    };
  }
  if (typeof req.query.room === "string" && req.query.room.trim()) {
    filter.room = { $regex: new RegExp(`^${escapeRegex(req.query.room.trim())}$`, "i") };
  }
  if (typeof req.query.dayOfWeek === "string" && req.query.dayOfWeek !== "") {
    const day = Number(req.query.dayOfWeek);
    if (!Number.isNaN(day)) filter.dayOfWeek = day;
  }

  const slots = await StaffTimetableSlot.find(filter)
    .populate("staffId", "fullName staffId designation department")
    .sort({ dayOfWeek: 1, periodNumber: 1, startTime: 1 });

  return sendSuccess(res, "Staff timetable fetched", slots);
});

export const createStaffTimetableSlot = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const payload = staffTimetableSlotSchema.parse(req.body);
  const schoolId = tenantObjectId(req);

  const staff = await loadStaff(schoolId, payload.staffId);
  const sessionType = payload.sessionType ?? "DUTY";
  const nonDuty = isNonDuty(sessionType);
  const periodNumber = resolvePeriodNumber(sessionType, payload.startTime, payload.periodNumber);

  await assertNoStaffTimetableClash({
    schoolId,
    academicYearBs: payload.academicYearBs,
    dayOfWeek: payload.dayOfWeek,
    startTime: payload.startTime,
    endTime: payload.endTime,
    staffId: payload.staffId,
    room: nonDuty ? "" : payload.room
  });

  const slot = await StaffTimetableSlot.create({
    schoolId,
    staffId: payload.staffId,
    dayOfWeek: payload.dayOfWeek,
    periodNumber,
    startTime: payload.startTime,
    endTime: payload.endTime,
    academicYearBs: payload.academicYearBs,
    sessionType,
    dutyTitle: nonDuty ? "" : (payload.dutyTitle ?? ""),
    room: nonDuty ? "" : (payload.room ?? ""),
    // Falls back to the staff member's own department so the grid can group by it.
    department: (payload.department || staff.department || "").trim(),
    breakLabel: sessionType === "BREAK" ? (payload.breakLabel ?? "") : "",
    remarks: payload.remarks ?? ""
  });

  return sendSuccess(res, "Staff timetable slot created", slot, 201);
});

export const updateStaffTimetableSlot = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const payload = staffTimetableSlotSchema.partial().parse(req.body);
  const schoolId = tenantObjectId(req);

  const existing = await StaffTimetableSlot.findOne(
    withTenantScope(req, { _id: req.params.id })
  ).lean();
  if (!existing) throw new ApiError(404, "Staff timetable slot not found");

  const staffId = payload.staffId ?? existing.staffId?.toString() ?? "";
  const staff = await loadStaff(schoolId, staffId);

  const sessionType = payload.sessionType ?? existing.sessionType ?? "DUTY";
  const nonDuty = isNonDuty(sessionType);
  const dayOfWeek = payload.dayOfWeek ?? existing.dayOfWeek;
  const startTime = payload.startTime ?? existing.startTime;
  const endTime = payload.endTime ?? existing.endTime;
  const academicYearBs = payload.academicYearBs ?? existing.academicYearBs;
  const room = nonDuty ? "" : (payload.room ?? existing.room ?? "");
  const periodNumber = resolvePeriodNumber(
    sessionType,
    startTime,
    payload.periodNumber ?? existing.periodNumber
  );

  const placementChanged =
    dayOfWeek !== existing.dayOfWeek ||
    startTime !== existing.startTime ||
    endTime !== existing.endTime ||
    staffId !== (existing.staffId?.toString() ?? "") ||
    room.trim().toLowerCase() !== (existing.room ?? "").trim().toLowerCase();

  if (placementChanged) {
    await assertNoStaffTimetableClash({
      schoolId,
      academicYearBs,
      dayOfWeek,
      startTime,
      endTime,
      staffId,
      room,
      excludeId: existing._id.toString()
    });
  }

  const slot = await StaffTimetableSlot.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    {
      staffId,
      dayOfWeek,
      periodNumber,
      startTime,
      endTime,
      academicYearBs,
      sessionType,
      dutyTitle: nonDuty ? "" : (payload.dutyTitle ?? existing.dutyTitle ?? ""),
      room,
      department: (
        payload.department ??
        existing.department ??
        staff.department ??
        ""
      ).trim(),
      breakLabel:
        sessionType === "BREAK" ? (payload.breakLabel ?? existing.breakLabel ?? "") : "",
      remarks: payload.remarks ?? existing.remarks ?? ""
    },
    { new: true }
  );

  if (!slot) throw new ApiError(404, "Staff timetable slot not found");
  return sendSuccess(res, "Staff timetable slot updated", slot);
});

export const deleteStaffTimetableSlot = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const slot = await StaffTimetableSlot.findOneAndDelete(
    withTenantScope(req, { _id: req.params.id })
  );
  if (!slot) throw new ApiError(404, "Staff timetable slot not found");
  return sendSuccess(res, "Staff timetable slot deleted");
});

/** Change one period column's start/end for every weekday of one staff member. */
export const bulkUpdateStaffPeriodTimes = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const body = req.body as {
    academicYearBs?: string;
    staffId?: string;
    oldStartTime?: string;
    oldEndTime?: string;
    newStartTime?: string;
    newEndTime?: string;
  };

  const academicYearBs = String(body.academicYearBs ?? "").trim();
  const staffId = String(body.staffId ?? "").trim();
  const oldStartTime = String(body.oldStartTime ?? "").trim();
  const oldEndTime = String(body.oldEndTime ?? "").trim();
  const newStartTime = String(body.newStartTime ?? "").trim();
  const newEndTime = String(body.newEndTime ?? "").trim();

  const timeRe = /^\d{2}:\d{2}$/;
  if (!academicYearBs) throw new ApiError(400, "Academic year is required");
  if (!staffId) throw new ApiError(400, "Staff member is required");
  if (!timeRe.test(oldStartTime) || !timeRe.test(oldEndTime)) {
    throw new ApiError(400, "Current period times are invalid");
  }
  if (!timeRe.test(newStartTime) || !timeRe.test(newEndTime)) {
    throw new ApiError(400, "New times must be HH:MM (24-hour)");
  }
  if (toMinutes(newStartTime) >= toMinutes(newEndTime)) {
    throw new ApiError(400, "End time must be after start time");
  }
  if (oldStartTime === newStartTime && oldEndTime === newEndTime) {
    throw new ApiError(400, "New times are the same as the current times");
  }

  const schoolId = tenantObjectId(req);
  const slots = await StaffTimetableSlot.find({
    schoolId,
    academicYearBs,
    staffId,
    startTime: oldStartTime,
    endTime: oldEndTime
  }).lean();

  if (slots.length === 0) {
    throw new ApiError(
      404,
      `No staff timetable slots found for ${oldStartTime}–${oldEndTime}`
    );
  }

  let updatedCount = 0;
  for (const slot of slots) {
    const sessionType = slot.sessionType ?? "DUTY";
    const nextPeriod = resolvePeriodNumber(sessionType, newStartTime, slot.periodNumber);
    await StaffTimetableSlot.updateOne(
      { _id: slot._id, schoolId },
      { $set: { startTime: newStartTime, endTime: newEndTime, periodNumber: nextPeriod } }
    );
    updatedCount += 1;
  }

  return sendSuccess(res, "Period times updated for the full week", {
    updatedCount,
    oldStartTime,
    oldEndTime,
    newStartTime,
    newEndTime,
    daysUpdated: [...new Set(slots.map((s) => s.dayOfWeek))].length
  });
});
