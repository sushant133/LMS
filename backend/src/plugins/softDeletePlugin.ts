/**
 * Global soft-delete support for Mongoose models.
 *
 * - Adds isDeleted / deletedAt / deletedBy when missing
 * - Excludes soft-deleted rows from find/count/update by default
 * - Rewrites deleteOne / deleteMany / findOneAndDelete / findByIdAndDelete
 *   into updates that set isDeleted: true (data + files stay recoverable)
 *
 * Opt out of the auto filter with: Model.find(query).setOptions({ includeDeleted: true })
 * Or query explicitly: { isDeleted: true }
 */
import type {
  CallbackWithoutResultAndOptionalError,
  HydratedDocument,
  Model,
  Query,
  Schema,
} from "mongoose";

export type SoftDeleteQueryOptions = {
  /** When true, do not auto-add isDeleted: { $ne: true } */
  includeDeleted?: boolean;
};

const softDeleteSet = (deletedBy?: string) => ({
  isDeleted: true,
  deletedAt: new Date(),
  ...(deletedBy ? { deletedBy } : {}),
});

const filterAlreadyTargetsDeleted = (filter: Record<string, unknown>): boolean => {
  if (Object.prototype.hasOwnProperty.call(filter, "isDeleted")) return true;
  const and = filter.$and;
  if (Array.isArray(and)) {
    return and.some(
      (clause) =>
        clause &&
        typeof clause === "object" &&
        Object.prototype.hasOwnProperty.call(clause as object, "isDeleted"),
    );
  }
  return false;
};

export function softDeletePlugin(schema: Schema): void {
  if (!schema.path("isDeleted")) {
    schema.add({
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },
      deletedBy: { type: String },
    });
  } else {
    if (!schema.path("deletedAt")) {
      schema.add({ deletedAt: { type: Date } });
    }
    if (!schema.path("deletedBy")) {
      schema.add({ deletedBy: { type: String } });
    }
  }

  const excludeDeleted = function (
    this: Query<unknown, unknown>,
    next: CallbackWithoutResultAndOptionalError,
  ): void {
    try {
      const opts = this.getOptions() as SoftDeleteQueryOptions;
      if (opts?.includeDeleted) {
        next();
        return;
      }
      const filter = this.getFilter() as Record<string, unknown>;
      if (filterAlreadyTargetsDeleted(filter)) {
        next();
        return;
      }
      this.where({ isDeleted: { $ne: true } });
    } catch {
      /* ignore */
    }
    next();
  };

  schema.pre("find", excludeDeleted);
  schema.pre("findOne", excludeDeleted);
  schema.pre("countDocuments", excludeDeleted);
  schema.pre("findOneAndUpdate", excludeDeleted);
  schema.pre("updateOne", excludeDeleted);
  schema.pre("updateMany", excludeDeleted);

  /** Document instance: doc.deleteOne() → soft delete */
  schema.method(
    "deleteOne",
    async function softDeleteInstance(
      this: HydratedDocument<Record<string, unknown>>,
    ) {
      this.set(softDeleteSet());
      await this.save();
      return { acknowledged: true, deletedCount: 1 };
    },
  );

  /** Legacy doc.remove() if still used */
  schema.method(
    "remove",
    async function softRemoveInstance(
      this: HydratedDocument<Record<string, unknown>>,
    ) {
      this.set(softDeleteSet());
      await this.save();
      return this;
    },
  );

  schema.statics.softDeleteOne = async function softDeleteOneStatic(
    this: Model<unknown>,
    filter: Record<string, unknown>,
    deletedBy?: string,
  ) {
    return this.findOneAndUpdate(
      filter,
      { $set: softDeleteSet(deletedBy) },
      { new: true },
    );
  };

  schema.statics.softDeleteMany = async function softDeleteManyStatic(
    this: Model<unknown>,
    filter: Record<string, unknown>,
    deletedBy?: string,
  ) {
    const result = await this.updateMany(filter, {
      $set: softDeleteSet(deletedBy),
    });
    return {
      acknowledged: result.acknowledged,
      deletedCount: result.modifiedCount ?? result.matchedCount ?? 0,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  };

  schema.statics.findOneAndDelete = function findOneAndSoftDelete(
    this: Model<unknown>,
    filter?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) {
    return this.findOneAndUpdate(
      filter ?? {},
      { $set: softDeleteSet() },
      { ...(options ?? {}), new: true },
    );
  };

  schema.statics.findByIdAndDelete = function findByIdAndSoftDelete(
    this: Model<unknown>,
    id: unknown,
    options?: Record<string, unknown>,
  ) {
    return this.findByIdAndUpdate(
      id,
      { $set: softDeleteSet() },
      { ...(options ?? {}), new: true },
    );
  };

  schema.statics.deleteOne = async function deleteOneSoft(
    this: Model<unknown>,
    filter?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) {
    const result = await this.updateOne(
      filter ?? {},
      { $set: softDeleteSet() },
      options ?? {},
    );
    return {
      acknowledged: result.acknowledged,
      deletedCount: result.modifiedCount ?? 0,
    };
  };

  schema.statics.deleteMany = async function deleteManySoft(
    this: Model<unknown>,
    filter?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) {
    const result = await this.updateMany(
      filter ?? {},
      { $set: softDeleteSet() },
      options ?? {},
    );
    return {
      acknowledged: result.acknowledged,
      deletedCount: result.modifiedCount ?? result.matchedCount ?? 0,
    };
  };
}

/** Explicit helper for controllers (optional; Model.deleteOne already soft-deletes). */
export async function softDeleteById(
  model: Model<unknown>,
  id: unknown,
  deletedBy?: string,
) {
  return model.findByIdAndUpdate(
    id,
    { $set: softDeleteSet(deletedBy) },
    { new: true },
  );
}

export async function softDeleteByFilter(
  model: Model<unknown>,
  filter: Record<string, unknown>,
  deletedBy?: string,
) {
  return model.findOneAndUpdate(
    filter,
    { $set: softDeleteSet(deletedBy) },
    { new: true },
  );
}

/** Query fragment: active (not soft-deleted) records. */
export const notDeleted = { isDeleted: { $ne: true } } as const;

/** Query fragment: only soft-deleted records. */
export const onlyDeleted = { isDeleted: true } as const;
