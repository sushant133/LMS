import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import { Student } from "../models/Student.js";
import { User } from "../models/User.js";

const email = process.argv[2] ?? "student01@demoerp.nepal-school.com";
const password = process.argv[3] ?? "Demo@123456";

const run = async (): Promise<void> => {
  await connectDatabase();
  const user = await User.findOne({ email });
  if (!user) {
    console.log("USER_NOT_FOUND", email);
    await mongoose.connection.close();
    process.exit(1);
  }

  const profile = await Student.findOne({ user: user._id });
  const passwordOk = await user.comparePassword(password);

  console.log(
    JSON.stringify(
      {
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        schoolId: user.schoolId?.toString(),
        hasStudentProfile: Boolean(profile),
        passwordOk
      },
      null,
      2
    )
  );

  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.connection.close();
  process.exit(1);
});