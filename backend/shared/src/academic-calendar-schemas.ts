import { z } from "zod";
import { ACADEMIC_CALENDAR_EVENT_TYPES } from "./academic-calendar-types.js";

const bsDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const academicYearPattern = /^\d{4}\/\d{4}$/;

export const academicCalendarEventInputSchema = z.object({
  academicYearBs: z.string().regex(academicYearPattern, "Academic year must be in YYYY/YYYY format"),
  dateBs: z.string().regex(bsDatePattern, "BS date must be in YYYY-MM-DD format"),
  name: z.string().trim().min(1, "Event name is required").max(200),
  eventType: z.enum(ACADEMIC_CALENDAR_EVENT_TYPES),
  reason: z.string().trim().max(1000).optional()
});

export const academicCalendarEventUpdateSchema = academicCalendarEventInputSchema.partial();

export const academicCalendarFiltersSchema = z.object({
  academicYearBs: z.string().regex(academicYearPattern).optional(),
  monthBs: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  eventType: z.enum(ACADEMIC_CALENDAR_EVENT_TYPES).optional(),
  keyword: z.string().trim().max(200).optional(),
  dateFromBs: z.string().regex(bsDatePattern).optional(),
  dateToBs: z.string().regex(bsDatePattern).optional(),
  dateAd: z.string().regex(bsDatePattern).optional()
});