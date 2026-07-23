import { z } from "zod";
import { BIOMETRIC_PUNCH_TYPES } from "./biometric-types.js";

const punchTypeSchema = z.enum(BIOMETRIC_PUNCH_TYPES).optional().default("AUTO");

export const biometricPunchItemSchema = z.object({
  schoolId: z.string().min(1).optional(),
  deviceId: z.string().trim().min(1).max(120),
  biometricCode: z.string().trim().min(1).max(80),
  punchTime: z.string().trim().min(1).optional(),
  externalRef: z.string().trim().min(1).max(200).optional(),
  punchType: punchTypeSchema
});

/** Single punch body, or `{ punches: [...] }` for batch ingest. */
export const biometricPunchRequestSchema = z.union([
  biometricPunchItemSchema,
  z.object({
    schoolId: z.string().min(1).optional(),
    punches: z.array(biometricPunchItemSchema).min(1).max(200)
  })
]);

export type BiometricPunchItemInput = z.infer<typeof biometricPunchItemSchema>;
export type BiometricPunchRequestInput = z.infer<typeof biometricPunchRequestSchema>;
