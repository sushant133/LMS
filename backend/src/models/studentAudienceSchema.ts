import { Schema } from "mongoose";
import { COLLEGE_YEAR_NAMES, STUDENT_AUDIENCE_STATUSES } from "@phit-erp/shared";

/** Batch / year / status filter for the Students audience (empty lists = all). */
export const studentAudienceSubSchema = new Schema(
  {
    batchIds: { type: [{ type: Schema.Types.ObjectId, ref: "Batch" }], default: [] },
    yearNames: { type: [{ type: String, enum: COLLEGE_YEAR_NAMES }], default: [] },
    statuses: { type: [{ type: String, enum: STUDENT_AUDIENCE_STATUSES }], default: [] }
  },
  { _id: false }
);
