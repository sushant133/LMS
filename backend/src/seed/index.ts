import { DEMO_SCHOOL_CODE } from "@nepal-school-erp/shared";
import { env } from "../config/env.js";
import { School } from "../models/School.js";
import { ensureSuperAdmin, seedDemoSchool } from "./demoSchool.js";

export const ensureDemoData = async (): Promise<void> => {
  if (!env.SEED_DEMO) {
    console.log("Demo seeding disabled (SEED_DEMO=false).");
    return;
  }

  await ensureSuperAdmin();

  const existingSchool = await School.findOne({ code: DEMO_SCHOOL_CODE });
  if (existingSchool) {
    console.log(`Demo school (${DEMO_SCHOOL_CODE}) already present.`);
    return;
  }

  console.log("Seeding demo school and accounts...");
  await seedDemoSchool();
  console.log("Demo school seed completed.");
};