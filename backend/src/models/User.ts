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
  /**
   * Parent-only: per-parent portal section access (homework, results, fees, …).
   * When unset/null, school defaults from Settings.parentPortalAccess apply.
   */
  parentPortalAccess?: Record<string, boolean> | null;
  /**
   * Personal Finance Management access for staff (admin-granted).
   * Default false — staff never see Finance until Admin enables it.
   */
  personalFinanceAccess?: boolean;
  /**
   * Mobile device FCM tokens for system push notifications.
   * Never expose in API user profiles — server-only.
   */
  fcmTokens?: Array<{
    token: string;
    platform: "android" | "ios" | "web";
    updatedAt?: Date;
  }>;
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
    },
    /** Parent portal section toggles; null/undefined → use school defaults */
    parentPortalAccess: {
      type: Schema.Types.Mixed,
      default: undefined
    },
    /** Staff personal finance book — only when Admin grants access */
    personalFinanceAccess: {
      type: Boolean,
      default: false,
      index: true
    },
    /** Mobile FCM device tokens (server-only; excluded from auth profile responses) */
    fcmTokens: {
      type: [
        {
          token: { type: String, required: true, trim: true },
          platform: {
            type: String,
            enum: ["android", "ios", "web"],
            default: "android"
          },
          updatedAt: { type: Date, default: Date.now }
        }
      ],
      default: undefined,
      select: false
    }
  },
  { timestamps: true }
);

userSchema.index({ "fcmTokens.token": 1 }, { sparse: true });

/**
 * Defense in depth: never let a serialized User document carry the bcrypt hash
 * or device push tokens to a client.
 *
 * Every controller is expected to `.select("-password")` or map to an explicit
 * DTO, but that is a convention one new endpoint can forget — and forgetting it
 * ships password hashes to the browser. These transforms make the safe result
 * the default whenever a hydrated document is serialized (res.json, toObject,
 * spread into a response). Queries using `.lean()` bypass Mongoose transforms,
 * so explicit field selection is still required there.
 */
const stripSensitiveFields = (_doc: unknown, ret: unknown): unknown => {
  const record = ret as Record<string, unknown>;
  delete record.password;
  delete record.fcmTokens;
  return record;
};

userSchema.set("toJSON", { transform: stripSensitiveFields });
userSchema.set("toObject", { transform: stripSensitiveFields });

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
