import mongoose from "mongoose";
import { env } from "./env.js";
import { MasterSubject } from "../models/MasterSubject.js";
import { Subject } from "../models/Subject.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isIndexBuildAborted = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "codeName" in error &&
  (error as { codeName?: string }).codeName === "IndexBuildAborted";

/**
 * MongoDB aborts in-flight index builds when another connection issues dropIndexes.
 * Never drop indexes during normal startup — only create/sync missing definitions.
 */
const syncIndexesWithRetry = async (
  model: { syncIndexes: () => Promise<unknown> },
  label: string,
  maxAttempts = 5
): Promise<void> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await model.syncIndexes();
      return;
    } catch (error) {
      if (isIndexBuildAborted(error) && attempt < maxAttempts) {
        const waitMs = attempt * 2000;
        console.warn(`${label} index sync interrupted (attempt ${attempt}/${maxAttempts}), retrying in ${waitMs}ms...`);
        await sleep(waitMs);
        continue;
      }
      throw error;
    }
  }
};

export const connectDatabase = async (): Promise<void> => {
  // Works with MongoDB Atlas, local replica set, or any standard MongoDB URI (VPS).
  await mongoose.connect(env.MONGODB_URI);
  await syncIndexesWithRetry(MasterSubject, "MasterSubject");
  await syncIndexesWithRetry(Subject, "Subject");
  // Nested sub-units: drop legacy unique {unitId, subUnitNo} in favor of sibling index
  await syncIndexesWithRetry(AcademicSyllabusSubUnit, "AcademicSyllabusSubUnit");
  // Never log full connection string (may contain credentials)
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
};

export const disconnectDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};