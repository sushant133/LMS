import mongoose, { Schema, type InferSchemaType } from "mongoose";

const addressSchema = new Schema(
  {
    province: { type: String, required: true },
    district: { type: String, required: true },
    municipality: { type: String, required: true },
    ward: { type: String, required: true },
    streetAddress: { type: String, required: true }
  },
  { _id: false }
);

const teacherSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    teacherCode: { type: String, required: true, trim: true },
    qualification: { type: String, required: true },
    joinedDateBs: { type: String, required: true },
    address: { type: addressSchema, required: true },
    subjects: [{ type: Schema.Types.ObjectId, ref: "Subject" }],
    assignedClassIds: [{ type: Schema.Types.ObjectId, ref: "SchoolClass" }],
    assignedSectionIds: [{ type: Schema.Types.ObjectId, ref: "Section" }],
    basicSalaryNpr: { type: Number, default: 0 }
  },
  { timestamps: true }
);

teacherSchema.index({ schoolId: 1, teacherCode: 1 }, { unique: true });

export type TeacherDocument = InferSchemaType<typeof teacherSchema>;
export const Teacher = mongoose.model("Teacher", teacherSchema);
