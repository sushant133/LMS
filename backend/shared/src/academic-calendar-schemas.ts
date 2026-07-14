import { z } from "zod";
import {
  ACADEMIC_CALENDAR_EVENT_STATUSES,
  ACADEMIC_CALENDAR_EVENT_TYPES
} from "./academic-calendar-types.js";

const bsDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const academicYearPattern = /^\d{4}\/\d{4}$/;

export const academicCalendarEventInputSchema = z
  .object({
    academicYearBs: z.string().regex(academicYearPattern, "Academic year must be in YYYY/YYYY format"),
    startDateBs: z.string().regex(bsDatePattern, "Start BS date must be in YYYY-MM-DD format").optional(),
    endDateBs: z.string().regex(bsDatePattern, "End BS date must be in YYYY-MM-DD format").optional(),
    /** Legacy single-date field — used when startDateBs is omitted. */
    dateBs: z.string().regex(bsDatePattern, "BS date must be in YYYY-MM-DD format").optional(),
    name: z.string().trim().min(1, "Event name is required").max(200),
    eventType: z.enum(ACADEMIC_CALENDAR_EVENT_TYPES),
    reason: z.string().trim().max(1000).optional(),
    status: z.enum(ACADEMIC_CALENDAR_EVENT_STATUSES).optional()
  })
  .superRefine((value, ctx) => {
    const start = value.startDateBs || value.dateBs;
    if (!start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date (BS) is required",
        path: ["startDateBs"]
      });
      return;
    }

    const end = value.endDateBs || start;
    if (end < start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be on or after the start date",
        path: ["endDateBs"]
      });
    }
  })
  .transform((value) => {
    const startDateBs = value.startDateBs || value.dateBs!;
    const endDateBs = value.endDateBs || startDateBs;
    return {
      academicYearBs: value.academicYearBs,
      startDateBs,
      endDateBs,
      dateBs: startDateBs,
      name: value.name,
      eventType: value.eventType,
      reason: value.reason,
      status: value.status ?? ("ACTIVE" as const)
    };
  });

export const academicCalendarEventUpdateSchema = z
  .object({
    academicYearBs: z.string().regex(academicYearPattern).optional(),
    startDateBs: z.string().regex(bsDatePattern).optional(),
    endDateBs: z.string().regex(bsDatePattern).optional(),
    dateBs: z.string().regex(bsDatePattern).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    eventType: z.enum(ACADEMIC_CALENDAR_EVENT_TYPES).optional(),
    reason: z.string().trim().max(1000).optional().nullable(),
    status: z.enum(ACADEMIC_CALENDAR_EVENT_STATUSES).optional()
  })
  .superRefine((value, ctx) => {
    const start = value.startDateBs || value.dateBs;
    const end = value.endDateBs;
    if (start && end && end < start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be on or after the start date",
        path: ["endDateBs"]
      });
    }
  });

export const academicCalendarFiltersSchema = z.object({
  academicYearBs: z.string().regex(academicYearPattern).optional(),
  monthBs: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  eventType: z.enum(ACADEMIC_CALENDAR_EVENT_TYPES).optional(),
  keyword: z.string().trim().max(200).optional(),
  dateFromBs: z.string().regex(bsDatePattern).optional(),
  dateToBs: z.string().regex(bsDatePattern).optional(),
  dateAd: z.string().regex(bsDatePattern).optional(),
  status: z.enum(ACADEMIC_CALENDAR_EVENT_STATUSES).optional(),
  excludeSystemGenerated: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (typeof value === "boolean") return value;
      return value === "true";
    })
});
