import type mongoose from "mongoose";
import { User } from "../models/User.js";
import { ApiError } from "./apiError.js";

export const updatePortalUser = async (
  userId: mongoose.Types.ObjectId,
  updates: {
    fullName: string;
    email: string;
    phone?: string;
    password?: string;
  }
): Promise<void> => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User account not found");
  }

  user.fullName = updates.fullName;
  user.email = updates.email;
  user.phone = updates.phone;

  if (updates.password) {
    user.password = updates.password;
    user.mustChangePassword = false;
  }

  await user.save();
};