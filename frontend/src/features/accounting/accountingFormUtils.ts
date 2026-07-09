/** Normalizes empty form strings to undefined so optional MongoDB refs pass validation. */
export const emptyIdsToUndefined = <T extends Record<string, unknown>>(
  payload: T,
  keys: string[],
): T => {
  const next = { ...payload };
  for (const key of keys) {
    if (next[key] === "") {
      delete next[key];
    }
  }
  return next;
};

export const getSalaryEmployeeLabel = (row: {
  teacher?: { user?: { fullName?: string } };
  collegeStaff?: { fullName?: string };
  staffName?: string;
}): string =>
  row.teacher?.user?.fullName ??
  row.collegeStaff?.fullName ??
  row.staffName ??
  "—";
