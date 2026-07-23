import type mongoose from "mongoose";
import { User } from "../models/User.js";
import { ApiError } from "./apiError.js";

export interface UpdatePortalUserResult {
  loginIdChanged: boolean;
  passwordChanged: boolean;
  previousEmail: string;
  email: string;
  fullName: string;
  /** Plaintext password when it was set in this update; otherwise undefined. */
  password?: string;
}

export const updatePortalUser = async (
  userId: mongoose.Types.ObjectId,
  updates: {
    fullName: string;
    email: string;
    phone?: string;
    /** Only set when admin explicitly provides a new password. */
    password?: string;
  }
): Promise<UpdatePortalUserResult> => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User account not found");
  }

  const previousEmail = (user.email ?? "").toLowerCase().trim();
  const nextEmail = (updates.email ?? "").toLowerCase().trim();
  const loginIdChanged = Boolean(nextEmail) && previousEmail !== nextEmail;
  const trimmedPassword = updates.password?.trim();
  const passwordChanged = Boolean(trimmedPassword);

  user.fullName = updates.fullName;
  // Keep existing email when caller passes the same/current value; only rewrite when provided
  if (nextEmail) {
    user.email = nextEmail;
  }
  if (updates.phone !== undefined) {
    user.phone = updates.phone;
  }

  if (trimmedPassword) {
    user.password = trimmedPassword;
    // Admin-set password: allow immediate login without forced change
    user.mustChangePassword = false;
  }

  await user.save();

  const resolvedEmail = (user.email || nextEmail || previousEmail).toLowerCase().trim();

  return {
    loginIdChanged,
    passwordChanged,
    previousEmail,
    email: resolvedEmail,
    fullName: updates.fullName,
    password: trimmedPassword || undefined
  };
};
