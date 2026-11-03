import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Who uploaded each stored file. Used only to decide whether a non-admin may delete a file
 * (they may delete only files they uploaded). Files uploaded before this existed have no
 * record: admins can still remove them; for everyone else they are simply kept.
 */
const uploadedFileSchema = new Schema(
  {
    path: { type: String, required: true, unique: true },
    schoolId: { type: String, required: true, index: true },
    uploadedBy: { type: String, required: true, index: true }
  },
  { timestamps: true }
);

export type UploadedFileDocument = InferSchemaType<typeof uploadedFileSchema>;
export const UploadedFile = mongoose.model("UploadedFile", uploadedFileSchema);
