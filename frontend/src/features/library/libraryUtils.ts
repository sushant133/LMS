import type { LibraryIssueRecord, LibraryIssueStatus } from "@phit-erp/shared";

export const ACTIVE_LIBRARY_ISSUE_STATUSES: LibraryIssueStatus[] = ["ISSUED", "OVERDUE"];

export const isActiveLibraryIssue = (issue: LibraryIssueRecord): boolean =>
  ACTIVE_LIBRARY_ISSUE_STATUSES.includes(issue.status);

export const filterLibraryIssues = (issues: LibraryIssueRecord[], query: string): LibraryIssueRecord[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return issues;

  return issues.filter((issue) => {
    const bookTitle = issue.bookTitle?.toLowerCase() ?? "";
    const borrowerName = issue.borrowerName?.toLowerCase() ?? "";
    return bookTitle.includes(normalized) || borrowerName.includes(normalized);
  });
};