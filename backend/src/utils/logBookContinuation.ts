/**
 * Official syllabus / session / lesson plans belong to the subject + batch/year.
 * Log book is teacher-specific:
 * - Continue leftover → incoming teacher continues the class log from leftover work.
 * - FULL (100%) assignment → incoming teacher starts a new log book from serial 1.
 */

export type LeftoverAssignmentLink = {
  _id: string;
  teacherId: string;
  subjectId: string;
  academicYearBs: string;
  classId?: string | null;
  sectionId?: string | null;
  batchId?: string | null;
  yearId?: string | null;
  assignmentType?: string;
  handoverBaselinePercent?: number | null;
  supersedesAssignmentId?: string | null;
};

export const assignmentContinuesLeftover = (
  row: Pick<LeftoverAssignmentLink, "handoverBaselinePercent">
): boolean => {
  const baseline = Number(row.handoverBaselinePercent);
  return row.handoverBaselinePercent != null && Number.isFinite(baseline);
};

/**
 * Walk SUPERSEDED predecessors when the current assignment continues leftover
 * work. FULL 100% assignments (no handover baseline) start a fresh log book.
 */
export const collectLeftoverChainTeacherIds = (
  byId: Map<string, LeftoverAssignmentLink>,
  current: LeftoverAssignmentLink
): { continueLeftover: boolean; teacherIds: string[] } => {
  if (!assignmentContinuesLeftover(current)) {
    return { continueLeftover: false, teacherIds: [current.teacherId] };
  }

  const teacherIds: string[] = [];
  const seen = new Set<string>();
  let cursor: LeftoverAssignmentLink | undefined = current;
  while (cursor && !seen.has(cursor._id)) {
    seen.add(cursor._id);
    if (cursor.teacherId && !teacherIds.includes(cursor.teacherId)) {
      teacherIds.push(cursor.teacherId);
    }
    const nextId = cursor.supersedesAssignmentId?.trim();
    if (!nextId) break;
    cursor = byId.get(nextId);
  }
  return { continueLeftover: true, teacherIds };
};
