import mongoose, { ClientSession } from "mongoose";

interface TransactionOptions {
  session?: ClientSession;
}

const MAX_TRANSACTION_RETRIES = 5;

const isTransientTransactionError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const mongoError = error as {
    errorLabelSet?: Set<string>;
    code?: number;
    hasErrorLabel?: (label: string) => boolean;
  };

  if (mongoError.hasErrorLabel?.("TransientTransactionError")) {
    return true;
  }

  if (mongoError.errorLabelSet?.has("TransientTransactionError")) {
    return true;
  }

  // WriteConflict during catalog changes on fresh Atlas databases
  return mongoError.code === 112;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes a function within a transaction if replica set is available,
 * otherwise executes it directly (for standalone MongoDB).
 *
 * Retries transient transaction errors (common on Atlas when collections/indexes
 * are created during the first run).
 */
export async function withTransaction<T>(
  callback: (session: ClientSession | null) => Promise<T>
): Promise<T> {
  const isReplicaSet = await checkIfReplicaSet();

  if (!isReplicaSet) {
    return callback(null);
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt++) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();
      const result = await callback(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();

      if (isTransientTransactionError(error) && attempt < MAX_TRANSACTION_RETRIES - 1) {
        lastError = error;
        await sleep(100 * 2 ** attempt);
        continue;
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  throw lastError;
}

/**
 * Check if MongoDB is running as a replica set
 */
async function checkIfReplicaSet(): Promise<boolean> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return false;

    const status = await admin.serverStatus();
    // If 'repl' field exists, it's a replica set member
    return !!status.repl;
  } catch {
    // If check fails, assume standalone mode
    return false;
  }
}

/**
 * Start a new session with automatic transaction handling based on MongoDB setup
 */
export async function createSession(): Promise<ClientSession | null> {
  const isReplicaSet = await checkIfReplicaSet();
  
  if (!isReplicaSet) {
    return null;
  }

  return await mongoose.startSession();
}

/**
 * Commit transaction safely (handles null session for standalone mode)
 */
export async function commitTransaction(session: ClientSession | null): Promise<void> {
  if (session) {
    await session.commitTransaction();
  }
}

/**
 * Abort transaction safely (handles null session for standalone mode)
 */
export async function abortTransaction(session: ClientSession | null): Promise<void> {
  if (session) {
    await session.abortTransaction();
  }
}

/**
 * End session safely (handles null session for standalone mode)
 */
export async function endSession(session: ClientSession | null): Promise<void> {
  if (session) {
    await session.endSession();
  }
}

/**
 * Get session for use in database operations.
 * Returns { session: null } for standalone mode (session parameter is ignored in queries)
 */
export function getSessionOption(session: ClientSession | null): TransactionOptions {
  if (!session) {
    return {};
  }
  return { session };
}
