import bcrypt from "bcryptjs";
import mongoose, { Schema, type HydratedDocument, type Model } from "mongoose";
import { USER_ROLES, type UserRole } from "@phit-erp/shared";

export interface UserDocument {
  schoolId?: mongoose.Types.ObjectId | null;
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  employeeId?: string;
  designation?: string;
  department?: string;
  profilePhotoUrl?: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  comparePassword(candidate: string): Promise<boolean>;
}

type UserModel = Model<UserDocument>;

const userSchema = new Schema<UserDocument, UserModel>(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", default: null, index: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    phone: { type: String, trim: true },
    employeeId: { type: String, trim: true },
    designation: { type: String, trim: true },
    department: { type: String, trim: true },
    profilePhotoUrl: { type: String, trim: true },
    role: { type: String, enum: USER_ROLES, required: true },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false }
  },
  { timestamps: true }
);

userSchema.pre("validate", function validateSchoolMembership(next) {
  const user = this as HydratedDocument<UserDocument>;

  if (user.role !== "SUPER_ADMIN" && !user.schoolId) {
    user.invalidate("schoolId", "schoolId is required for non-superadmin users");
  }

  if (user.role === "SUPER_ADMIN") {
    user.schoolId = null;
  }

  next();
});

userSchema.pre("save", async function hashPassword(next) {
  const user = this as HydratedDocument<UserDocument>;

  if (!user.isModified("password")) {
    return next();
  }

  user.password = await bcrypt.hash(user.password, 10);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

export const User = mongoose.model<UserDocument, UserModel>("User", userSchema);
