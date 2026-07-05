import { DEMO_SCHOOL_CODE } from "@phit-erp/shared";
import type { Types } from "mongoose";
import { env } from "../config/env.js";
import { Batch } from "../models/Batch.js";
import { School } from "../models/School.js";
import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { ensureSuperAdmin, seedDemoSchool } from "./demoSchool.js";

const MIN_DEMO_STUDENTS = 9;
const MIN_DEMO_BATCHES = 2;
const MIN_DEMO_TEACHERS = 4;

const isDemoCollegeComplete = async (schoolId: Types.ObjectId): Promise<boolean> => {
  const [studentCount, batchCount, teacherCount] = await Promise.all([
    Student.countDocuments({ schoolId }),
    Batch.countDocuments({ schoolId }),
    Teacher.countDocuments({ schoolId })
  ]);

  return studentCount >= MIN_DEMO_STUDENTS && batchCount >= MIN_DEMO_BATCHES && teacherCount >= MIN_DEMO_TEACHERS;
};

export const ensureDemoData = async (): Promise<void> => {
  if (!env.SEED_DEMO) {
    console.log("Demo seeding disabled (SEED_DEMO=false).");
    return;
  }

  await ensureSuperAdmin();

  const existingSchool = await School.findOne({ code: DEMO_SCHOOL_CODE });

  if (existingSchool && (await isDemoCollegeComplete(existingSchool._id))) {
    console.log(`Demo institution (${DEMO_SCHOOL_CODE}) is complete.`);
    return;
  }

  if (existingSchool) {
    console.log(`Demo institution (${DEMO_SCHOOL_CODE}) is incomplete — reseeding...`);
    await seedDemoSchool({ force: true });
  } else {
    console.log("Seeding demo institution and accounts...");
    await seedDemoSchool();
  }

  console.log("Demo seed completed.");
};