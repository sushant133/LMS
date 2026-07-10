/**
 * Hybrid migration: Teacher legacy arrays → SubjectAssignment rows.
 *
 * Formal complexity predicate:
 *   isComplex = distinctSubjects >= 2 AND distinctGroups >= 2
 *
 * - Simple (!isComplex): create membership-filtered FULL ACTIVE rows + ACCEPTED
 * - Complex: zero ACTIVE rows + NEEDS_REVIEW (+ CSV line)
 * - Empty (no subjects/groups): ACCEPTED (non-teaching staff)
 *
 * Runbook:
 *   1. Deploy PR1–2 with SUBJECT_ASSIGNMENT_SCOPE_DEFAULT=legacy
 *   2. npx tsx src/scripts/migrateTeacherAssignmentsToSubjectAssignments.ts [schoolId]
 *   3. Review NEEDS_REVIEW queue in admin UI
 *   4. Set Setting.subjectAssignmentScopeMode=dual per school after parity OK
 *
 * Usage:
 *   npx tsx src/scripts/migrateTeacherAssignmentsToSubjectAssignments.ts
 *   npx tsx src/scripts/migrateTeacherAssignmentsToSubjectAssignments.ts <schoolId>
 */
import { connectDatabase } from "../config/db.js";
import { School } from "../models/School.js";
import { Section } from "../models/Section.js";
import { Setting } from "../models/Setting.js";
import { Subject } from "../models/Subject.js";
import { SubjectAssignment } from "../models/SubjectAssignment.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";
import { recomputeSubjectTeacherIds } from "../utils/subjectAssignmentService.js";
import mongoose from "mongoose";

const schoolIdArg = process.argv[2];

const toIds = (values: unknown[] | undefined): string[] =>
  (values ?? []).map((v) => String(v));

const run = async (): Promise<void> => {
  await connectDatabase();

  const schools = schoolIdArg
    ? await School.find({ _id: schoolIdArg })
    : await School.find({});

  if (!schools.length) {
    console.log("No schools found.");
    process.exit(0);
  }

  // System user for createdBy — prefer first super admin-like user or placeholder
  const { User } = await import("../models/User.js");

  for (const school of schools) {
    const schoolId = school._id;
    const college = school.institutionType === "COLLEGE";
    const setting = await Setting.findOne({ schoolId }).lean();
    const academicYearBs = setting?.academicYearBs ?? "2083/2084";
    const [startYear] = academicYearBs.split("/");
    const effectiveFromBs = `${startYear}-04-01`;

    const admin =
      (await User.findOne({ schoolId, role: { $in: ["SUPER_ADMIN", "COLLEGE_ADMIN"] } }).lean()) ??
      (await User.findOne({ role: "SUPER_ADMIN" }).lean());
    const createdBy = admin?._id ?? new mongoose.Types.ObjectId();

    const teachers = await Teacher.find({ schoolId }).lean();
    console.log(`\n[${school.name}] ${teachers.length} teachers, AY=${academicYearBs}, mode=${college ? "COLLEGE" : "SCHOOL"}`);

    const csvLines: string[] = [
      "teacherId,teacherCode,status,reason,subjects,groups"
    ];

    let accepted = 0;
    let needsReview = 0;
    let rowsCreated = 0;

    const allSections = college
      ? []
      : await Section.find({ schoolId }).lean();
    const sectionById = new Map(allSections.map((s) => [s._id.toString(), s]));

    const allYears = college ? await Year.find({ schoolId }).lean() : [];
    const yearById = new Map(allYears.map((y) => [y._id.toString(), y]));

    const allSubjects = await Subject.find({ schoolId }).lean();
    const subjectById = new Map(allSubjects.map((s) => [s._id.toString(), s]));

    for (const teacher of teachers) {
      const subjectIds = toIds(teacher.subjects as unknown[]);
      const classIds = toIds(teacher.assignedClassIds as unknown[]);
      const sectionIds = toIds(teacher.assignedSectionIds as unknown[]);
      const batchIds = toIds(teacher.assignedBatchIds as unknown[]);
      const yearIds = toIds(teacher.assignedYearIds as unknown[]);

      // Build membership-filtered candidate pairs
      type Pair = {
        subjectId: string;
        classId?: string;
        sectionId?: string;
        batchId?: string;
        yearId?: string;
      };
      const pairs: Pair[] = [];

      if (college) {
        for (const subjectId of subjectIds) {
          const subject = subjectById.get(subjectId);
          if (!subject) continue;
          const subjectYearIds = new Set(toIds(subject.yearIds as unknown[]));
          for (const yearId of yearIds) {
            if (!subjectYearIds.has(yearId)) continue;
            const year = yearById.get(yearId);
            if (!year) continue;
            const batchId = year.batchId.toString();
            if (!batchIds.includes(batchId)) continue;
            pairs.push({ subjectId, batchId, yearId });
          }
        }
      } else {
        for (const subjectId of subjectIds) {
          const subject = subjectById.get(subjectId);
          if (!subject) continue;
          const subjectClassIds = new Set(toIds(subject.classIds as unknown[]));
          for (const sectionId of sectionIds) {
            const section = sectionById.get(sectionId);
            if (!section) continue;
            const classId = section.classId.toString();
            if (!classIds.includes(classId)) continue;
            if (!subjectClassIds.has(classId)) continue;
            pairs.push({ subjectId, classId, sectionId });
          }
        }
      }

      const distinctSubjects = new Set(pairs.map((p) => p.subjectId)).size;
      const distinctGroups = new Set(
        pairs.map((p) =>
          college ? `${p.batchId}:${p.yearId}` : `${p.classId}:${p.sectionId}`
        )
      ).size;

      const isComplex = distinctSubjects >= 2 && distinctGroups >= 2;
      const hadLegacy =
        subjectIds.length > 0 ||
        classIds.length > 0 ||
        sectionIds.length > 0 ||
        batchIds.length > 0 ||
        yearIds.length > 0;

      // Empty / non-teaching
      if (!hadLegacy || pairs.length === 0) {
        if (hadLegacy && pairs.length === 0) {
          // Had subjects/groups but no valid membership pair
          await Teacher.updateOne(
            { _id: teacher._id },
            { $set: { assignmentMigrationStatus: "NEEDS_REVIEW" } }
          );
          needsReview += 1;
          csvLines.push(
            [
              teacher._id.toString(),
              teacher.teacherCode,
              "NEEDS_REVIEW",
              "no_valid_membership_pairs",
              subjectIds.join("|"),
              college ? `${batchIds.join("|")}x${yearIds.join("|")}` : `${classIds.join("|")}x${sectionIds.join("|")}`
            ].join(",")
          );
          continue;
        }

        await Teacher.updateOne(
          { _id: teacher._id },
          { $set: { assignmentMigrationStatus: "ACCEPTED" } }
        );
        accepted += 1;
        continue;
      }

      if (isComplex) {
        // Zero ACTIVE rows — dual stays on full legacy
        await Teacher.updateOne(
          { _id: teacher._id },
          { $set: { assignmentMigrationStatus: "NEEDS_REVIEW" } }
        );
        needsReview += 1;
        csvLines.push(
          [
            teacher._id.toString(),
            teacher.teacherCode,
            "NEEDS_REVIEW",
            `complex_s${distinctSubjects}_g${distinctGroups}`,
            subjectIds.join("|"),
            String(distinctGroups)
          ].join(",")
        );
        continue;
      }

      // Simple: create FULL rows (idempotent by natural key)
      for (const pair of pairs) {
        const filter = {
          schoolId,
          academicYearBs,
          subjectId: pair.subjectId,
          teacherId: teacher._id,
          classId: pair.classId ?? null,
          sectionId: pair.sectionId ?? null,
          batchId: pair.batchId ?? null,
          yearId: pair.yearId ?? null,
          status: "ACTIVE" as const
        };

        const existing = await SubjectAssignment.findOne(filter).lean();
        if (existing) continue;

        await SubjectAssignment.create({
          ...filter,
          assignmentType: "FULL",
          unitFrom: null,
          unitTo: null,
          assignedPercentage: null,
          effectiveFromBs,
          remarks: "Migrated from Teacher assignment arrays",
          createdBy
        });
        rowsCreated += 1;
      }

      await Teacher.updateOne(
        { _id: teacher._id },
        { $set: { assignmentMigrationStatus: "ACCEPTED" } }
      );
      accepted += 1;
    }

    const recompute = await recomputeSubjectTeacherIds(schoolId);
    console.log(
      `  accepted=${accepted} needsReview=${needsReview} rowsCreated=${rowsCreated} subjectsRecomputed=${recompute.subjectsUpdated}`
    );
    if (csvLines.length > 1) {
      console.log("  --- NEEDS_REVIEW CSV ---");
      for (const line of csvLines) console.log(line);
      console.log("  --- end CSV ---");
    }
  }

  process.exit(0);
};

run().catch((error) => {
  console.error("Migration failed", error);
  process.exit(1);
});
