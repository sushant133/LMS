import type { ClientSession, Types } from "mongoose";
import { LibraryBook, LibraryBookCopy } from "../models/LibraryBook.js";
import { enrichBookInventory } from "./inventory.js";

type Id = string | Types.ObjectId;

export const normalizeBookCode = (code: string): string => code.trim().toUpperCase();

/** Recompute totalCopies / availableCopies on the master from physical copy rows. */
export async function syncBookCopyCounts(
  bookId: Id,
  schoolId: Id,
  session?: ClientSession | null
): Promise<void> {
  const queryOpts = session ? { session } : {};
  const [total, available] = await Promise.all([
    LibraryBookCopy.countDocuments({ schoolId, bookId }, queryOpts),
    LibraryBookCopy.countDocuments({ schoolId, bookId, status: "AVAILABLE" }, queryOpts)
  ]);

  await LibraryBook.updateOne(
    { _id: bookId, schoolId },
    {
      $set: {
        totalCopies: Math.max(total, 0),
        availableCopies: available
      }
    },
    queryOpts
  );
}

export async function loadCopiesForBooks(
  schoolId: Id,
  bookIds: Id[]
): Promise<Map<string, Array<Record<string, unknown>>>> {
  if (bookIds.length === 0) return new Map();

  const copies = await LibraryBookCopy.find({
    schoolId,
    bookId: { $in: bookIds }
  })
    .sort({ bookCode: 1 })
    .lean();

  const map = new Map<string, Array<Record<string, unknown>>>();
  for (const copy of copies) {
    const key = copy.bookId.toString();
    const list = map.get(key) ?? [];
    list.push({
      ...copy,
      _id: copy._id.toString(),
      schoolId: copy.schoolId.toString(),
      bookId: key
    });
    map.set(key, list);
  }
  return map;
}

export function formatBookWithCopies(
  book: Record<string, unknown> & { totalCopies: number; availableCopies: number; _id: { toString(): string } | string },
  copies: Array<Record<string, unknown>> = []
) {
  const enriched = enrichBookInventory(book);
  const id = typeof book._id === "string" ? book._id : book._id.toString();
  return {
    ...enriched,
    _id: id,
    schoolId: String(book.schoolId ?? ""),
    copies
  };
}
