import mongoose, { Schema, type InferSchemaType } from "mongoose";

const transportStopSchema = new Schema(
  {
    name: { type: String, required: true },
    pickupTime: { type: String }
  },
  { _id: false }
);

const transportRouteSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    vehicleNumber: { type: String, required: true, trim: true },
    driverName: { type: String, required: true, trim: true },
    driverPhone: { type: String, required: true, trim: true },
    stops: { type: [transportStopSchema], default: [] },
    monthlyFeeNpr: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export type TransportRouteDocument = InferSchemaType<typeof transportRouteSchema>;
export const TransportRoute = mongoose.model("TransportRoute", transportRouteSchema);

const transportAssignmentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    routeId: { type: Schema.Types.ObjectId, ref: "TransportRoute", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    pickupStop: { type: String, required: true },
    dropStop: { type: String, required: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

transportAssignmentSchema.index({ schoolId: 1, studentId: 1 }, { unique: true });

export type TransportAssignmentDocument = InferSchemaType<typeof transportAssignmentSchema>;
export const TransportAssignment = mongoose.model("TransportAssignment", transportAssignmentSchema);