import { connectDatabase } from "../config/db.js";
import { migrateLegacyDemoDisplayNames } from "../utils/migrateLegacyDemoDisplayNames.js";

const main = async (): Promise<void> => {
  await connectDatabase();
  await migrateLegacyDemoDisplayNames();
  process.exit(0);
};

void main();