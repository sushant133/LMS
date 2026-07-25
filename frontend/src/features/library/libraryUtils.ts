import type { LibraryIssueRecord, LibraryIssueStatus } from "@phit-erp/shared";

export const ACTIVE_LIBRARY_ISSUE_STATUSES: LibraryIssueStatus[] = [
  "ISSUED",
  "OVERDUE",
];

export const isActiveLibraryIssue = (issue: LibraryIssueRecord): boolean =>
  ACTIVE_LIBRARY_ISSUE_STATUSES.includes(issue.status);

export const filterLibraryIssues = (
  issues: LibraryIssueRecord[],
  query: string,
): LibraryIssueRecord[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return issues;

  return issues.filter((issue) => {
    const bookTitle = issue.bookTitle?.toLowerCase() ?? "";
    const borrowerName = issue.borrowerName?.toLowerCase() ?? "";
    const bookCode = issue.bookCode?.toLowerCase() ?? "";
    const issuedBy = issue.issuedByName?.toLowerCase() ?? "";
    return (
      bookTitle.includes(normalized) ||
      borrowerName.includes(normalized) ||
      bookCode.includes(normalized) ||
      issuedBy.includes(normalized)
    );
  });
};

export type IssuedBooksFilter = {
  searchQuery?: string;
  batchId?: string;
  yearId?: string;
  classId?: string;
  sectionId?: string;
  status?: "ALL" | "ISSUED" | "OVERDUE";
};

/** Filter issued-book rows by name/code search and academic placement. */
export const filterIssuedBooks = (
  issues: LibraryIssueRecord[],
  filters: IssuedBooksFilter,
): LibraryIssueRecord[] => {
  let list = issues;

  if (filters.status && filters.status !== "ALL") {
    list = list.filter((issue) => issue.status === filters.status);
  }
  if (filters.batchId) {
    list = list.filter((issue) => issue.studentBatchId === filters.batchId);
  }
  if (filters.yearId) {
    list = list.filter((issue) => issue.studentYearId === filters.yearId);
  }
  if (filters.classId) {
    list = list.filter((issue) => issue.studentClassId === filters.classId);
  }
  if (filters.sectionId) {
    list = list.filter((issue) => issue.studentSectionId === filters.sectionId);
  }

  const q = filters.searchQuery?.trim().toLowerCase() ?? "";
  if (!q) return list;

  return list.filter((issue) => {
    const bookTitle = issue.bookTitle?.toLowerCase() ?? "";
    const borrowerName = issue.borrowerName?.toLowerCase() ?? "";
    const bookCode = issue.bookCode?.toLowerCase() ?? "";
    const issuedBy = issue.issuedByName?.toLowerCase() ?? "";
    const batch = issue.studentBatchName?.toLowerCase() ?? "";
    const year = issue.studentYearName?.toLowerCase() ?? "";
    const klass = issue.studentClassName?.toLowerCase() ?? "";
    return (
      bookTitle.includes(q) ||
      borrowerName.includes(q) ||
      bookCode.includes(q) ||
      issuedBy.includes(q) ||
      batch.includes(q) ||
      year.includes(q) ||
      klass.includes(q)
    );
  });
};

/** Human-readable issuer label: "Library Staff (Name)" / "Admin (Name)". */
export const formatIssuedByLabel = (
  issue: Pick<LibraryIssueRecord, "issuedByName" | "issuedByRole">,
): string => {
  const name = issue.issuedByName?.trim();
  if (!name) return "—";

  const role = issue.issuedByRole ?? "";
  if (role === "LIBRARY_STAFF") {
    return `Library Staff (${name})`;
  }
  if (role === "COLLEGE_ADMIN" || role === "SUPER_ADMIN") {
    return `Admin (${name})`;
  }
  if (role) {
    return `${role.replace(/_/g, " ")} (${name})`;
  }
  return name;
};

export type FilterOption = { _id: string; name: string };

export const uniqueBatchOptionsFromIssues = (
  issues: LibraryIssueRecord[],
): FilterOption[] => {
  const map = new Map<string, string>();
  for (const issue of issues) {
    if (issue.studentBatchId) {
      map.set(
        issue.studentBatchId,
        issue.studentBatchName?.trim() || "Batch",
      );
    }
  }
  return [...map.entries()]
    .map(([id, name]) => ({ _id: id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const uniqueYearOptionsFromIssues = (
  issues: LibraryIssueRecord[],
  batchId?: string,
): FilterOption[] => {
  const map = new Map<string, string>();
  for (const issue of issues) {
    if (batchId && issue.studentBatchId !== batchId) continue;
    if (issue.studentYearId) {
      map.set(issue.studentYearId, issue.studentYearName?.trim() || "Year");
    }
  }
  return [...map.entries()]
    .map(([id, name]) => ({ _id: id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const uniqueClassOptionsFromIssues = (
  issues: LibraryIssueRecord[],
): FilterOption[] => {
  const map = new Map<string, string>();
  for (const issue of issues) {
    if (issue.studentClassId) {
      map.set(
        issue.studentClassId,
        issue.studentClassName?.trim() || "Class",
      );
    }
  }
  return [...map.entries()]
    .map(([id, name]) => ({ _id: id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const uniqueSectionOptionsFromIssues = (
  issues: LibraryIssueRecord[],
  classId?: string,
): FilterOption[] => {
  const map = new Map<string, string>();
  for (const issue of issues) {
    if (classId && issue.studentClassId !== classId) continue;
    if (issue.studentSectionId) {
      map.set(
        issue.studentSectionId,
        issue.studentSectionName?.trim() || "Section",
      );
    }
  }
  return [...map.entries()]
    .map(([id, name]) => ({ _id: id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};
