import bcrypt from "bcryptjs";
import mongoose, { Schema, type HydratedDocument, type Model } from "mongoose";
import {
  MODULE_PERMISSION_ACTIONS,
  USER_ROLES,
  type UserRole
} from "@phit-erp/shared";

export interface UserDocument {
  schoolId?: mongoose.Types.ObjectId | null;
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  employeeId?: string;
  /** Position title only — never auto-grants permissions. */
  designation?: string;
  department?: string;
  profilePhotoUrl?: string;
  role: UserRole;
  /**
   * Additional ERP roles for multi-responsibility (one login).
   * Checked by authorize() alongside primary role.
   */
  secondaryRoles?: UserRole[];
  isActive: boolean;
  mustChangePassword: boolean;
  /**
   * Per-module access control.
   * Values: "NONE" | "READ_ONLY" | "WRITE". Missing key = WRITE (legacy default).
   */
  moduleAccess?: Record<string, "NONE" | "READ_ONLY" | "WRITE">;
  /**
   * Optional granular actions per module.
   * Keys: ERP module keys. Values: arrays of action strings.
   */
  moduleActions?: Record<string, string[]>;
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
    secondaryRoles: {
      type: [{ type: String, enum: USER_ROLES }],
      default: undefined
    },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    moduleAccess: {
      type: Map,
      of: { type: String, enum: ["NONE", "READ_ONLY", "WRITE"] },
      default: undefined
    },
    moduleActions: {
      type: Map,
      of: [{ type: String, enum: MODULE_PERMISSION_ACTIONS }],
      default: undefined
    }
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

  user.password = await bcrypt.hash(user.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

export const User = mongoose.model<UserDocument, UserModel>("User", userSchema);
