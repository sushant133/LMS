/**
 * One-shot: drop broken laboratory code indexes on Atlas / local Mongo.
 *
 *   cd backend
 *   npx tsx src/scripts/repairLabIndexes.ts
 */
import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { repairLaboratoryIndexes } from "../utils/repairLaboratoryIndexes.js";

const main = async (): Promise<void> => {
  await connectDatabase();
  await repairLaboratoryIndexes();
  await disconnectDatabase();
  console.log("[lab-index-repair] Done.");
  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
