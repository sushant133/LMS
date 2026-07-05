import mongoose from "mongoose";
import { DEMO_SCHOOL_CODE, demoCredentials } from "@phit-erp/shared";
import { connectDatabase } from "../config/db.js";
import { ensureSuperAdmin, seedDemoSchool } from "../seed/demoSchool.js";

const printDemoCredentials = (): void => {
  console.log("\n========== FRESH DEMO CREDENTIALS ==========\n");
  console.log("Super Admin");
  console.log(`  Email:    ${demoCredentials.superAdmin.email}`);
  console.log(`  Password: ${demoCredentials.superAdmin.password}\n`);

  console.log(`College Admin — Public Himal Institute of Technology (${DEMO_SCHOOL_CODE})`);
  console.log(`  Email:    ${demoCredentials.schoolAdmin.email}`);
  console.log(`  Password: ${demoCredentials.schoolAdmin.password}\n`);

  console.log("Teachers");
  demoCredentials.teachers.forEach((teacher) => {
    console.log(`  ${teacher.name} — ${teacher.subjects}`);
    console.log(`    Email: ${teacher.email}  Password: ${teacher.password}`);
  });

  console.log("\nStudents");
  demoCredentials.students.forEach((student) => {
    console.log(`  ${student.name} (${student.batch}, ${student.year}, Roll ${student.roll})`);
    console.log(`    Email: ${student.email}  Password: ${student.password}`);
  });

  console.log("\nParent");
  console.log(`  Email:    ${demoCredentials.parent.email}`);
  console.log(`  Password: ${demoCredentials.parent.password}`);
  console.log(`  Linked:   ${demoCredentials.parent.linkedStudent}`);

  console.log("\nLibrary Staff");
  console.log(`  ${demoCredentials.libraryStaff.name}`);
  console.log(`  Email:    ${demoCredentials.libraryStaff.email}`);
  console.log(`  Password: ${demoCredentials.libraryStaff.password}`);

  console.log("\nLaboratory Staff");
  console.log(`  ${demoCredentials.laboratoryStaff.name}`);
  console.log(`  Email:    ${demoCredentials.laboratoryStaff.email}`);
  console.log(`  Password: ${demoCredentials.laboratoryStaff.password}`);

  console.log("\nAccountant");
  console.log(`  ${demoCredentials.accountant.name} (${demoCredentials.accountant.employeeId})`);
  console.log(`  Email:    ${demoCredentials.accountant.email}`);
  console.log(`  Password: ${demoCredentials.accountant.password}`);
  console.log("\n==============================================\n");
};

const run = async (): Promise<void> => {
  await connectDatabase();

  console.log("Dropping entire database...");
  await mongoose.connection.dropDatabase();
  console.log("Database cleared.\n");

  await ensureSuperAdmin();
  await seedDemoSchool({ force: true });
  printDemoCredentials();

  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error("Failed to reset and seed database", error);
  await mongoose.connection.close();
  process.exit(1);
});