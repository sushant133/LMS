import { connectDatabase } from "../config/db.js";
import { School } from "../models/School.js";
import { migrateLegacyCollegeSubjects } from "../utils/masterSubjectProvisioning.js";

const schoolIdArg = process.argv[2];

const run = async (): Promise<void> => {
  await connectDatabase();

  const schools = schoolIdArg
    ? await School.find({ _id: schoolIdArg, institutionType: "COLLEGE" })
    : await School.find({ institutionType: "COLLEGE" });

  if (!schools.length) {
    console.log("No college institutions found to migrate.");
    process.exit(0);
  }

  for (const school of schools) {
    const result = await migrateLegacyCollegeSubjects(school._id);
    console.log(
      `[${school.name}] master created: ${result.masterSubjectsCreated}, linked: ${result.subjectsLinked}, batches: ${result.batchesProcessed}`
    );
  }

  process.exit(0);
};

run().catch((error) => {
  console.error("Master subject migration failed", error);
  process.exit(1);
});