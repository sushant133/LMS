import type { Request, Response } from "express";
import {
  libraryBookSchema,
  libraryBookUpdateSchema,
  libraryInventoryAccessSchema,
  libraryIssueSchema,
  libraryReturnSchema,
  moduleStaffSchema
} from "@phit-erp/shared";
import { LibraryBook, LibraryBookCopy, LibraryIssue } from "../models/LibraryBook.js";
import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import {
  buildCredentialsAdminMessage,
  notifyAccountCredentials,
  resolvePortalPassword
} from "../utils/credentialEmail.js";
import {
  assertLibraryInventoryWriteAccess,
  getLibraryInventoryAccessEnabled
} from "../utils/libraryInventoryAccess.js";
import {
  formatBookWithCopies,
  loadCopiesForBooks,
  normalizeBookCode,
  syncBookCopyCounts
} from "../utils/libraryCopies.js";
import { Setting } from "../models/Setting.js";
import { processLibraryIssueReminders, syncSchoolLibraryOverdueStatuses } from "../utils/libraryNotifications.js";
import { compareBsDates, getTodayBs } from "../utils/nepaliDate.js";
import { notifyParentsOfStudent, sendNotification } from "../utils/notificationService.js";
import { sendSuccess } from "../utils/response.js";
import { getStudentProfile } from "../utils/studentScope.js";
import { withTenantScope } from "../utils/tenant.js";

/** Nested populate so borrower fullName is available on issue lists. */
const issueBorrowerPopulate = [
  { path: "bookId", select: "title author" },
  { path: "copyId", select: "bookCode status shelfLocation" },
  { path: "studentId", populate: { path: "user", select: "fullName" } },
  { path: "teacherId", populate: { path: "user", select: "fullName" } }
] as const;

const refId = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    const id = (value as { _id?: { toString(): string } | string })._id;
    return typeof id === "string" ? id : id?.toString();
  }
  if (typeof value === "object" && value !== null && "toString" in value) {
    const s = String(value);
    if (/^[a-f\d]{24}$/i.test(s)) return s;
  }
  return undefined;
};

const personFullName = (person: unknown): string | undefined => {
  if (!person || typeof person !== "object") return undefined;
  const user = (person as { user?: unknown }).user;
  if (!user || typeof user !== "object") return undefined;
  const fullName = (user as { fullName?: string }).fullName;
  return fullName?.trim() || undefined;
};

const formatIssue = (issue: Record<string, unknown>) => {
  const book = issue.bookId as { title?: string } | null | undefined;
  const copy = issue.copyId as { bookCode?: string; _id?: { toString: () => string } } | string | null | undefined;

  const studentId = refId(issue.studentId);
  const teacherId = refId(issue.teacherId);
  const borrowerName = personFullName(issue.studentId) ?? personFullName(issue.teacherId);

  const copyId =
    typeof copy === "string"
      ? copy
      : copy && typeof copy === "object" && copy._id
        ? copy._id.toString()
        : issue.copyId
          ? refId(issue.copyId)
          : undefined;

  const bookCodeFromCopy =
    typeof copy === "object" && copy && "bookCode" in copy ? copy.bookCode : undefined;

  return {
    ...issue,
    bookId: refId(issue.bookId) ?? issue.bookId,
    studentId,
    teacherId,
    copyId,
    bookCode: (issue.bookCode as string | undefined) ?? bookCodeFromCopy,
    bookTitle: book?.title,
    borrowerName: borrowerName ?? null
  };
};

const getBorrowerFilter = async (req: Request): Promise<Record<string, unknown> | null> => {
  if (req.user?.role === "STUDENT") {
    const profile = await getStudentProfile(req);
    if (!profile) {
      throw new ApiError(404, "Student profile not found");
    }
    return { borrowerType: "STUDENT", studentId: profile.studentId };
  }

  if (req.user?.role === "TEACHER") {
    const teacher = await Teacher.findOne({ user: req.user.userId }).select("_id").lean();
    if (!teacher) {
      throw new ApiError(404, "Teacher profile not found");
    }
    return { borrowerType: "TEACHER", teacherId: teacher._id };
  }

  return null;
};

const assertCodesUniqueInSchool = async (
  schoolId: string,
  codes: string[],
  excludeCopyIds: string[] = []
): Promise<void> => {
  const existing = await LibraryBookCopy.find({
    schoolId,
    bookCode: { $in: codes },
    ...(excludeCopyIds.length ? { _id: { $nin: excludeCopyIds } } : {})
  })
    .select("bookCode")
    .lean();

  if (existing.length > 0) {
    const dupes = existing.map((c) => c.bookCode).join(", ");
    throw new ApiError(409, `Book code(s) already exist in this library: ${dupes}`);
  }
};

export const getLibraryDashboard = asyncHandler(async (req: Request, res: Response) => {
  const scope = withTenantScope(req);
  await syncSchoolLibraryOverdueStatuses(req.tenantSchoolId!);

  const schoolId = req.tenantSchoolId!;

  const [books, activeIssues, recentlyIssued, totalCopies, availableCopies, issuedCopies] =
    await Promise.all([
      LibraryBook.find(scope).lean(),
      LibraryIssue.find({ ...scope, status: { $in: ["ISSUED", "OVERDUE"] } }).lean(),
      LibraryIssue.find(scope)
        .populate([...issueBorrowerPopulate])
        .sort({ createdAt: -1 })
        .limit(8)
        .lean(),
      LibraryBookCopy.countDocuments({ schoolId }),
      LibraryBookCopy.countDocuments({ schoolId, status: "AVAILABLE" }),
      LibraryBookCopy.countDocuments({ schoolId, status: "ISSUED" })
    ]);

  const useCopyInventory = totalCopies > 0;
  const enrichedBooks = books.map((book) => formatBookWithCopies(book as never, []));

  const inventoryAccessEnabled = await getLibraryInventoryAccessEnabled(req.tenantSchoolId!);

  return sendSuccess(res, "Library dashboard fetched", {
    totalBooks: useCopyInventory
      ? totalCopies
      : enrichedBooks.reduce((sum, book) => sum + book.totalCopies, 0),
    availableBooks: useCopyInventory
      ? availableCopies
      : enrichedBooks.reduce((sum, book) => sum + book.availableCopies, 0),
    issuedBooks: useCopyInventory
      ? issuedCopies
      : enrichedBooks.reduce((sum, book) => sum + book.issuedCopies, 0),
    overdueBooks: activeIssues.filter((issue) => issue.status === "OVERDUE").length,
    recentlyIssued: recentlyIssued.map((issue) => formatIssue(issue as Record<string, unknown>)),
    inventoryAccessEnabled
  });
});

export const getInventoryAccess = asyncHandler(async (req: Request, res: Response) => {
  const enabled = await getLibraryInventoryAccessEnabled(req.tenantSchoolId!);
  return sendSuccess(res, "Inventory access status fetched", { enabled });
});

export const setInventoryAccess = asyncHandler(async (req: Request, res: Response) => {
  const payload = libraryInventoryAccessSchema.parse(req.body);
  const settings = await Setting.findOneAndUpdate(
    withTenantScope(req),
    { $set: { libraryInventoryAccess: payload } },
    { new: true }
  );

  if (!settings) {
    throw new ApiError(404, "School settings not found. Configure school settings before managing inventory access.");
  }

  return sendSuccess(res, payload.enabled ? "Inventory access enabled" : "Inventory access disabled", {
    enabled: payload.enabled
  });
});

export const listBooks = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = req.tenantSchoolId!;
  const yearLevel =
    typeof req.query.yearLevel === "string" && req.query.yearLevel.trim()
      ? req.query.yearLevel.trim()
      : undefined;

  const filter = withTenantScope(
    req,
    yearLevel && yearLevel !== "ALL" ? { yearLevel } : {}
  );

  const books = await LibraryBook.find(filter).sort({ yearLevel: 1, title: 1 }).lean();
  const copiesMap = await loadCopiesForBooks(
    schoolId,
    books.map((b) => b._id)
  );

  return sendSuccess(
    res,
    "Library books fetched",
    books.map((book) => formatBookWithCopies(book as never, copiesMap.get(book._id.toString()) ?? []))
  );
});

export const createBook = asyncHandler(async (req: Request, res: Response) => {
  await assertLibraryInventoryWriteAccess(req);
  const payload = libraryBookSchema.parse(req.body);
  const schoolId = req.tenantSchoolId!;

  const copyInputs = (payload.copies ?? []).map((c) => ({
    bookCode: normalizeBookCode(c.bookCode),
    shelfLocation: c.shelfLocation?.trim() || payload.shelfLocation?.trim() || undefined,
    condition: c.condition?.trim() || undefined
  }));

  await assertCodesUniqueInSchool(
    schoolId,
    copyInputs.map((c) => c.bookCode)
  );

  const book = await LibraryBook.create({
    title: payload.title,
    author: payload.author,
    isbn: payload.isbn,
    category: payload.category,
    yearLevel: payload.yearLevel ?? "All Years",
    shelfLocation: payload.shelfLocation,
    schoolId,
    totalCopies: copyInputs.length,
    availableCopies: copyInputs.length
  });

  try {
    await LibraryBookCopy.insertMany(
      copyInputs.map((c) => ({
        schoolId,
        bookId: book._id,
        bookCode: c.bookCode,
        status: "AVAILABLE" as const,
        shelfLocation: c.shelfLocation,
        condition: c.condition
      }))
    );
  } catch (error: unknown) {
    await LibraryBook.findByIdAndDelete(book._id);
    const isDup =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: number }).code === 11000;
    if (isDup) {
      throw new ApiError(409, "One or more book codes already exist. Each physical copy needs a unique code.");
    }
    throw error;
  }

  await syncBookCopyCounts(book._id, schoolId);
  const refreshed = await LibraryBook.findById(book._id).lean();
  const copiesMap = await loadCopiesForBooks(schoolId, [book._id]);

  return sendSuccess(
    res,
    "Book added with physical copies",
    formatBookWithCopies((refreshed ?? book.toObject()) as never, copiesMap.get(book._id.toString()) ?? []),
    201
  );
});

export const updateBook = asyncHandler(async (req: Request, res: Response) => {
  await assertLibraryInventoryWriteAccess(req);
  const payload = libraryBookUpdateSchema.parse(req.body);
  const schoolId = req.tenantSchoolId!;
  const book = await LibraryBook.findOne(withTenantScope(req, { _id: req.params.id }));

  if (!book) {
    throw new ApiError(404, "Book not found");
  }

  if (payload.title !== undefined) book.title = payload.title;
  if (payload.author !== undefined) book.author = payload.author;
  if (payload.isbn !== undefined) book.isbn = payload.isbn;
  if (payload.category !== undefined) book.category = payload.category;
  if (payload.yearLevel !== undefined) book.yearLevel = payload.yearLevel;
  if (payload.shelfLocation !== undefined) book.shelfLocation = payload.shelfLocation;

  if (payload.addCopies && payload.addCopies.length > 0) {
    const copyInputs = payload.addCopies.map((c) => ({
      bookCode: normalizeBookCode(c.bookCode),
      shelfLocation: c.shelfLocation?.trim() || book.shelfLocation || undefined,
      condition: c.condition?.trim() || undefined
    }));

    const codes = copyInputs.map((c) => c.bookCode);
    const localDupes = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (localDupes.length > 0) {
      throw new ApiError(400, `Duplicate book codes in request: ${[...new Set(localDupes)].join(", ")}`);
    }

    await assertCodesUniqueInSchool(schoolId, codes);

    try {
      await LibraryBookCopy.insertMany(
        copyInputs.map((c) => ({
          schoolId,
          bookId: book._id,
          bookCode: c.bookCode,
          status: "AVAILABLE" as const,
          shelfLocation: c.shelfLocation,
          condition: c.condition
        }))
      );
    } catch (error: unknown) {
      const isDup =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: number }).code === 11000;
      if (isDup) {
        throw new ApiError(409, "One or more book codes already exist. Each physical copy needs a unique code.");
      }
      throw error;
    }
  }

  await book.save();
  await syncBookCopyCounts(book._id, schoolId);

  const refreshed = await LibraryBook.findById(book._id).lean();
  const copiesMap = await loadCopiesForBooks(schoolId, [book._id]);

  return sendSuccess(
    res,
    "Book updated",
    formatBookWithCopies((refreshed ?? book.toObject()) as never, copiesMap.get(book._id.toString()) ?? [])
  );
});

export const deleteBook = asyncHandler(async (req: Request, res: Response) => {
  await assertLibraryInventoryWriteAccess(req);
  const schoolId = req.tenantSchoolId!;
  const bookId = req.params.id;

  const activeIssues = await LibraryIssue.countDocuments(
    withTenantScope(req, { bookId, status: { $in: ["ISSUED", "OVERDUE"] } })
  );

  if (activeIssues > 0) {
    throw new ApiError(400, "Cannot delete a book with active issues");
  }

  const issuedCopies = await LibraryBookCopy.countDocuments({
    schoolId,
    bookId,
    status: "ISSUED"
  });
  if (issuedCopies > 0) {
    throw new ApiError(400, "Cannot delete a book while physical copies are still issued");
  }

  const book = await LibraryBook.findOneAndDelete(withTenantScope(req, { _id: bookId }));
  if (!book) {
    throw new ApiError(404, "Book not found");
  }

  await LibraryBookCopy.deleteMany({ schoolId, bookId });
  await LibraryIssue.deleteMany(withTenantScope(req, { bookId, status: "RETURNED" }));

  return sendSuccess(res, "Book deleted");
});

export const listIssues = asyncHandler(async (req: Request, res: Response) => {
  await syncSchoolLibraryOverdueStatuses(req.tenantSchoolId!);

  const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
  const scope = withTenantScope(req);

  let statusFilter: Record<string, unknown> = {};
  if (statusParam === "active") {
    statusFilter = { status: { $in: ["ISSUED", "OVERDUE"] } };
  } else if (statusParam === "returned") {
    statusFilter = { status: "RETURNED" };
  }

  const issues = await LibraryIssue.find({ ...scope, ...statusFilter })
    .populate([...issueBorrowerPopulate])
    .sort({ createdAt: -1 })
    .lean();

  return sendSuccess(
    res,
    "Library issues fetched",
    issues.map((issue) => formatIssue(issue as Record<string, unknown>))
  );
});

export const listMyBooks = asyncHandler(async (req: Request, res: Response) => {
  const borrowerFilter = await getBorrowerFilter(req);
  if (!borrowerFilter) {
    throw new ApiError(403, "Only students and teachers can view borrowed books");
  }

  await syncSchoolLibraryOverdueStatuses(req.tenantSchoolId!);

  const issues = await LibraryIssue.find(withTenantScope(req, borrowerFilter))
    .populate([...issueBorrowerPopulate])
    .sort({ createdAt: -1 });

  const todayBs = getTodayBs();
  const enriched = await Promise.all(
    issues.map(async (issue) => {
      const book = issue.bookId as { title?: string } | null;
      const status = await processLibraryIssueReminders(
        req.tenantSchoolId!,
        issue,
        book?.title ?? "Book",
        todayBs
      );
      return {
        ...formatIssue(issue.toObject() as Record<string, unknown>),
        status
      };
    })
  );

  return sendSuccess(res, "Borrowed books fetched", enriched);
});

export const issueBook = asyncHandler(async (req: Request, res: Response) => {
  const payload = libraryIssueSchema.parse(req.body);
  const schoolId = req.tenantSchoolId!;

  if (compareBsDates(payload.dueDateBs, payload.issuedDateBs) < 0) {
    throw new ApiError(400, "Due date cannot be before the issue date");
  }

  const book = await LibraryBook.findOne(withTenantScope(req, { _id: payload.bookId }));
  if (!book) {
    throw new ApiError(404, "Book not found");
  }

  const copyFilter = payload.copyId
    ? { _id: payload.copyId, schoolId, bookId: book._id }
    : payload.bookCode
      ? {
          schoolId,
          bookId: book._id,
          bookCode: normalizeBookCode(payload.bookCode)
        }
      : null;

  if (!copyFilter) {
    throw new ApiError(400, "Select a physical book copy (book code) to issue");
  }

  const copy = await LibraryBookCopy.findOne(copyFilter).lean();

  if (!copy) {
    throw new ApiError(404, "Physical book copy not found. Select a valid book code.");
  }

  if (copy.status !== "AVAILABLE") {
    throw new ApiError(400, `Copy ${copy.bookCode} is not available (status: ${copy.status})`);
  }

  // Atomic claim of the physical copy
  const claimed = await LibraryBookCopy.findOneAndUpdate(
    { _id: copy._id, schoolId, status: "AVAILABLE" },
    { $set: { status: "ISSUED" } },
    { new: true }
  );

  if (!claimed) {
    throw new ApiError(400, `Copy ${copy.bookCode} was just issued to someone else`);
  }

  if (payload.borrowerType === "STUDENT") {
    const student = await Student.findOne(withTenantScope(req, { _id: payload.studentId }));
    if (!student) {
      await LibraryBookCopy.updateOne({ _id: copy._id }, { $set: { status: "AVAILABLE" } });
      throw new ApiError(404, "Student not found");
    }
  } else {
    const teacher = await Teacher.findOne(withTenantScope(req, { _id: payload.teacherId }));
    if (!teacher) {
      await LibraryBookCopy.updateOne({ _id: copy._id }, { $set: { status: "AVAILABLE" } });
      throw new ApiError(404, "Teacher not found");
    }
  }

  const issue = await LibraryIssue.create({
    schoolId,
    bookId: book._id,
    copyId: claimed._id,
    bookCode: claimed.bookCode,
    borrowerType: payload.borrowerType,
    studentId: payload.studentId,
    teacherId: payload.teacherId,
    issuedDateBs: payload.issuedDateBs,
    dueDateBs: payload.dueDateBs,
    status: "ISSUED"
  });

  await syncBookCopyCounts(book._id, schoolId);

  const displayTitle = `${book.title} [${claimed.bookCode}]`;

  if (payload.borrowerType === "STUDENT" && payload.studentId) {
    const student = await Student.findById(payload.studentId).select("user").lean();
    if (student?.user) {
      await sendNotification({
        schoolId,
        recipientUserId: student.user.toString(),
        title: "Library book issued",
        message: `${displayTitle} — due ${payload.dueDateBs}`,
        type: "LIBRARY",
        channel: "BOTH",
        metadata: { libraryIssueId: issue._id.toString() }
      });
    }

    await notifyParentsOfStudent(
      schoolId,
      payload.studentId,
      "Library book issued",
      `${displayTitle} — due ${payload.dueDateBs}`,
      "LIBRARY"
    );
  } else if (payload.borrowerType === "TEACHER" && payload.teacherId) {
    const teacher = await Teacher.findById(payload.teacherId).select("user").lean();
    if (teacher?.user) {
      await sendNotification({
        schoolId,
        recipientUserId: teacher.user.toString(),
        title: "Library book issued",
        message: `${displayTitle} — due ${payload.dueDateBs}`,
        type: "LIBRARY",
        channel: "BOTH",
        metadata: { libraryIssueId: issue._id.toString() }
      });
    }
  }

  return sendSuccess(res, "Book issued", issue, 201);
});

export const returnBook = asyncHandler(async (req: Request, res: Response) => {
  const payload = libraryReturnSchema.parse(req.body);
  const schoolId = req.tenantSchoolId!;
  const issue = await LibraryIssue.findOne(
    withTenantScope(req, { _id: req.params.id, status: { $in: ["ISSUED", "OVERDUE"] } })
  );

  if (!issue) {
    throw new ApiError(404, "Active issue not found");
  }

  if (compareBsDates(payload.returnedDateBs, issue.issuedDateBs) < 0) {
    throw new ApiError(400, "Return date cannot be before the issue date");
  }

  const book = await LibraryBook.findById(issue.bookId).select("title").lean();
  const bookTitle = book?.title ?? "Book";
  const codeLabel = issue.bookCode ? ` [${issue.bookCode}]` : "";

  issue.status = "RETURNED";
  issue.returnedDateBs = payload.returnedDateBs;
  issue.fineNpr = payload.fineNpr;
  await issue.save();

  if (issue.copyId) {
    await LibraryBookCopy.findOneAndUpdate(
      { _id: issue.copyId, schoolId, status: "ISSUED" },
      { $set: { status: "AVAILABLE" } }
    );
  } else {
    // Legacy issues without copyId
    await LibraryBook.findByIdAndUpdate(issue.bookId, { $inc: { availableCopies: 1 } });
  }

  await syncBookCopyCounts(issue.bookId, schoolId);

  const fineMessage = payload.fineNpr > 0 ? ` Fine: NPR ${payload.fineNpr}.` : "";

  if (issue.borrowerType === "STUDENT" && issue.studentId) {
    const student = await Student.findById(issue.studentId).select("user").lean();
    if (student?.user) {
      await sendNotification({
        schoolId,
        recipientUserId: student.user.toString(),
        title: "Library book returned",
        message: `"${bookTitle}${codeLabel}" was returned on ${payload.returnedDateBs}.${fineMessage}`,
        type: "LIBRARY",
        channel: "BOTH",
        metadata: { libraryIssueId: issue._id.toString(), action: "RETURNED" }
      });
    }

    await notifyParentsOfStudent(
      schoolId,
      issue.studentId.toString(),
      "Library book returned",
      `"${bookTitle}${codeLabel}" was returned on ${payload.returnedDateBs}.${fineMessage}`,
      "LIBRARY"
    );
  } else if (issue.borrowerType === "TEACHER" && issue.teacherId) {
    const teacher = await Teacher.findById(issue.teacherId).select("user").lean();
    if (teacher?.user) {
      await sendNotification({
        schoolId,
        recipientUserId: teacher.user.toString(),
        title: "Library book returned",
        message: `"${bookTitle}${codeLabel}" was returned on ${payload.returnedDateBs}.${fineMessage}`,
        type: "LIBRARY",
        channel: "BOTH",
        metadata: { libraryIssueId: issue._id.toString(), action: "RETURNED" }
      });
    }
  }

  return sendSuccess(res, "Book returned", issue);
});

export const listLibraryStaff = asyncHandler(async (req: Request, res: Response) => {
  const staff = await User.find(withTenantScope(req, { role: "LIBRARY_STAFF" }))
    .select("-password")
    .sort({ createdAt: -1 });
  return sendSuccess(res, "Library staff fetched", staff);
});

export const createLibraryStaff = asyncHandler(async (req: Request, res: Response) => {
  const payload = moduleStaffSchema.parse(req.body);
  const email = payload.email.toLowerCase().trim();
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    throw new ApiError(409, "A user with this email already exists");
  }

  const { password: portalPassword, wasGenerated } = resolvePortalPassword(payload.password);
  const user = await User.create({
    schoolId: req.tenantSchoolId,
    fullName: payload.fullName,
    email,
    phone: payload.phone,
    password: portalPassword,
    role: "LIBRARY_STAFF",
    mustChangePassword: wasGenerated
  });

  const safeUser = await User.findById(user._id).select("-password").lean();
  const credentialsEmail = await notifyAccountCredentials({
    userId: user._id.toString(),
    fullName: payload.fullName,
    email,
    password: portalPassword,
    schoolId: req.tenantSchoolId?.toString(),
    req
  });

  return sendSuccess(
    res,
    buildCredentialsAdminMessage(credentialsEmail),
    {
      staff: safeUser,
      loginEmail: email,
      defaultPassword: portalPassword,
      credentialsEmail
    },
    201
  );
});

export const updateLibraryStaff = asyncHandler(async (req: Request, res: Response) => {
  const payload = moduleStaffSchema.partial().parse(req.body);
  const user = await User.findOne(withTenantScope(req, { _id: req.params.id, role: "LIBRARY_STAFF" }));

  if (!user) {
    throw new ApiError(404, "Library staff not found");
  }

  if (payload.fullName) user.fullName = payload.fullName;
  if (payload.phone !== undefined) user.phone = payload.phone;
  if (payload.email) {
    const email = payload.email.toLowerCase().trim();
    const duplicate = await User.findOne({ email, _id: { $ne: user._id } });
    if (duplicate) {
      throw new ApiError(409, "A user with this email already exists");
    }
    user.email = email;
  }
  if (payload.password) {
    user.password = payload.password;
    user.mustChangePassword = false;
  }

  await user.save();
  const safeUser = await User.findById(user._id).select("-password").lean();
  return sendSuccess(res, "Library staff updated", safeUser);
});

export const deleteLibraryStaff = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id, role: "LIBRARY_STAFF" }),
    { isActive: false },
    { new: true }
  ).select("-password");

  if (!user) {
    throw new ApiError(404, "Library staff not found");
  }

  return sendSuccess(res, "Library staff deactivated", user);
});
