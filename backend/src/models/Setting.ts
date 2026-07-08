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

const holidaySchema = new Schema(
  {
    title: { type: String, required: true },
    dateBs: { type: String, required: true }
  },
  { _id: false }
);

const infrastructureSchema = new Schema(
  {
    classrooms: { type: Number, default: 0 },
    usableClassrooms: { type: Number, default: 0 },
    toiletsMale: { type: Number, default: 0 },
    toiletsFemale: { type: Number, default: 0 },
    toiletsDisabled: { type: Number, default: 0 },
    drinkingWater: { type: Boolean, default: false },
    electricity: { type: Boolean, default: false },
    internet: { type: Boolean, default: false },
    libraryBooks: { type: Number, default: 0 },
    hasScienceLab: { type: Boolean, default: false },
    hasComputerLab: { type: Boolean, default: false },
    hasPlayground: { type: Boolean, default: false },
    hasRamp: { type: Boolean, default: false },
    midDayMeal: { type: Boolean, default: false }
  },
  { _id: false }
);

const dailyAttendanceConfigSchema = new Schema(
  {
    startTime: { type: String, default: "06:00" },
    endTime: { type: String, default: "12:00" },
    closeBeforeFirstPeriodEnds: { type: Boolean, default: true },
    allowMedicalLeave: { type: Boolean, default: true }
  },
  { _id: false }
);

const libraryInventoryAccessSchema = new Schema(
  {
    enabled: { type: Boolean, default: false }
  },
  { _id: false }
);

const settingSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, unique: true, index: true },
    schoolName: { type: String, required: true },
    schoolNameNp: { type: String, required: true },
    academicYearBs: { type: String, required: true },
    principalName: { type: String, required: true },
    contactEmail: { type: String, required: true },
    contactPhone: { type: String, required: true },
    address: { type: addressSchema, required: true },
    holidays: { type: [holidaySchema], default: [] },
    infrastructure: { type: infrastructureSchema, default: () => ({}) },
    dailyAttendance: { type: dailyAttendanceConfigSchema, default: () => ({}) },
    libraryInventoryAccess: { type: libraryInventoryAccessSchema, default: () => ({}) }
  },
  { timestamps: true }
);

export type SettingDocument = InferSchemaType<typeof settingSchema>;
export const Setting = mongoose.model("Setting", settingSchema);
