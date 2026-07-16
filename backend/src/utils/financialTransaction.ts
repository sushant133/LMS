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
 *
 * Important: callers must pass `session` into every write (cash book, journal,
 * fee rows, student balance). Side effects outside the session can commit while
 * the transaction aborts, or double-post if the unsupported-txn fallback re-runs.
 */
export async function withFinancialTransaction<T>(fn: (session: ClientSession | null) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    try {
      session.startTransaction();
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        return fn(null);
      }
      throw error;
    }

    try {
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch {
        // ignore abort failures on already-aborted / unsupported sessions
      }
      if (isTransactionUnsupported(error)) {
        // Safe only when fn is fully session-aware (no unscoped side effects on first try)
        return fn(null);
      }
      throw error;
    }
  } finally {
    session.endSession();
  }
}