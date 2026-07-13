import { Laboratory } from "../models/Laboratory.js";
import { logger } from "./logger.js";

const DESIRED_CODE_INDEX = "schoolId_1_code_1_nonempty";
const LEGACY_CODE_INDEX = "schoolId_1_code_1";

const log = (message: string): void => {
  // Always surface on console so `npm start` output shows the repair
  console.log(`[lab-index-repair] ${message}`);
  logger.info(message);
};

/**
 * Repair laboratory indexes that break startup when multiple docs have code:null.
 * Never throws — must not block server boot.
 */
export async function repairLaboratoryIndexes(): Promise<void> {
  try {
    const collection = Laboratory.collection;

    // 1) Force-drop known legacy index by name (even if listIndexes fails)
    for (const name of [LEGACY_CODE_INDEX, "schoolId_1_code_1_sparse"]) {
      try {
        await collection.dropIndex(name);
        log(`Dropped laboratory index: ${name}`);
      } catch {
        // IndexOptionsConflict / IndexNotFound — ignore
      }
    }

    // 2) Drop any other unique (schoolId, code) compound that is not the desired partial index
    try {
      const indexes = await collection.indexes();
      for (const idx of indexes) {
        const name = String(idx.name ?? "");
        if (name === "_id_" || name === DESIRED_CODE_INDEX) continue;

        const keys = idx.key as Record<string, number> | undefined;
        if (!keys) continue;

        const isSchoolCodeCompound =
          Object.keys(keys).length === 2 && keys.schoolId === 1 && keys.code === 1;

        if (isSchoolCodeCompound) {
          try {
            await collection.dropIndex(name);
            log(`Dropped laboratory index: ${name}`);
          } catch {
            /* ignore */
          }
        }
      }
    } catch (error) {
      log(
        `Could not list laboratory indexes: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // 3) Unset null/empty codes (explicit null is what poisons unique indexes)
    try {
      const result = await collection.updateMany(
        { $or: [{ code: null }, { code: "" }] },
        { $unset: { code: "" } }
      );
      if (result.modifiedCount > 0) {
        log(`Unset null/empty code on ${result.modifiedCount} laboratory document(s)`);
      }
    } catch (error) {
      log(
        `Could not normalize laboratory codes: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // 4) Create safe partial unique index (optional — uniqueness also checked in app code)
    try {
      const indexes = await collection.indexes();
      const hasDesired = indexes.some((idx) => idx.name === DESIRED_CODE_INDEX);
      if (!hasDesired) {
        await collection.createIndex(
          { schoolId: 1, code: 1 },
          {
            unique: true,
            name: DESIRED_CODE_INDEX,
            partialFilterExpression: {
              code: { $exists: true, $type: "string", $gt: "" }
            }
          }
        );
        log(`Created laboratory index: ${DESIRED_CODE_INDEX}`);
      } else {
        log(`Laboratory index already present: ${DESIRED_CODE_INDEX}`);
      }
    } catch (error) {
      // Non-fatal: server can run without unique code index
      log(
        `Could not create partial code index (non-fatal): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  } catch (error) {
    log(
      `repairLaboratoryIndexes failed (non-fatal): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
