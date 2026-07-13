import type mongoose from "mongoose";
import { Batch } from "../models/Batch.js";
import { Assignment } from "../models/Assignment.js";
import { Attendance } from "../models/Attendance.js";
import { ExamRoutine } from "../models/ExamRoutine.js";
import { MasterSubject } from "../models/MasterSubject.js";
import { Notice } from "../models/Notice.js";
import { Result } from "../models/Result.js";
import { ResultSubmission } from "../models/ResultSubmission.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { Year } from "../models/Year.js";

type SchoolId = mongoose.Types.ObjectId;

type MasterSubjectSnapshot = {
  _id: SchoolId;
  name: string;
  code: string;
  yearLevel: number;
  creditHours?: number | null;
  theoryMarks: number;
  practicalMarks?: number | null;
  internalMarks?: number | null;
  fullMarks: number;
  passMarks: number;
  isActive: boolean;
};

const buildSubjectFromMaster = (master: MasterSubjectSnapshot, yearId: SchoolId, schoolId: SchoolId) => ({
  schoolId,
  masterSubjectId: master._id,
  name: master.name,
  code: master.code,
  classIds: [] as SchoolId[],
  yearIds: [yearId],
  teacherIds: [] as SchoolId[],
  creditHours: master.creditHours ?? undefined,
  theoryMarks: master.theoryMarks,
  practicalMarks: master.practicalMarks ?? undefined,
  internalMarks: master.internalMarks ?? undefined,
  fullMarks: master.fullMarks,
  passMarks: master.passMarks,
  isActive: master.isActive
});

export const syncMasterSubjectToInstances = async (
  schoolId: SchoolId,
  master: MasterSubjectSnapshot
): Promise<void> => {
  await Subject.updateMany(
    { schoolId, masterSubjectId: master._id },
    {
      $set: {
        name: master.name,
        code: master.code,
        creditHours: master.creditHours ?? undefined,
        theoryMarks: master.theoryMarks,
        practicalMarks: master.practicalMarks ?? undefined,
        internalMarks: master.internalMarks ?? undefined,
        fullMarks: master.fullMarks,
        passMarks: master.passMarks,
        isActive: master.isActive
      }
    }
  );
};

export const provisionMasterSubjectToAllBatches = async (
  schoolId: SchoolId,
  master: MasterSubjectSnapshot
): Promise<void> => {
  if (!master.isActive) {
    return;
  }

  const years = await Year.find({ schoolId, level: master.yearLevel }).lean();
  if (!years.length) {
    return;
  }

  const existing = await Subject.find({
    schoolId,
    masterSubjectId: master._id,
    yearIds: { $in: years.map((year) => year._id) }
  })
    .select("yearIds")
    .lean();

  const existingYearIds = new Set(existing.flatMap((subject) => subject.yearIds.map((id) => id.toString())));
  const toCreate = years
    .filter((year) => !existingYearIds.has(year._id.toString()))
    .map((year) => buildSubjectFromMaster(master, year._id, schoolId));

  if (toCreate.length) {
    await Subject.insertMany(toCreate);
  }
};

export const provisionSubjectsForBatch = async (
  schoolId: SchoolId,
  batchId: SchoolId,
  session?: mongoose.ClientSession | null
): Promise<void> => {
  const sessionOpt = session ? { session } : {};

  const yearQuery = Year.find({ schoolId, batchId }).lean();
  const masterQuery = MasterSubject.find({ schoolId, isActive: true }).lean();
  if (session) {
    yearQuery.session(session);
    masterQuery.session(session);
  }

  const [years, masterSubjects] = await Promise.all([yearQuery, masterQuery]);

  if (!years.length || !masterSubjects.length) {
    return;
  }

  const yearIds = years.map((year) => year._id);
  const existingQuery = Subject.find({
    schoolId,
    masterSubjectId: { $in: masterSubjects.map((master) => master._id) },
    yearIds: { $in: yearIds }
  })
    .select("masterSubjectId yearIds")
    .lean();
  if (session) {
    existingQuery.session(session);
  }
  const existing = await existingQuery;

  const existingKeys = new Set(
    existing.flatMap((subject) =>
      (subject.yearIds ?? []).map((yearId) => `${subject.masterSubjectId?.toString()}:${yearId.toString()}`)
    )
  );

  const toCreate = years.flatMap((year) =>
    masterSubjects
      .filter((master) => master.yearLevel === year.level)
      .filter((master) => !existingKeys.has(`${master._id.toString()}:${year._id.toString()}`))
      .map((master) => buildSubjectFromMaster(master, year._id, schoolId))
  );

  if (toCreate.length) {
    await Subject.insertMany(toCreate, sessionOpt);
  }
};

export const deleteSubjectsForBatchYears = async (schoolId: SchoolId, batchId: SchoolId): Promise<void> => {
  const yearIds = await Year.find({ schoolId, batchId }).distinct("_id");
  if (!yearIds.length) {
    return;
  }

  const subjects = await Subject.find({
    schoolId,
    masterSubjectId: { $exists: true },
    yearIds: { $in: yearIds }
  }).lean();

  if (!subjects.length) {
    return;
  }

  const subjectIds = subjects.map((subject) => subject._id);
  await Promise.all([
    Teacher.updateMany({ schoolId, subjects: { $in: subjectIds } }, { $pull: { subjects: { $in: subjectIds } } }),
    Subject.deleteMany({ _id: { $in: subjectIds }, schoolId })
  ]);
};

export const deleteProvisionedSubjectsForMaster = async (
  schoolId: SchoolId,
  masterSubjectId: SchoolId
): Promise<void> => {
  const subjectIds = await Subject.find({ schoolId, masterSubjectId }).distinct("_id");
  if (!subjectIds.length) {
    return;
  }

  await Promise.all([
    Teacher.updateMany({ schoolId, subjects: { $in: subjectIds } }, { $pull: { subjects: { $in: subjectIds } } }),
    Subject.deleteMany({ _id: { $in: subjectIds }, schoolId })
  ]);
};

export const isMasterSubjectInUse = async (schoolId: SchoolId, masterSubjectId: SchoolId): Promise<boolean> => {
  const subjectIds = await Subject.find({ schoolId, masterSubjectId }).distinct("_id");
  if (!subjectIds.length) {
    return false;
  }

  const filter = { schoolId, subjectId: { $in: subjectIds } };
  const checks = await Promise.all([
    Attendance.exists(filter),
    Assignment.exists(filter),
    ExamRoutine.exists(filter),
    ResultSubmission.exists(filter),
    TimetableSlot.exists(filter),
    Notice.exists(filter),
    Result.exists({ schoolId, "marks.subjectId": { $in: subjectIds } })
  ]);

  return checks.some(Boolean);
};

export const reconcileCurriculumForSchool = async (
  schoolId: SchoolId
): Promise<{ batchesProcessed: number; subjectsCreated: number }> => {
  const batches = await Batch.find({ schoolId }).distinct("_id");
  let subjectsCreated = 0;

  for (const batchId of batches) {
    const beforeCount = await Subject.countDocuments({ schoolId, masterSubjectId: { $exists: true } });
    await provisionSubjectsForBatch(schoolId, batchId);
    const afterCount = await Subject.countDocuments({ schoolId, masterSubjectId: { $exists: true } });
    subjectsCreated += Math.max(0, afterCount - beforeCount);
  }

  return { batchesProcessed: batches.length, subjectsCreated };
};

export const migrateLegacyCollegeSubjects = async (
  schoolId: SchoolId
): Promise<{ masterSubjectsCreated: number; subjectsLinked: number; batchesProcessed: number }> => {
  const existingMasterCount = await MasterSubject.countDocuments({ schoolId });
  if (existingMasterCount > 0) {
    const reconciled = await reconcileCurriculumForSchool(schoolId);
    return {
      masterSubjectsCreated: 0,
      subjectsLinked: 0,
      batchesProcessed: reconciled.batchesProcessed
    };
  }

  const legacySubjects = await Subject.find({
    schoolId,
    masterSubjectId: { $exists: false },
    yearIds: { $exists: true, $not: { $size: 0 } }
  }).lean();

  if (!legacySubjects.length) {
    const reconciled = await reconcileCurriculumForSchool(schoolId);
    return {
      masterSubjectsCreated: 0,
      subjectsLinked: 0,
      batchesProcessed: reconciled.batchesProcessed
    };
  }

  const years = await Year.find({ schoolId }).lean();
  const yearById = new Map(years.map((year) => [year._id.toString(), year]));
  const groups = new Map<string, (typeof legacySubjects)[number][]>();

  for (const subject of legacySubjects) {
    const yearId = subject.yearIds[0]?.toString();
    const year = yearId ? yearById.get(yearId) : undefined;
    if (!year) {
      continue;
    }

    const key = `${subject.code.trim().toLowerCase()}::${year.level}`;
    const group = groups.get(key) ?? [];
    group.push(subject);
    groups.set(key, group);
  }

  let masterSubjectsCreated = 0;
  let subjectsLinked = 0;

  for (const group of groups.values()) {
    const representative = group[0]!;
    const year = yearById.get(representative.yearIds[0]!.toString());
    if (!year) {
      continue;
    }

    let code = representative.code.trim();
    let suffix = 1;
    while (await MasterSubject.exists({ schoolId, code })) {
      code = `${representative.code.trim()}${suffix}`;
      suffix += 1;
    }

    const master = await MasterSubject.create({
      schoolId,
      name: representative.name,
      code,
      yearLevel: year.level,
      theoryMarks: representative.theoryMarks ?? representative.fullMarks,
      practicalMarks: representative.practicalMarks,
      internalMarks: representative.internalMarks,
      creditHours: representative.creditHours,
      fullMarks: representative.fullMarks,
      passMarks: representative.passMarks,
      isActive: representative.isActive !== false
    });
    masterSubjectsCreated += 1;

    await Subject.updateMany(
      { _id: { $in: group.map((subject) => subject._id) }, schoolId },
      {
        $set: {
          masterSubjectId: master._id,
          code: master.code,
          name: master.name,
          theoryMarks: master.theoryMarks,
          practicalMarks: master.practicalMarks,
          internalMarks: master.internalMarks,
          creditHours: master.creditHours,
          fullMarks: master.fullMarks,
          passMarks: master.passMarks,
          isActive: master.isActive
        }
      }
    );
    subjectsLinked += group.length;
  }

  const reconciled = await reconcileCurriculumForSchool(schoolId);

  return {
    masterSubjectsCreated,
    subjectsLinked,
    batchesProcessed: reconciled.batchesProcessed
  };
};