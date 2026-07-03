import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import { env } from "../config/env.js";
import { User } from "../models/User.js";

const run = async (): Promise<void> => {
  await connectDatabase();

  const existing = await User.findOne({ role: "SUPER_ADMIN" });

  if (existing) {
    console.log(`Super admin already exists: ${existing.email}`);
    await mongoose.connection.close();
    return;
  }

  const superAdmin = await User.create({
    fullName: env.SUPER_ADMIN_NAME,
    email: env.SUPER_ADMIN_EMAIL,
    password: env.SUPER_ADMIN_PASSWORD,
    role: "SUPER_ADMIN",
    isActive: true,
    mustChangePassword: false
  });

  console.log(`Super admin created: ${superAdmin.email}`);
  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error("Failed to seed super admin", error);
  await mongoose.connection.close();
  process.exit(1);
});
