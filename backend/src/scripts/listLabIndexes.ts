import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { Laboratory } from "../models/Laboratory.js";

const main = async (): Promise<void> => {
  await connectDatabase();
  const indexes = await Laboratory.collection.indexes();
  console.log(JSON.stringify(indexes, null, 2));
  const nullCodes = await Laboratory.collection.countDocuments({
    $or: [{ code: null }, { code: "" }]
  });
  console.log("labs with null/empty code:", nullCodes);
  await disconnectDatabase();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
