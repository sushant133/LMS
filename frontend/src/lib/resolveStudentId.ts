/** Normalize studentId from API responses (string or populated document). */
export const resolveStudentId = (value: string | { _id?: string } | null | undefined): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value._id ?? null;
};