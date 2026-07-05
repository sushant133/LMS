import mongoose, { type ClientSession } from "mongoose";

const isTransactionUnsupported = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("transaction numbers are only allowed on a replica set") ||
    message.includes("replica set") ||
    message.includes("transactions are not supported")
  );
};

/**
 * Runs financial mutations inside a MongoDB transaction when supported.
 * Falls back to a single session-less execution on standalone dev databases.
 */
export async function withFinancialTransaction<T>(fn: (session: ClientSession | null) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    try {
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      if (isTransactionUnsupported(error)) {
        return fn(null);
      }
      throw error;
    }
  } finally {
    session.endSession();
  }
}