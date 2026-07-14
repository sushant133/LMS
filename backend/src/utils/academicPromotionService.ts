import type { ClientSession, Types } from "mongoose";
import type {
  AcademicPromotionGroupSummary,
  AcademicPromotionPreview,
  AcademicPromotionRecord,
  AcademicPromotionStudentSnapshot,
  StudentAcademicStatus
} from "@phit-erp/shared";
import { DEFAULT_ACADEMIC_YEAR_BS, NON_PROMOTABLE_STUDENT_STATUSES } from "@phit-erp/shared";
import { AcademicPromotion } from "../models/AcademicPromotion.js";
import { Batch } from "../models/Batch.js";
import { FeeStructure } from "../models/FeeStructure.js";
import { Student } from "../models/Student.js";
import { Year } from "../models/Year.js";
import { ApiError } from "./apiError.js";
import { getSessionOption, withTransaction } from "./transaction.js";

type ObjectIdLike = Types.ObjectId | string;

interface BuildPreviewOptions {
  schoolId: ObjectIdLike;
  academicSessionBs?: string;
}

interface ExecutePromotionOptions {
  schoolId: ObjectIdLike;
  academicSessionBs: string;
  promotedBy: ObjectIdLike;
  promotedByName: string;
  remarks?: string;
}

interface RollbackPromotionOptions {
  schoolId: ObjectIdLike;
  rolledBackBy: ObjectIdLike;
  rolledBackByName: string;
  remarks?: string;
}

const asString = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "toString" in value) {
    return String((value as { toString(): string }).toString());
  }
  return String(value);
};

const resolveAcademicStatus = (status?: string | null): StudentAcademicStatus => {
  if (!status || status === "ACTIVE") {
    return "ACTIVE";
  }
  if ((NON_PROMOTABLE_STUDENT_STATUSES as readonly string[]).includes(status)) {
    return status as StudentAcademicStatus;
  }
  return "ACTIVE";
};

const isPromotableStatus = (status?: string | null): boolean => resolveAcademicStatus(status) === "ACTIVE";

const serializePromotion = (doc: {
  _id: { toString(): string };
  schoolId: { toString(): string };
  academicSessionBs: string;
  promotionDate: Date;
  promotedBy: { toString(): string };
  promotedByName: string;
  remarks?: string | null;
  status: string;
  totalStudents: number;
  groups: AcademicPromotionGroupSummary[];
  rolledBackAt?: Date | null;
  rolledBackBy?: { toString(): string } | null;
  rolledBackByName?: string | null;
  rollbackRemarks?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  toObject?: () => Record<string, unknown>;
}): AcademicPromotionRecord => {
  const raw = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const groups = (raw.groups as AcademicPromotionGroupSummary[] | undefined) ?? doc.groups ?? [];

  return {
    _id: asString(doc._id),
    schoolId: asString(doc.schoolId),
    academicSessionBs: doc.academicSessionBs,
    promotionDate: (doc.promotionDate ?? new Date()).toISOString(),
    promotedBy: asString(doc.promotedBy),
    promotedByName: doc.promotedByName,
    remarks: doc.remarks ?? undefined,
    status: doc.status as AcademicPromotionRecord["status"],
    totalStudents: doc.totalStudents,
    groups: groups.map((group) => ({
      ...group,
      batchId: asString(group.batchId as unknown as ObjectIdLike),
      previousYearId: group.previousYearId ? asString(group.previousYearId as unknown as ObjectIdLike) : undefined,
      newYearId: group.newYearId ? asString(group.newYearId as unknown as ObjectIdLike) : undefined,
      students: (group.students ?? []).map((student) => ({
        ...student,
        studentId: asString(student.studentId as unknown as ObjectIdLike),
        batchId: asString(student.batchId as unknown as ObjectIdLike),
        previousYearId: student.previousYearId
          ? asString(student.previousYearId as unknown as ObjectIdLike)
          : undefined,
        newYearId: student.newYearId ? asString(student.newYearId as unknown as ObjectIdLike) : undefined
      }))
    })),
    rolledBackAt: doc.rolledBackAt ? doc.rolledBackAt.toISOString() : undefined,
    rolledBackBy: doc.rolledBackBy ? asString(doc.rolledBackBy) : undefined,
    rolledBackByName: doc.rolledBackByName ?? undefined,
    rollbackRemarks: doc.rollbackRemarks ?? undefined,
    createdAt: doc.createdAt?.toISOString?.() ?? (doc.createdAt as unknown as string | undefined),
    updatedAt: doc.updatedAt?.toISOString?.() ?? (doc.updatedAt as unknown as string | undefined)
  };
};

const buildGroupsFromStudents = (params: {
  students: Array<{
    _id: { toString(): string };
    admissionNumber: string;
    academicStatus?: string | null;
    batchId?: ObjectIdLike | null;
    yearId?: ObjectIdLike | null;
    user?: { fullName?: string } | null;
  }>;
  yearsById: Map<string, { _id: { toString(): string }; name: string; level: number; batchId: ObjectIdLike }>;
  yearsByBatchLevel: Map<string, Map<number, { _id: { toString(): string }; name: string; level: number }>>;
  batchesById: Map<string, { _id: { toString(): string }; name: string; isActive?: boolean }>;
}): {
  groups: AcademicPromotionGroupSummary[];
  validationErrors: string[];
  validationWarnings: string[];
} => {
  const groupMap = new Map<string, AcademicPromotionGroupSummary>();
  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];
  let skippedNoYear = 0;
  let skippedNoBatch = 0;
  let skippedInactiveBatch = 0;

  for (const student of params.students) {
    const status = resolveAcademicStatus(student.academicStatus);
    if (!isPromotableStatus(status)) {
      continue;
    }

    const batchId = asString(student.batchId);
    const yearId = asString(student.yearId);

    if (!batchId) {
      skippedNoBatch += 1;
      continue;
    }
    if (!yearId) {
      skippedNoYear += 1;
      continue;
    }

    const batch = params.batchesById.get(batchId);
    if (!batch) {
      validationErrors.push(`Student ${student.admissionNumber} references a missing batch.`);
      continue;
    }
    if (batch.isActive === false) {
      skippedInactiveBatch += 1;
      continue;
    }

    const currentYear = params.yearsById.get(yearId);
    if (!currentYear) {
      validationErrors.push(`Student ${student.admissionNumber} references a missing year.`);
      continue;
    }

    const batchYears = params.yearsByBatchLevel.get(batchId);
    if (!batchYears || batchYears.size === 0) {
      validationErrors.push(`Batch ${batch.name} has no year configuration.`);
      continue;
    }

    const maxLevel = Math.max(...batchYears.keys());
    const isFinalYear = currentYear.level >= maxLevel;
    const nextYear = isFinalYear ? undefined : batchYears.get(currentYear.level + 1);

    if (!isFinalYear && !nextYear) {
      validationErrors.push(
        `Batch ${batch.name}: no Year level ${currentYear.level + 1} configured for promotion from ${currentYear.name}.`
      );
      continue;
    }

    const outcome = isFinalYear ? "PASSED_OUT" : "PROMOTED";
    const newStatus: StudentAcademicStatus = isFinalYear ? "PASSED_OUT" : "ACTIVE";
    const groupKey = `${batchId}:${currentYear.level}:${outcome}`;

    const snapshot: AcademicPromotionStudentSnapshot = {
      studentId: student._id.toString(),
      admissionNumber: student.admissionNumber,
      fullName: student.user?.fullName,
      previousYearId: yearId,
      previousYearName: currentYear.name,
      previousLevel: currentYear.level,
      newYearId: nextYear?._id.toString(),
      newYearName: isFinalYear ? "Passed Out" : nextYear!.name,
      newLevel: isFinalYear ? undefined : nextYear!.level,
      previousStatus: status,
      newStatus,
      batchId,
      batchName: batch.name,
      outcome
    };

    const existing = groupMap.get(groupKey);
    if (existing) {
      existing.studentCount += 1;
      existing.students.push(snapshot);
    } else {
      groupMap.set(groupKey, {
        batchId,
        batchName: batch.name,
        previousYearId: yearId,
        previousYearName: currentYear.name,
        previousLevel: currentYear.level,
        newYearId: nextYear?._id.toString(),
        newYearName: isFinalYear ? "Passed Out / Alumni" : nextYear!.name,
        newLevel: isFinalYear ? undefined : nextYear!.level,
        outcome,
        studentCount: 1,
        students: [snapshot]
      });
    }
  }

  if (skippedNoBatch > 0) {
    validationWarnings.push(`${skippedNoBatch} active student(s) skipped (no batch assigned).`);
  }
  if (skippedNoYear > 0) {
    validationWarnings.push(`${skippedNoYear} active student(s) skipped (no year assigned).`);
  }
  if (skippedInactiveBatch > 0) {
    validationWarnings.push(`${skippedInactiveBatch} student(s) skipped (inactive batch).`);
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => {
    if (a.batchName !== b.batchName) {
      return a.batchName.localeCompare(b.batchName);
    }
    return a.previousLevel - b.previousLevel;
  });

  return { groups, validationErrors, validationWarnings };
};

const countMissingFeeStructures = async (
  schoolId: ObjectIdLike,
  groups: AcademicPromotionGroupSummary[]
): Promise<number> => {
  const targetYearIds = [
    ...new Set(groups.filter((g) => g.outcome === "PROMOTED" && g.newYearId).map((g) => g.newYearId!))
  ];
  if (targetYearIds.length === 0) {
    return 0;
  }

  const existing = await FeeStructure.find({
    schoolId,
    status: "ACTIVE",
    yearIds: { $in: targetYearIds }
  })
    .select("yearIds")
    .lean();

  const covered = new Set<string>();
  for (const structure of existing) {
    for (const yearId of structure.yearIds ?? []) {
      covered.add(yearId.toString());
    }
  }

  return targetYearIds.filter((id) => !covered.has(id)).length;
};

/**
 * Clone active fee structures from previous year onto the promoted year when none exist.
 * Historical payment records are never modified.
 */
const ensureFeeStructuresForPromotion = async (
  schoolId: ObjectIdLike,
  groups: AcademicPromotionGroupSummary[],
  academicSessionBs: string,
  session: ClientSession | null
): Promise<number> => {
  let created = 0;

  for (const group of groups) {
    if (group.outcome !== "PROMOTED" || !group.newYearId || !group.previousYearId) {
      continue;
    }

    const existingForTarget = await FeeStructure.countDocuments(
      {
        schoolId,
        status: "ACTIVE",
        yearIds: group.newYearId
      },
      getSessionOption(session)
    );

    if (existingForTarget > 0) {
      continue;
    }

    const sourceQuery = FeeStructure.find({
      schoolId,
      status: "ACTIVE",
      yearIds: group.previousYearId
    });
    const sourceStructures = session ? await sourceQuery.session(session) : await sourceQuery;

    for (const source of sourceStructures) {
      const title = `${source.title} (${group.newYearName})`;
      const alreadyQuery = FeeStructure.findOne({
        schoolId,
        title,
        academicYearBs: academicSessionBs
      });
      const already = session ? await alreadyQuery.session(session) : await alreadyQuery;

      if (already) {
        if (!(already.yearIds ?? []).some((id) => id.toString() === group.newYearId)) {
          already.yearIds = [...(already.yearIds ?? []), group.newYearId as unknown as Types.ObjectId];
          await already.save(getSessionOption(session));
        }
        continue;
      }

      const createPayload = {
        schoolId,
        title,
        classIds: source.classIds ?? [],
        batchIds: source.batchIds?.length ? source.batchIds : [group.batchId],
        yearIds: [group.newYearId],
        faculty: source.faculty,
        program: source.program,
        feeType: source.feeType,
        frequency: source.frequency,
        academicYearBs: academicSessionBs,
        semesterBs: source.semesterBs,
        amountNpr: source.amountNpr,
        installmentCount: source.installmentCount,
        isOptional: source.isOptional,
        status: "ACTIVE" as const,
        version: 1,
        versionGroupId: source.versionGroupId,
        effectiveFromBs: source.effectiveFromBs
      };

      if (session) {
        await FeeStructure.create([createPayload], { session });
      } else {
        await FeeStructure.create(createPayload);
      }
      created += 1;
    }
  }

  return created;
};

export const buildPromotionPreview = async (
  options: BuildPreviewOptions
): Promise<AcademicPromotionPreview> => {
  const schoolId = options.schoolId;
  const academicSessionBs = options.academicSessionBs?.trim() || DEFAULT_ACADEMIC_YEAR_BS;

  const [batches, years, students, existingPromotion] = await Promise.all([
    Batch.find({ schoolId }).lean(),
    Year.find({ schoolId }).lean(),
    Student.find({
      schoolId,
      $or: [{ academicStatus: "ACTIVE" }, { academicStatus: { $exists: false } }, { academicStatus: null }]
    })
      .populate("user", "fullName")
      .lean(),
    AcademicPromotion.findOne({ schoolId, academicSessionBs, status: "COMPLETED" }).lean()
  ]);

  const batchesById = new Map(batches.map((batch) => [batch._id.toString(), batch]));
  const yearsById = new Map(
    years.map((year) => [
      year._id.toString(),
      {
        _id: year._id,
        name: year.name,
        level: year.level,
        batchId: year.batchId
      }
    ])
  );
  const yearsByBatchLevel = new Map<string, Map<number, { _id: { toString(): string }; name: string; level: number }>>();
  for (const year of years) {
    const batchKey = year.batchId.toString();
    if (!yearsByBatchLevel.has(batchKey)) {
      yearsByBatchLevel.set(batchKey, new Map());
    }
    yearsByBatchLevel.get(batchKey)!.set(year.level, {
      _id: year._id,
      name: year.name,
      level: year.level
    });
  }

  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];

  if (batches.filter((b) => b.isActive !== false).length === 0) {
    validationErrors.push("No active student batches found.");
  }

  if (years.length === 0) {
    validationErrors.push("Required academic year configuration is missing.");
  }

  if (existingPromotion) {
    validationErrors.push(
      `A completed promotion already exists for academic session ${academicSessionBs}. Rollback the latest promotion before promoting again for this session.`
    );
  }

  const { groups, validationErrors: groupErrors, validationWarnings: groupWarnings } = buildGroupsFromStudents({
    students: students as Array<{
      _id: { toString(): string };
      admissionNumber: string;
      academicStatus?: string | null;
      batchId?: ObjectIdLike | null;
      yearId?: ObjectIdLike | null;
      user?: { fullName?: string } | null;
    }>,
    yearsById,
    yearsByBatchLevel,
    batchesById
  });

  validationErrors.push(...groupErrors);
  validationWarnings.push(...groupWarnings);

  const totalStudents = groups.reduce((sum, group) => sum + group.studentCount, 0);
  if (totalStudents === 0 && !existingPromotion) {
    validationErrors.push("No eligible students found for promotion.");
  }

  const feeStructuresToEnsure = await countMissingFeeStructures(schoolId, groups);

  if (feeStructuresToEnsure > 0) {
    validationWarnings.push(
      `${feeStructuresToEnsure} promoted year(s) have no active fee structure; structures will be cloned from the previous year when available.`
    );
  }

  return {
    academicSessionBs,
    canPromote: validationErrors.length === 0 && totalStudents > 0,
    totalStudents,
    groups: groups.map((group) => ({
      ...group,
      // Keep payload lighter for preview UI; full snapshots still available on execute history
      students: group.students.slice(0, 5)
    })),
    validationErrors,
    validationWarnings,
    existingPromotionId: existingPromotion?._id.toString(),
    batchesDetected: new Set(groups.map((g) => g.batchId)).size,
    feeStructuresToEnsure
  };
};

export const executePromotion = async (
  options: ExecutePromotionOptions
): Promise<{ promotion: AcademicPromotionRecord; feeStructuresCreated: number }> => {
  const preview = await buildPromotionPreview({
    schoolId: options.schoolId,
    academicSessionBs: options.academicSessionBs
  });

  if (!preview.canPromote) {
    throw new ApiError(400, preview.validationErrors.join(" ") || "Promotion validation failed");
  }

  // Rebuild full groups with complete student snapshots for persistence
  const fullPreviewSource = await rebuildFullGroups(options.schoolId);
  if (fullPreviewSource.groups.length === 0) {
    throw new ApiError(400, "No eligible students found for promotion.");
  }

  return withTransaction(async (session) => {
    const feeStructuresCreated = await ensureFeeStructuresForPromotion(
      options.schoolId,
      fullPreviewSource.groups,
      options.academicSessionBs,
      session
    );

    const bulkOps = fullPreviewSource.groups.flatMap((group) =>
      group.students.map((student) => {
        if (student.outcome === "PASSED_OUT") {
          return {
            updateOne: {
              filter: { _id: student.studentId, schoolId: options.schoolId },
              update: {
                $set: {
                  academicStatus: "PASSED_OUT" as StudentAcademicStatus
                }
              }
            }
          };
        }
        return {
          updateOne: {
            filter: { _id: student.studentId, schoolId: options.schoolId },
            update: {
              $set: {
                yearId: student.newYearId
                  ? (student.newYearId as unknown as Types.ObjectId)
                  : undefined,
                academicStatus: "ACTIVE" as StudentAcademicStatus
              }
            }
          }
        };
      })
    );

    if (bulkOps.length > 0) {
      await Student.bulkWrite(bulkOps as Parameters<typeof Student.bulkWrite>[0], getSessionOption(session));
    }

    // Mark batches fully graduated when every remaining student is non-active
    const batchIds = [...new Set(fullPreviewSource.groups.map((g) => g.batchId))];
    for (const batchId of batchIds) {
      const stillActive = await Student.countDocuments(
        {
          schoolId: options.schoolId,
          batchId,
          $or: [{ academicStatus: "ACTIVE" }, { academicStatus: { $exists: false } }, { academicStatus: null }]
        },
        getSessionOption(session)
      );
      if (stillActive === 0) {
        await Batch.updateOne(
          { _id: batchId, schoolId: options.schoolId },
          { $set: { isActive: false } },
          getSessionOption(session)
        );
      }
    }

    const promotionPayload = {
      schoolId: options.schoolId,
      academicSessionBs: options.academicSessionBs,
      promotionDate: new Date(),
      promotedBy: options.promotedBy,
      promotedByName: options.promotedByName,
      remarks: options.remarks?.trim() || undefined,
      status: "COMPLETED" as const,
      totalStudents: fullPreviewSource.totalStudents,
      groups: fullPreviewSource.groups
    };

    const promotionDoc = session
      ? (await AcademicPromotion.create([promotionPayload], { session }))[0]!
      : await AcademicPromotion.create(promotionPayload);

    return {
      promotion: serializePromotion(promotionDoc as never),
      feeStructuresCreated
    };
  });
};

const rebuildFullGroups = async (
  schoolId: ObjectIdLike
): Promise<{ groups: AcademicPromotionGroupSummary[]; totalStudents: number }> => {
  const [batches, years, students] = await Promise.all([
    Batch.find({ schoolId }).lean(),
    Year.find({ schoolId }).lean(),
    Student.find({
      schoolId,
      $or: [{ academicStatus: "ACTIVE" }, { academicStatus: { $exists: false } }, { academicStatus: null }]
    })
      .populate("user", "fullName")
      .lean()
  ]);

  const batchesById = new Map(batches.map((batch) => [batch._id.toString(), batch]));
  const yearsById = new Map(
    years.map((year) => [
      year._id.toString(),
      {
        _id: year._id,
        name: year.name,
        level: year.level,
        batchId: year.batchId
      }
    ])
  );
  const yearsByBatchLevel = new Map<string, Map<number, { _id: { toString(): string }; name: string; level: number }>>();
  for (const year of years) {
    const batchKey = year.batchId.toString();
    if (!yearsByBatchLevel.has(batchKey)) {
      yearsByBatchLevel.set(batchKey, new Map());
    }
    yearsByBatchLevel.get(batchKey)!.set(year.level, {
      _id: year._id,
      name: year.name,
      level: year.level
    });
  }

  const { groups, validationErrors } = buildGroupsFromStudents({
    students: students as Array<{
      _id: { toString(): string };
      admissionNumber: string;
      academicStatus?: string | null;
      batchId?: ObjectIdLike | null;
      yearId?: ObjectIdLike | null;
      user?: { fullName?: string } | null;
    }>,
    yearsById,
    yearsByBatchLevel,
    batchesById
  });

  if (validationErrors.length > 0) {
    throw new ApiError(400, validationErrors.join(" "));
  }

  return {
    groups,
    totalStudents: groups.reduce((sum, g) => sum + g.studentCount, 0)
  };
};

export const rollbackLatestPromotion = async (
  options: RollbackPromotionOptions
): Promise<{ promotion: AcademicPromotionRecord; restoredStudents: number }> => {
  const latest = await AcademicPromotion.findOne({
    schoolId: options.schoolId,
    status: "COMPLETED"
  }).sort({ createdAt: -1 });

  if (!latest) {
    throw new ApiError(404, "No completed promotion found to roll back.");
  }

  // Ensure this is still the most recent completed promotion
  const newer = await AcademicPromotion.findOne({
    schoolId: options.schoolId,
    status: "COMPLETED",
    createdAt: { $gt: latest.createdAt }
  }).lean();

  if (newer) {
    throw new ApiError(400, "Only the most recent completed promotion can be rolled back.");
  }

  return withTransaction(async (session) => {
    const groups = (latest.toObject().groups ?? []) as unknown as AcademicPromotionGroupSummary[];
    const bulkOps = groups.flatMap((group) =>
      (group.students ?? []).map((student) => ({
        updateOne: {
          filter: { _id: student.studentId, schoolId: options.schoolId },
          update: {
            $set: {
              yearId: student.previousYearId
                ? (student.previousYearId as unknown as Types.ObjectId)
                : undefined,
              academicStatus: (student.previousStatus || "ACTIVE") as StudentAcademicStatus
            }
          }
        }
      }))
    );

    if (bulkOps.length > 0) {
      await Student.bulkWrite(bulkOps as Parameters<typeof Student.bulkWrite>[0], getSessionOption(session));
    }

    const batchIds = [...new Set(groups.map((g) => asString(g.batchId as unknown as ObjectIdLike)))];
    if (batchIds.length > 0) {
      await Batch.updateMany(
        { _id: { $in: batchIds }, schoolId: options.schoolId },
        { $set: { isActive: true } },
        getSessionOption(session)
      );
    }

    latest.status = "ROLLED_BACK";
    latest.rolledBackAt = new Date();
    latest.rolledBackBy = options.rolledBackBy as Types.ObjectId;
    latest.rolledBackByName = options.rolledBackByName;
    latest.rollbackRemarks = options.remarks?.trim() || undefined;
    await latest.save(getSessionOption(session));

    return {
      promotion: serializePromotion(latest as never),
      restoredStudents: bulkOps.length
    };
  });
};

export const listPromotionHistory = async (schoolId: ObjectIdLike): Promise<AcademicPromotionRecord[]> => {
  const promotions = await AcademicPromotion.find({ schoolId }).sort({ createdAt: -1 }).lean();
  return promotions.map((item) =>
    serializePromotion({
      ...item,
      promotionDate: item.promotionDate,
      rolledBackAt: item.rolledBackAt ?? undefined,
      rolledBackBy: item.rolledBackBy ?? undefined,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    } as never)
  );
};

export const getPromotionById = async (
  schoolId: ObjectIdLike,
  promotionId: string
): Promise<AcademicPromotionRecord | null> => {
  const promotion = await AcademicPromotion.findOne({ _id: promotionId, schoolId }).lean();
  if (!promotion) {
    return null;
  }
  return serializePromotion(promotion as never);
};
