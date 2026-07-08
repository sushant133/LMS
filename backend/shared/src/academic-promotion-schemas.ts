import { z } from "zod";
import { academicYearSchema } from "./schemas.js";

export const academicPromotionExecuteSchema = z.object({
  academicSessionBs: academicYearSchema,
  remarks: z.string().max(1000).optional().or(z.literal(""))
});

export const academicPromotionRollbackSchema = z.object({
  remarks: z.string().max(1000).optional().or(z.literal(""))
});

export type AcademicPromotionExecuteInput = z.infer<typeof academicPromotionExecuteSchema>;
export type AcademicPromotionRollbackInput = z.infer<typeof academicPromotionRollbackSchema>;
