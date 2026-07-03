import type { Request, Response } from "express";
import {
  libraryBookSchema,
  libraryIssueSchema,
  libraryReturnSchema,
  moduleStaffSchema
} from "@nepal-school-erp/shared";
import { env } from "../config/env.js";
import { LibraryBook, LibraryIssue } from "../models/LibraryBook.js";
import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { enrichBookInventory } from "../utils/inventory.js";
import { processLibraryIssueReminders, syncSchoolLibraryOverdueStatuses } from "../utils/libraryNotifications.js";
import { getTodayBs } from "../utils/nepaliDate.js";
import { notifyParentsOfStudent, sendNotification } from "../utils/notificationService.js";
import { sendSuccess } from "../utils/response.js";
import { getStudentProfile } from "../utils/studentScope.js";
import { withTenantScope } from "../utils/tenant.js";

const formatIssue = (issue: Record<string, unknown>) => {
  const book = issue.bookId as { title?: string } | null | undefined;
  const student = issue.studentId as { user?: { fullName?: string } } | null | undefined;
  const teacher = issue.teacherId as { user?: { fullName?: string } } | null | undefined;

  return {
    ...issue,
    bookTitle: book?.title,
    borrowerName: student?.user?.fullName ?? teacher?.user?.fullName
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

export const getLibraryDashboard = asyncHandler(async (req: Request, res: Response) => {
  const scope = withTenantScope(req);
  await syncSchoolLibraryOverdueStatuses(req.tenantSchoolId!);

  const [books, activeIssues, recentlyIssued] = await Promise.all([
    LibraryBook.find(scope).lean(),
    LibraryIssue.find({ ...scope, status: { $in: ["ISSUED", "OVERDUE"] } }).lean(),
    LibraryIssue.find(scope).populate("bookId").populate("studentId").populate("teacherId").sort({ createdAt: -1 }).limit(8).lean()
  ]);

  const enrichedBooks = books.map((book) => enrichBookInventory(book));
  const availableBooks = enrichedBooks.reduce((sum, book) => sum + book.availableCopies, 0);
  const issuedBooks = enrichedBooks.reduce((sum, book) => sum + book.issuedCopies, 0);
  const overdueBooks = activeIssues.filter((issue) => issue.status === "OVERDUE").length;

  return sendSuccess(res, "Library dashboard fetched", {
    totalBooks: enrichedBooks.reduce((sum, book) => sum + book.totalCopies, 0),
    availableBooks,
    issuedBooks,
    overdueBooks,
    recentlyIssued: recentlyIssued.map((issue) => formatIssue(issue as Record<string, unknown>))
  });
});

export const listBooks = asyncHandler(async (req: Request, res: Response) => {
  const books = await LibraryBook.find(withTenantScope(req)).sort({ title: 1 }).lean();
  return sendSuccess(res, "Library books fetched", books.map((book) => enrichBookInventory(book)));
});

export const createBook = asyncHandler(async (req: Request, res: Response) => {
  const payload = libraryBookSchema.parse(req.body);
  const book = await LibraryBook.create({
    ...payload,
    schoolId: req.tenantSchoolId,
    availableCopies: payload.totalCopies
  });

  return sendSuccess(res, "Book added", enrichBookInventory(book.toObject()), 201);
});

export const updateBook = asyncHandler(async (req: Request, res: Response) => {
  const payload = libraryBookSchema.partial().parse(req.body);
  const book = await LibraryBook.findOne(withTenantScope(req, { _id: req.params.id }));

  if (!book) {
    throw new ApiError(404, "Book not found");
  }

  if (payload.totalCopies !== undefined) {
    const issuedCopies = book.totalCopies - book.availableCopies;
    const nextAvailable = payload.totalCopies - issuedCopies;

    if (nextAvailable < 0) {
      throw new ApiError(400, "Total copies cannot be less than currently issued copies");
    }

    book.totalCopies = payload.totalCopies;
    book.availableCopies = nextAvailable;
  }

  if (payload.title !== undefined) book.title = payload.title;
  if (payload.author !== undefined) book.author = payload.author;
  if (payload.isbn !== undefined) book.isbn = payload.isbn;
  if (payload.category !== undefined) book.category = payload.category;
  if (payload.shelfLocation !== undefined) book.shelfLocation = payload.shelfLocation;

  await book.save();
  return sendSuccess(res, "Book updated", enrichBookInventory(book.toObject()));
});

export const deleteBook = asyncHandler(async (req: Request, res: Response) => {
  const activeIssues = await LibraryIssue.countDocuments(
    withTenantScope(req, { bookId: req.params.id, status: { $in: ["ISSUED", "OVERDUE"] } })
  );

  if (activeIssues > 0) {
    throw new ApiError(400, "Cannot delete a book with active issues");
  }

  const book = await LibraryBook.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!book) {
    throw new ApiError(404, "Book not found");
  }

  return sendSuccess(res, "Book deleted");
});

export const listIssues = asyncHandler(async (req: Request, res: Response) => {
  await syncSchoolLibraryOverdueStatuses(req.tenantSchoolId!);

  const issues = await LibraryIssue.find(withTenantScope(req))
    .populate("bookId")
    .populate({ path: "studentId", populate: { path: "user", select: "fullName" } })
    .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
    .sort({ createdAt: -1 });

  return sendSuccess(res, "Library issues fetched", issues.map((issue) => formatIssue(issue.toObject() as Record<string, unknown>)));
});

export const listMyBooks = asyncHandler(async (req: Request, res: Response) => {
  const borrowerFilter = await getBorrowerFilter(req);
  if (!borrowerFilter) {
    throw new ApiError(403, "Only students and teachers can view borrowed books");
  }

  await syncSchoolLibraryOverdueStatuses(req.tenantSchoolId!);

  const issues = await LibraryIssue.find(withTenantScope(req, borrowerFilter))
    .populate("bookId")
    .sort({ createdAt: -1 });

  const todayBs = getTodayBs();
  const enriched = await Promise.all(
    issues.map(async (issue) => {
      const book = issue.bookId as { title?: string } | null;
      const status = await processLibraryIssueReminders(req.tenantSchoolId!, issue, book?.title ?? "Book", todayBs);
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
  const book = await LibraryBook.findOne(withTenantScope(req, { _id: payload.bookId }));

  if (!book || book.availableCopies < 1) {
    throw new ApiError(400, "Book is not available");
  }

  if (payload.borrowerType === "STUDENT") {
    const student = await Student.findOne(withTenantScope(req, { _id: payload.studentId }));
    if (!student) {
      throw new ApiError(404, "Student not found");
    }
  } else {
    const teacher = await Teacher.findOne(withTenantScope(req, { _id: payload.teacherId }));
    if (!teacher) {
      throw new ApiError(404, "Teacher not found");
    }
  }

  book.availableCopies -= 1;
  await book.save();

  const issue = await LibraryIssue.create({
    ...payload,
    schoolId: req.tenantSchoolId,
    status: "ISSUED"
  });

  if (payload.borrowerType === "STUDENT" && payload.studentId) {
    const student = await Student.findById(payload.studentId).select("user").lean();
    if (student?.user) {
      await sendNotification({
        schoolId: req.tenantSchoolId!,
        recipientUserId: student.user.toString(),
        title: "Library book issued",
        message: `${book.title} — due ${payload.dueDateBs}`,
        type: "LIBRARY",
        channel: "BOTH",
        metadata: { libraryIssueId: issue._id.toString() }
      });
    }

    await notifyParentsOfStudent(
      req.tenantSchoolId!,
      payload.studentId,
      "Library book issued",
      `${book.title} — due ${payload.dueDateBs}`,
      "LIBRARY"
    );
  } else if (payload.borrowerType === "TEACHER" && payload.teacherId) {
    const teacher = await Teacher.findById(payload.teacherId).select("user").lean();
    if (teacher?.user) {
      await sendNotification({
        schoolId: req.tenantSchoolId!,
        recipientUserId: teacher.user.toString(),
        title: "Library book issued",
        message: `${book.title} — due ${payload.dueDateBs}`,
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
  const issue = await LibraryIssue.findOne(
    withTenantScope(req, { _id: req.params.id, status: { $in: ["ISSUED", "OVERDUE"] } })
  );

  if (!issue) {
    throw new ApiError(404, "Active issue not found");
  }

  issue.status = "RETURNED";
  issue.returnedDateBs = payload.returnedDateBs;
  issue.fineNpr = payload.fineNpr;
  await issue.save();

  await LibraryBook.findByIdAndUpdate(issue.bookId, { $inc: { availableCopies: 1 } });
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

  const user = await User.create({
    schoolId: req.tenantSchoolId,
    fullName: payload.fullName,
    email,
    phone: payload.phone,
    password: payload.password ?? env.DEFAULT_USER_PASSWORD,
    role: "LIBRARY_STAFF",
    mustChangePassword: !payload.password
  });

  const safeUser = await User.findById(user._id).select("-password").lean();
  return sendSuccess(res, "Library staff created", safeUser, 201);
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

