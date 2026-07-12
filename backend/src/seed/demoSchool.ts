import {
  COLLEGE_YEAR_NAMES,
  DEFAULT_ACADEMIC_YEAR_BS,
  DEFAULT_LAB_CATEGORIES,
  DEMO_PASSWORD,
  DEMO_SCHOOL_CODE,
  computeSubjectMark,
  demoCredentials
} from "@phit-erp/shared";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Assignment, AssignmentSubmission } from "../models/Assignment.js";
import { Attendance } from "../models/Attendance.js";
import { Exam } from "../models/Exam.js";
import { Accountant } from "../models/Accountant.js";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { AccountingExpense } from "../models/AccountingExpense.js";
import { AccountingIncome } from "../models/AccountingIncome.js";
import { AccountingPurchase } from "../models/AccountingPurchase.js";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { BankAccount } from "../models/BankAccount.js";
import { CashBookEntry } from "../models/CashBookEntry.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { FeeStructure } from "../models/FeeStructure.js";
import { SalaryPayment } from "../models/SalaryPayment.js";
import { LibraryBook, LibraryIssue } from "../models/LibraryBook.js";
import {
  Laboratory,
  LaboratoryCategory,
  LaboratoryEquipment,
  LaboratoryIssue,
  LaboratoryStockMovement,
  LaboratoryStockRequest
} from "../models/Laboratory.js";
import { LeaveRequest, Payroll } from "../models/LeaveRequest.js";
import { AcademicCalendarEvent } from "../models/AcademicCalendarEvent.js";
import { Notice } from "../models/Notice.js";
import { Notification } from "../models/Notification.js";
import { ParentChildLink } from "../models/ParentChildLink.js";
import { Result } from "../models/Result.js";
import { Batch } from "../models/Batch.js";
import { School } from "../models/School.js";
import { Year } from "../models/Year.js";
import { Setting } from "../models/Setting.js";
import { Student } from "../models/Student.js";
import { MasterSubject } from "../models/MasterSubject.js";
import { Subject } from "../models/Subject.js";
import { provisionSubjectsForBatch } from "../utils/masterSubjectProvisioning.js";
import { Teacher } from "../models/Teacher.js";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { TransportAssignment, TransportRoute } from "../models/TransportRoute.js";
import { User } from "../models/User.js";
import { deleteSchoolCascade } from "../utils/deleteSchoolCascade.js";
import { buildResultTotals } from "../utils/examResults.js";
import { bsToAdDate, getOffsetBsDate, getTodayBs } from "../utils/nepaliDate.js";
import { defaultSchoolAddress, buildSchoolSettingsPayload } from "../utils/schoolDefaults.js";
import { withTransaction } from "../utils/transaction.js";


const address = defaultSchoolAddress;
const attendanceDates = ["2081-09-15", "2081-09-16", "2081-09-17", "2081-09-18", "2081-09-19"];
const statuses = ["PRESENT", "PRESENT", "ABSENT", "LATE", "PRESENT"] as const;

export const ensureSuperAdmin = async (): Promise<void> => {
  const existing = await User.findOne({ role: "SUPER_ADMIN" });
  if (existing) {
    return;
  }

  await User.create({
    fullName: env.SUPER_ADMIN_NAME,
    email: env.SUPER_ADMIN_EMAIL,
    password: env.SUPER_ADMIN_PASSWORD,
    role: "SUPER_ADMIN",
    isActive: true,
    mustChangePassword: false
  });
  console.log(`Super admin created: ${env.SUPER_ADMIN_EMAIL}`);
};

const syncSeedIndexes = async (): Promise<void> => {
  await Promise.all([
    Assignment.syncIndexes(),
    AssignmentSubmission.syncIndexes(),
    Attendance.syncIndexes(),
    Exam.syncIndexes(),
    FeeCollection.syncIndexes(),
    FeeStructure.syncIndexes(),
    Accountant.syncIndexes(),
    CollegeStaff.syncIndexes(),
    AccountingExpense.syncIndexes(),
    AccountingPurchase.syncIndexes(),
    AccountingIncome.syncIndexes(),
    SalaryPayment.syncIndexes(),
    BankAccount.syncIndexes(),
    CashBookEntry.syncIndexes(),
    AccountingSettings.syncIndexes(),
    LibraryBook.syncIndexes(),
    LibraryIssue.syncIndexes(),
    Laboratory.syncIndexes(),
    LaboratoryCategory.syncIndexes(),
    LaboratoryEquipment.syncIndexes(),
    LaboratoryIssue.syncIndexes(),
    LaboratoryStockMovement.syncIndexes(),
    LaboratoryStockRequest.syncIndexes(),
    LeaveRequest.syncIndexes(),
    Payroll.syncIndexes(),
    Notice.syncIndexes(),
    Notification.syncIndexes(),
    ParentChildLink.syncIndexes(),
    Result.syncIndexes(),
    School.syncIndexes(),
    Batch.syncIndexes(),
    Year.syncIndexes(),
    Setting.syncIndexes(),
    Student.syncIndexes(),
    MasterSubject.syncIndexes(),
    Subject.syncIndexes(),
    Teacher.syncIndexes(),
    TimetableSlot.syncIndexes(),
    TransportAssignment.syncIndexes(),
    TransportRoute.syncIndexes(),
    User.syncIndexes()
  ]);
};

export type SeedDemoSchoolOptions = {
  force?: boolean;
};

export const seedDemoSchool = async ({ force = false }: SeedDemoSchoolOptions = {}): Promise<void> => {
  await syncSeedIndexes();

  await withTransaction(async (session) => {
    const options = session ? { session, ordered: true } : { ordered: true };

    const existingSchool = await School.findOne({ code: DEMO_SCHOOL_CODE }).session(session);
    if (existingSchool) {
      if (!force) {
        console.log(`Demo college (${DEMO_SCHOOL_CODE}) already exists — skipping seed.`);
        return;
      }

      console.log(`Removing existing demo college (${DEMO_SCHOOL_CODE})...`);
      await deleteSchoolCascade(existingSchool._id, session);
    }

    const [school] = await School.create(
      [
        {
          name: "Public Himal Institute of Technology",
          nameNp: "पब्लिक हिमाल इन्स्टिच्युट अफ टेक्नोलोजी",
          code: DEMO_SCHOOL_CODE,
          email: "info@demoerp.nepal-school.com",
          phone: "0144123456",
          principalName: "Dr. Kamal Prasad Bhatta",
          academicYearBs: DEFAULT_ACADEMIC_YEAR_BS,
          institutionType: "COLLEGE",
          address,
          isActive: true
        }
      ],
      options
    );

    const schoolId = school!._id;

    const [adminUser] = await User.create(
      [
        {
          schoolId,
          fullName: "College Administrator",
          email: demoCredentials.schoolAdmin.email,
          phone: "9801111000",
          password: DEMO_PASSWORD,
          role: "COLLEGE_ADMIN",
          mustChangePassword: false
        }
      ],
      options
    );

    await Setting.create(
      [
        {
          schoolId,
          ...buildSchoolSettingsPayload({
            name: school!.name,
            nameNp: school!.nameNp,
            principalName: school!.principalName,
            academicYearBs: school!.academicYearBs,
            email: school!.email,
            phone: school!.phone,
            address: school!.address
          })
        }
      ],
      options
    );

    const [batch2082, batch2083] = await Batch.create(
      [
        { schoolId, name: "Batch 2082", academicYearBs: "2082/2083", isActive: true },
        { schoolId, name: "Batch 2083", academicYearBs: "2083/2084", isActive: true }
      ],
      options
    );

    const years = await Year.insertMany(
      [batch2082!, batch2083!].flatMap((batch) =>
        COLLEGE_YEAR_NAMES.map((name, index) => ({
          schoolId,
          batchId: batch._id,
          name,
          level: index + 1,
          isActive: true
        }))
      ),
      options
    );

    const yearByBatchAndName = new Map<string, (typeof years)[number]>();
    for (const year of years) {
      const batch = [batch2082!, batch2083!].find((item) => item._id.equals(year.batchId));
      if (batch) {
        yearByBatchAndName.set(`${batch.name}::${year.name}`, year);
      }
    }

    const year1 = yearByBatchAndName.get("Batch 2082::1st Year")!;
    const year2 = yearByBatchAndName.get("Batch 2082::2nd Year")!;

    const masterSubjectDefs = [
      { name: "Anatomy", code: "ANAT", yearLevel: 1, theoryMarks: 70, practicalMarks: 30, fullMarks: 100, passMarks: 35 },
      { name: "Physiology", code: "PHYS", yearLevel: 1, theoryMarks: 70, practicalMarks: 30, fullMarks: 100, passMarks: 35 },
      { name: "Community Health", code: "CH", yearLevel: 1, theoryMarks: 60, practicalMarks: 40, fullMarks: 100, passMarks: 35 },
      { name: "English", code: "ENG", yearLevel: 1, theoryMarks: 100, fullMarks: 100, passMarks: 35 },
      { name: "Pharmacology", code: "PHAR", yearLevel: 2, theoryMarks: 70, practicalMarks: 30, fullMarks: 100, passMarks: 35 },
      { name: "Medical Surgery", code: "MS", yearLevel: 2, theoryMarks: 70, practicalMarks: 30, fullMarks: 100, passMarks: 35 },
      { name: "Microbiology", code: "MIC", yearLevel: 2, theoryMarks: 60, practicalMarks: 40, fullMarks: 100, passMarks: 35 },
      { name: "Nutrition", code: "NUT", yearLevel: 2, theoryMarks: 60, practicalMarks: 40, fullMarks: 100, passMarks: 35 },
      { name: "Midwifery", code: "MID", yearLevel: 3, theoryMarks: 50, practicalMarks: 50, fullMarks: 100, passMarks: 35 },
      { name: "Pediatrics", code: "PED", yearLevel: 3, theoryMarks: 50, practicalMarks: 50, fullMarks: 100, passMarks: 35 },
      { name: "Psychiatry", code: "PSY", yearLevel: 3, theoryMarks: 60, practicalMarks: 40, fullMarks: 100, passMarks: 35 },
      { name: "Internship", code: "INT", yearLevel: 3, theoryMarks: 0, practicalMarks: 100, fullMarks: 100, passMarks: 35 }
    ];

    await MasterSubject.create(
      masterSubjectDefs.map((item) => ({
        schoolId,
        name: item.name,
        code: item.code,
        yearLevel: item.yearLevel,
        theoryMarks: item.theoryMarks,
        practicalMarks: item.practicalMarks,
        fullMarks: item.fullMarks,
        passMarks: item.passMarks,
        isActive: true
      })),
      options
    );

    await provisionSubjectsForBatch(schoolId, batch2082!._id);
    await provisionSubjectsForBatch(schoolId, batch2083!._id);

    const subjectQuery = Subject.find({ schoolId, yearIds: { $in: [year1._id, year2._id] } });
    const subjects = session ? await subjectQuery.session(session) : await subjectQuery;

    const subjectByCode = {
      ANAT: subjects.find((subject) => subject.code === "ANAT" && subject.yearIds.some((id) => id.equals(year1._id)))!,
      PHYS: subjects.find((subject) => subject.code === "PHYS" && subject.yearIds.some((id) => id.equals(year1._id)))!,
      ENG: subjects.find((subject) => subject.code === "ENG" && subject.yearIds.some((id) => id.equals(year1._id)))!,
      CH: subjects.find((subject) => subject.code === "CH" && subject.yearIds.some((id) => id.equals(year1._id)))!,
      PHAR: subjects.find((subject) => subject.code === "PHAR" && subject.yearIds.some((id) => id.equals(year2._id)))!,
      MS: subjects.find((subject) => subject.code === "MS" && subject.yearIds.some((id) => id.equals(year2._id)))!,
      MIC: subjects.find((subject) => subject.code === "MIC" && subject.yearIds.some((id) => id.equals(year2._id)))!
    };

    const teacherDefs = [
      {
        cred: demoCredentials.teachers[0],
        code: "TCH001",
        subjects: [subjectByCode.ANAT, subjectByCode.PHYS],
        batchIds: [batch2082!._id],
        yearIds: [year1._id],
        salary: 45000
      },
      {
        cred: demoCredentials.teachers[1],
        code: "TCH002",
        subjects: [subjectByCode.ENG],
        batchIds: [batch2082!._id],
        yearIds: [year1._id, year2._id],
        salary: 42000
      },
      {
        cred: demoCredentials.teachers[2],
        code: "TCH003",
        subjects: [subjectByCode.PHAR, subjectByCode.MS],
        batchIds: [batch2082!._id],
        yearIds: [year2._id],
        salary: 44000
      },
      {
        cred: demoCredentials.teachers[3],
        code: "TCH004",
        subjects: [subjectByCode.CH, subjectByCode.MIC],
        batchIds: [batch2082!._id],
        yearIds: [year1._id, year2._id],
        salary: 41000
      }
    ];

    const teachers: Array<{ profile: typeof Teacher.prototype; userId: mongoose.Types.ObjectId }> = [];

    for (const def of teacherDefs) {
      const [user] = await User.create(
        [
          {
            schoolId,
            fullName: def.cred.name,
            email: def.cred.email,
            phone: "9801000000",
            password: DEMO_PASSWORD,
            role: "TEACHER",
            mustChangePassword: false
          }
        ],
        options
      );

      const [teacher] = await Teacher.create(
        [
          {
            schoolId,
            user: user!._id,
            teacherCode: def.code,
            qualification: "B.N.",
            joinedDateBs: "2078-04-01",
            address,
            subjects: def.subjects.map((s) => s._id),
            assignedBatchIds: def.batchIds,
            assignedYearIds: def.yearIds,
            basicSalaryNpr: def.salary
          }
        ],
        options
      );

      teachers.push({ profile: teacher!, userId: user!._id });

      for (const subject of def.subjects) {
        await Subject.updateOne({ _id: subject!._id }, { $addToSet: { teacherIds: teacher!._id } }, options);
      }
    }

    const teacherByCode = {
      ram: teachers[0]!,
      sita: teachers[1]!,
      hari: teachers[2]!,
      gita: teachers[3]!
    };

    const studentDefs = [
      ...demoCredentials.students.slice(0, 5).map((cred, index) => ({
        cred,
        batchId: batch2082!._id,
        yearId: year1._id,
        admissionNumber: `HA2082-${String(index + 1).padStart(3, "0")}`,
        roll: index + 1
      })),
      ...demoCredentials.students.slice(5).map((cred, index) => ({
        cred,
        batchId: batch2082!._id,
        yearId: year2._id,
        admissionNumber: `HA2082-${String(100 + index + 1).padStart(3, "0")}`,
        roll: index + 1
      }))
    ];

    const students: Array<{ profile: typeof Student.prototype; userId: mongoose.Types.ObjectId }> = [];

    for (const def of studentDefs) {
      const [user] = await User.create(
        [
          {
            schoolId,
            fullName: def.cred.name,
            email: def.cred.email,
            phone: "9802000000",
            password: DEMO_PASSWORD,
            role: "STUDENT",
            mustChangePassword: false
          }
        ],
        options
      );

      const [student] = await Student.create(
        [
          {
            schoolId,
            user: user!._id,
            admissionNumber: def.admissionNumber,
            rollNumber: def.roll,
            batchId: def.batchId,
            yearId: def.yearId,
            admissionDateBs: "2081-04-15",
            dateOfBirthBs: "2066-08-10",
            gender: def.roll % 2 === 0 ? "Female" : "Male",
            bloodGroup: "O+",
            address,
            fatherName: "Demo Father",
            motherName: "Demo Mother",
            guardianName: "Demo Guardian",
            guardianPhone: "9803000000",
            feesDueNpr: def.roll === 1 ? 2500 : 0
          }
        ],
        options
      );

      students.push({ profile: student!, userId: user!._id });
    }

    const [parentUser] = await User.create(
      [
        {
          schoolId,
          fullName: "Ramesh Sharma",
          email: demoCredentials.parent.email,
          phone: "9804000000",
          password: DEMO_PASSWORD,
          role: "PARENT",
          mustChangePassword: false
        }
      ],
      options
    );

    await ParentChildLink.create(
      [
        {
          schoolId,
          parentUserId: parentUser!._id,
          studentId: students[0]!.profile._id,
          relationship: "FATHER",
          isPrimary: true
        }
      ],
      options
    );

    await User.create(
      [
        {
          schoolId,
          fullName: demoCredentials.libraryStaff.name,
          email: demoCredentials.libraryStaff.email,
          phone: "9804100000",
          password: DEMO_PASSWORD,
          role: "LIBRARY_STAFF",
          mustChangePassword: false
        },
        {
          schoolId,
          fullName: demoCredentials.laboratoryStaff.name,
          email: demoCredentials.laboratoryStaff.email,
          phone: "9804200000",
          password: DEMO_PASSWORD,
          role: "LABORATORY_STAFF",
          mustChangePassword: false
        },
        {
          schoolId,
          fullName: demoCredentials.accountant.name,
          email: demoCredentials.accountant.email,
          phone: "9804300000",
          password: demoCredentials.accountant.password,
          role: "ACCOUNTANT",
          mustChangePassword: false
        }
      ],
      options
    );

    const accountantUser = await User.findOne({ email: demoCredentials.accountant.email }).session(session);
    await Accountant.create(
      [
        {
          schoolId,
          user: accountantUser!._id,
          employeeId: demoCredentials.accountant.employeeId,
          gender: "Female",
          address,
          joinedDateBs: "2080-04-01",
          status: "ACTIVE"
        }
      ],
      options
    );

    const collegeStaffSeedRows = [
      { credential: demoCredentials.collegeStaff.security, category: "SECURITY_GUARD" as const, staffId: "SEC001", designation: "Security Guard" },
      { credential: demoCredentials.collegeStaff.housekeeping, category: "HOUSEKEEPING" as const, staffId: "HKP001", designation: "Housekeeping Staff" },
      { credential: demoCredentials.collegeStaff.receptionist, category: "RECEPTIONIST" as const, staffId: "REC001", designation: "Receptionist" },
      { credential: demoCredentials.collegeStaff.officeAssistant, category: "OFFICE_ASSISTANT" as const, staffId: "OFA001", designation: "Office Assistant" },
      { credential: demoCredentials.collegeStaff.transport, category: "TRANSPORT" as const, staffId: "DRV001", designation: "Bus Driver" },
      { credential: demoCredentials.collegeStaff.it, category: "IT_STAFF" as const, staffId: "IT001", designation: "IT Support" },
      { credential: demoCredentials.collegeStaff.other, category: "OTHER" as const, staffId: "OTH001", designation: "General Staff" }
    ];

    for (const row of collegeStaffSeedRows) {
      const staffUser = await User.create(
        [
          {
            schoolId,
            fullName: row.credential.name,
            email: row.credential.email,
            phone: row.credential.phone,
            password: row.credential.password,
            role: "COLLEGE_STAFF",
            mustChangePassword: false
          }
        ],
        options
      );

      await CollegeStaff.create(
        [
          {
            schoolId,
            user: staffUser[0]!._id,
            staffId: row.staffId,
            fullName: row.credential.name,
            gender: row.credential.gender,
            phone: row.credential.phone,
            email: row.credential.email,
            address,
            joinedDateBs: "2080-05-01",
            designation: row.designation,
            department: "Administration",
            category: row.category,
            customRoleLabel: row.category === "OTHER" ? "General Staff" : undefined,
            qualification: "As per HR record",
            experienceYears: 2,
            employmentType: "FULL_TIME",
            basicSalaryNpr: row.credential.basicSalaryNpr,
            status: "ACTIVE",
            enableLogin: true,
            credentialsEmailStatus: "SENT",
            credentialsEmailSentAt: new Date()
          }
        ],
        options
      );
    }

    const year1Students = students.slice(0, 5).map((s) => s.profile);
    const year2Students = students.slice(5).map((s) => s.profile);

    for (const dateBs of attendanceDates) {
      const attendanceRows = [
        { teacher: teacherByCode.ram, subject: subjectByCode.ANAT, batchId: batch2082!._id, yearId: year1._id, roster: year1Students },
        { teacher: teacherByCode.sita, subject: subjectByCode.ENG, batchId: batch2082!._id, yearId: year1._id, roster: year1Students },
        { teacher: teacherByCode.gita, subject: subjectByCode.CH, batchId: batch2082!._id, yearId: year1._id, roster: year1Students },
        { teacher: teacherByCode.hari, subject: subjectByCode.PHAR, batchId: batch2082!._id, yearId: year2._id, roster: year2Students },
        { teacher: teacherByCode.sita, subject: subjectByCode.MIC, batchId: batch2082!._id, yearId: year2._id, roster: year2Students }
      ];

      for (const row of attendanceRows) {
        await Attendance.create(
          [
            {
              schoolId,
              batchId: row.batchId,
              yearId: row.yearId,
              subjectId: row.subject._id,
              teacherId: row.teacher.profile._id,
              dateBs,
              entries: row.roster.map((student, index) => ({
                studentId: student._id,
                status: statuses[(index + attendanceDates.indexOf(dateBs)) % statuses.length]
              })),
              createdBy: adminUser!._id
            }
          ],
          options
        );
      }
    }

    const [exam] = await Exam.create(
      [
        {
          schoolId,
          name: "First Terminal Examination",
          academicYearBs: DEFAULT_ACADEMIC_YEAR_BS,
          startDateBs: "2081-08-01",
          endDateBs: "2081-08-15",
          batchIds: [batch2082!._id],
          yearIds: [year1._id, year2._id]
        }
      ],
      options
    );

    const resultPlans = [
      { student: students[0]!, batchId: batch2082!._id, yearId: year1._id, marks: [{ subject: subjectByCode.ANAT, obtained: 82 }, { subject: subjectByCode.ENG, obtained: 76 }, { subject: subjectByCode.PHYS, obtained: 88 }] },
      { student: students[1]!, batchId: batch2082!._id, yearId: year1._id, marks: [{ subject: subjectByCode.ANAT, obtained: 71 }, { subject: subjectByCode.ENG, obtained: 79 }, { subject: subjectByCode.PHYS, obtained: 74 }] },
      { student: students[5]!, batchId: batch2082!._id, yearId: year2._id, marks: [{ subject: subjectByCode.PHAR, obtained: 85 }, { subject: subjectByCode.MIC, obtained: 72 }, { subject: subjectByCode.MS, obtained: 80 }] },
      { student: students[6]!, batchId: batch2082!._id, yearId: year2._id, marks: [{ subject: subjectByCode.PHAR, obtained: 68 }, { subject: subjectByCode.MIC, obtained: 70 }, { subject: subjectByCode.MS, obtained: 65 }] }
    ];

    for (const plan of resultPlans) {
      const computedMarks = plan.marks.map((mark) =>
        computeSubjectMark({
          subjectId: mark.subject._id.toString(),
          fullMarks: mark.subject.fullMarks,
          passMarks: mark.subject.passMarks,
          theoryMarks: mark.obtained,
          practicalMarks: 0,
          internalMarks: 0,
          obtainedMarks: 0,
          attendanceStatus: "PRESENT"
        })
      );
      const totals = buildResultTotals(
        computedMarks.map((mark) => ({
          obtainedMarks: mark.obtainedMarks,
          fullMarks: mark.fullMarks,
          passFail: mark.passFail
        }))
      );

      await Result.create(
        [
          {
            schoolId,
            examId: exam!._id,
            studentId: plan.student.profile._id,
            batchId: plan.batchId,
            yearId: plan.yearId,
            marks: computedMarks,
            percentage: totals.percentage,
            gpa: totals.gpa,
            grade: totals.grade,
            passFailStatus: totals.passFailStatus,
            publishedAtBs: "2081-09-01"
          }
        ],
        options
      );
    }

    await Notice.create(
      [
        {
          schoolId,
          title: "Welcome to New Academic Session",
          content: "Classes resume from 2081-09-01. Please check the timetable.",
          visibleTo: ["COLLEGE_ADMIN", "TEACHER", "STUDENT", "PARENT"],
          publishDateBs: "2081-08-25",
          createdBy: adminUser!._id
        },
        {
          schoolId,
          title: "Anatomy Unit Test Reminder",
          content: "Batch 2082 — 1st Year Anatomy unit test is scheduled for next week.",
          visibleTo: ["STUDENT", "PARENT", "TEACHER"],
          publishDateBs: "2081-09-10",
          subjectId: subjectByCode.ANAT._id,
          teacherId: teacherByCode.ram.profile._id,
          createdBy: teacherByCode.ram.userId
        }
      ],
      options
    );

    const seedCalendarEvent = (dateBs: string, name: string, eventType: "FESTIVAL" | "SEMESTER_START" | "FINAL_EXAMINATION" | "COLLEGE_HOLIDAY", reason: string) => {
      const { dateAd, dayOfWeek } = bsToAdDate(dateBs);
      return {
        schoolId,
        academicYearBs: DEFAULT_ACADEMIC_YEAR_BS,
        dateBs,
        dateAd,
        dayOfWeek,
        name,
        eventType,
        reason,
        isHoliday: eventType === "FESTIVAL" || eventType === "COLLEGE_HOLIDAY",
        audit: { createdBy: adminUser!._id }
      };
    };

    await AcademicCalendarEvent.create(
      [
        seedCalendarEvent("2083-06-15", "Dashain Vacation", "FESTIVAL", "College Closed"),
        seedCalendarEvent("2083-08-01", "Semester Begins", "SEMESTER_START", "First Semester Starts"),
        seedCalendarEvent("2083-11-10", "Final Examination", "FINAL_EXAMINATION", "End of semester examinations"),
        seedCalendarEvent("2083-05-01", "College Holiday", "COLLEGE_HOLIDAY", "Staff development day")
      ],
      options
    );

    // First-period coverage Sun–Fri so daily attendance works every working day in the demo.
    const year1FirstPeriodDays = [
      { day: 0, subject: subjectByCode.ANAT, teacher: teacherByCode.ram },
      { day: 1, subject: subjectByCode.ANAT, teacher: teacherByCode.ram },
      { day: 2, subject: subjectByCode.PHYS, teacher: teacherByCode.ram },
      { day: 3, subject: subjectByCode.ENG, teacher: teacherByCode.sita },
      { day: 4, subject: subjectByCode.ANAT, teacher: teacherByCode.ram },
      { day: 5, subject: subjectByCode.PHYS, teacher: teacherByCode.ram }
    ];
    const year2FirstPeriodDays = [
      { day: 0, subject: subjectByCode.PHAR, teacher: teacherByCode.hari },
      { day: 1, subject: subjectByCode.PHAR, teacher: teacherByCode.hari },
      { day: 2, subject: subjectByCode.MIC, teacher: teacherByCode.sita },
      { day: 3, subject: subjectByCode.PHAR, teacher: teacherByCode.hari },
      { day: 4, subject: subjectByCode.MIC, teacher: teacherByCode.gita },
      { day: 5, subject: subjectByCode.PHAR, teacher: teacherByCode.hari }
    ];

    const timetableRows = [
      ...year1FirstPeriodDays.map((row) => ({
        batchId: batch2082!._id,
        yearId: year1._id,
        day: row.day,
        period: 1,
        subject: row.subject,
        teacher: row.teacher,
        start: "10:00",
        end: "10:45"
      })),
      { batchId: batch2082!._id, yearId: year1._id, day: 1, period: 2, subject: subjectByCode.ENG, teacher: teacherByCode.sita, start: "10:45", end: "11:30" },
      ...year2FirstPeriodDays.map((row) => ({
        batchId: batch2082!._id,
        yearId: year2._id,
        day: row.day,
        period: 1,
        subject: row.subject,
        teacher: row.teacher,
        start: "10:00",
        end: "10:45"
      })),
      { batchId: batch2082!._id, yearId: year2._id, day: 1, period: 2, subject: subjectByCode.MIC, teacher: teacherByCode.sita, start: "10:45", end: "11:30" }
    ];

    await TimetableSlot.create(
      timetableRows.map((row) => ({
        schoolId,
        batchId: row.batchId,
        yearId: row.yearId,
        dayOfWeek: row.day,
        periodNumber: row.period,
        subjectId: row.subject._id,
        teacherId: row.teacher.profile._id,
        room: "Room 101",
        startTime: row.start,
        endTime: row.end,
        academicYearBs: DEFAULT_ACADEMIC_YEAR_BS
      })),
      options
    );

    const [book] = await LibraryBook.create(
      [
        {
          schoolId,
          title: "Nepal History and Culture",
          author: "Ministry of Education",
          isbn: "978-9937-1234-0",
          category: "Reference",
          totalCopies: 5,
          availableCopies: 4,
          shelfLocation: "A-12"
        }
      ],
      options
    );

    await LibraryIssue.create(
      [
        {
          schoolId,
          bookId: book!._id,
          studentId: students[0]!.profile._id,
          issuedDateBs: "2081-09-01",
          dueDateBs: "2081-09-20",
          status: "ISSUED"
        }
      ],
      options
    );

    const labDefs = [
      {
        name: "Chemistry Lab",
        type: "CHEMISTRY" as const,
        code: "CHEM-001",
        department: "Science Faculty",
        location: "Block A",
        roomNumber: "A-101",
        inChargeTeacherId: teacherByCode.ram.profile._id
      },
      {
        name: "Physics Lab",
        type: "PHYSICS" as const,
        code: "PHYS-001",
        department: "Science Faculty",
        location: "Block A",
        roomNumber: "A-102",
        inChargeTeacherId: teacherByCode.sita.profile._id
      }
    ];

    for (const labDef of labDefs) {
      const [lab] = await Laboratory.create(
        [
          {
            schoolId,
            name: labDef.name,
            code: labDef.code,
            type: labDef.type,
            department: labDef.department,
            location: labDef.location,
            roomNumber: labDef.roomNumber,
            inChargeTeacherId: labDef.inChargeTeacherId,
            description: `${labDef.name} for undergraduate practical sessions`,
            isActive: true
          }
        ],
        options
      );

      const categories = await LaboratoryCategory.create(
        DEFAULT_LAB_CATEGORIES[labDef.type].map((categoryName) => ({
          schoolId,
          laboratoryId: lab!._id,
          name: categoryName,
          isDefault: true
        })),
        options
      );

      const glasswareCategory = categories.find((category) => category.name === "Glassware");
      const chemicalsCategory = categories.find((category) => category.name === "Chemicals");
      const measuringCategory = categories.find((category) => category.name === "Measuring Instruments");

      if (labDef.type === "CHEMISTRY" && glasswareCategory) {
        const [equipment] = await LaboratoryEquipment.create(
          [
            {
              schoolId,
              laboratoryId: lab!._id,
              categoryId: glasswareCategory._id,
              name: "Beaker Set (250ml)",
              itemCode: "CHEM-BKR-250",
              itemKind: "NON_DISPOSABLE",
              unit: "set",
              quantity: 20,
              availableQuantity: 18,
              minimumStockLevel: 5,
              condition: "GOOD",
              equipmentStatus: "AVAILABLE",
              storageLocation: "Rack A1",
              purchaseCost: 2500,
              description: "Borosilicate glass beakers for acid-base experiments"
            }
          ],
          options
        );

        await LaboratoryIssue.create(
          [
            {
              schoolId,
              equipmentId: equipment!._id,
              teacherId: teacherByCode.ram.profile._id,
              quantity: 2,
              issuedDateBs: "2081-09-10",
              dueDateBs: getOffsetBsDate(5),
              status: "ISSUED"
            }
          ],
          options
        );

        await LaboratoryStockMovement.create(
          [
            {
              schoolId,
              laboratoryId: lab!._id,
              equipmentId: equipment!._id,
              type: "INCREASE",
              quantity: 20,
              previousStock: 0,
              newStock: 20,
              notes: "Initial stock"
            }
          ],
          options
        );
      }

      if (labDef.type === "CHEMISTRY" && chemicalsCategory) {
        const [gloves] = await LaboratoryEquipment.create(
          [
            {
              schoolId,
              laboratoryId: lab!._id,
              categoryId: chemicalsCategory._id,
              name: "Nitrile Gloves (Box)",
              itemCode: "CHEM-GLV-001",
              itemKind: "DISPOSABLE",
              unit: "box",
              quantity: 8,
              availableQuantity: 3,
              minimumStockLevel: 5,
              condition: "NEW",
              equipmentStatus: "AVAILABLE",
              storageLocation: "Shelf B2",
              purchaseCost: 450,
              description: "Disposable nitrile gloves for lab safety"
            }
          ],
          options
        );

        await LaboratoryStockRequest.create(
          [
            {
              schoolId,
              laboratoryId: lab!._id,
              equipmentId: gloves!._id,
              equipmentName: gloves!.name,
              categoryName: "Chemicals",
              currentStock: 3,
              minimumStock: 5,
              requiredQuantity: 2,
              priority: "HIGH",
              requestDateBs: getTodayBs(),
              status: "PENDING",
              autoGenerated: true
            }
          ],
          options
        );
      }

      if (labDef.type === "PHYSICS" && measuringCategory) {
        await LaboratoryEquipment.create(
          [
            {
              schoolId,
              laboratoryId: lab!._id,
              categoryId: measuringCategory._id,
              name: "Vernier Caliper",
              itemCode: "PHYS-VC-001",
              itemKind: "NON_DISPOSABLE",
              brand: "Mitutoyo",
              unit: "pcs",
              quantity: 15,
              availableQuantity: 14,
              minimumStockLevel: 4,
              condition: "GOOD",
              equipmentStatus: "AVAILABLE",
              storageLocation: "Cabinet P1",
              purchaseCost: 3200,
              description: "Precision measuring instrument for mechanics practicals"
            }
          ],
          options
        );
      }
    }

    const [route] = await TransportRoute.create(
      [
        {
          schoolId,
          name: "Ring Road East Route",
          vehicleNumber: "Ba 1 Pa 1234",
          driverName: "Suresh Karki",
          driverPhone: "9805000000",
          stops: [
            { name: "Koteshwor", pickupTime: "06:30" },
            { name: "Gausala", pickupTime: "06:45" },
            { name: "College Gate", pickupTime: "07:15" }
          ],
          monthlyFeeNpr: 3500,
          isActive: true
        }
      ],
      options
    );

    await TransportAssignment.create(
      [
        {
          schoolId,
          routeId: route!._id,
          studentId: students[2]!.profile._id,
          pickupStop: "Koteshwor",
          dropStop: "College Gate",
          isActive: true
        }
      ],
      options
    );

    await LeaveRequest.create(
      [
        {
          schoolId,
          teacherId: teacherByCode.sita.profile._id,
          type: "CASUAL",
          startDateBs: "2081-10-01",
          endDateBs: "2081-10-02",
          reason: "Family function",
          status: "APPROVED",
          approvedBy: adminUser!._id
        }
      ],
      options
    );

    await Payroll.create(
      [
        {
          schoolId,
          teacherId: teacherByCode.ram.profile._id,
          monthBs: "2081-08",
          basicSalaryNpr: 45000,
          allowancesNpr: 5000,
          deductionsNpr: 2000,
          netSalaryNpr: 48000,
          status: "PAID",
          paidDateBs: "2081-09-05"
        }
      ],
      options
    );

    const [feeStructure] = await FeeStructure.create(
      [
        {
          schoolId,
          title: "Monthly Tuition Fee",
          classIds: [],
          feeType: "MONTHLY",
          frequency: "MONTHLY",
          academicYearBs: DEFAULT_ACADEMIC_YEAR_BS,
          amountNpr: 3500,
          isOptional: false
        }
      ],
      options
    );

    const [feeCollection1, feeCollection2] = await FeeCollection.create(
      [
        {
          schoolId,
          studentId: students[1]!.profile._id,
          feeStructureId: feeStructure!._id,
          receiptNumber: "RCPT-DEMO-001",
          paidDateBs: "2081-09-01",
          previousDueNpr: 0,
          currentChargesNpr: 3500,
          amountPaidNpr: 3500,
          discountNpr: 0,
          scholarshipNpr: 0,
          lateFeeNpr: 0,
          remainingDueNpr: 0,
          paymentMethod: "CASH",
          feeBreakdown: [{ feeType: "MONTHLY", title: "Monthly Tuition Fee", amountNpr: 3500 }],
          accountantName: demoCredentials.accountant.name,
          createdBy: accountantUser!._id
        },
        {
          schoolId,
          studentId: students[0]!.profile._id,
          feeStructureId: feeStructure!._id,
          receiptNumber: "RCPT-DEMO-002",
          paidDateBs: "2081-09-05",
          previousDueNpr: 2500,
          currentChargesNpr: 3500,
          amountPaidNpr: 5000,
          discountNpr: 200,
          scholarshipNpr: 300,
          lateFeeNpr: 100,
          remainingDueNpr: 600,
          paymentMethod: "BANK_TRANSFER",
          isInstallment: true,
          installmentNumber: 1,
          feeBreakdown: [{ feeType: "MONTHLY", title: "Monthly Tuition Fee", amountNpr: 3500 }],
          accountantName: demoCredentials.accountant.name,
          createdBy: accountantUser!._id
        }
      ],
      options
    );

    await AccountingSettings.create(
      [{ schoolId, lateFinePercent: 2, lateFineGraceDays: 5, receiptPrefix: "RCPT", autoReceiptNumber: true }],
      options
    );

    await BankAccount.create(
      [
        {
          schoolId,
          bankName: "Nepal Bank Limited",
          accountName: "Public Himal Institute of Technology",
          accountNumber: "0123456789012345",
          branch: "Kathmandu Main",
          openingBalanceNpr: 150000,
          currentBalanceNpr: 185000,
          isActive: true
        }
      ],
      options
    );

    await AccountingExpense.create(
      [
        {
          schoolId,
          category: "Electricity",
          vendor: "NEA Kathmandu",
          dateBs: "2081-08-28",
          amountNpr: 12500,
          paymentMethod: "BANK_TRANSFER",
          description: "Monthly electricity bill",
          createdBy: accountantUser!._id
        },
        {
          schoolId,
          category: "Office Expenses",
          vendor: "Stationery World",
          dateBs: "2081-09-02",
          amountNpr: 4500,
          paymentMethod: "CASH",
          description: "Office stationery supplies",
          createdBy: accountantUser!._id
        }
      ],
      options
    );

    await AccountingPurchase.create(
      [
        {
          schoolId,
          category: "Books",
          vendor: "Ekta Books Distributors",
          purchaseDateBs: "2081-08-15",
          invoiceNumber: "INV-2025-0412",
          quantity: 120,
          unitPriceNpr: 350,
          totalAmountNpr: 42000,
          paymentStatus: "PAID",
          paymentMethod: "BANK_TRANSFER",
          description: "HA program textbooks",
          createdBy: accountantUser!._id
        }
      ],
      options
    );

    await AccountingIncome.create(
      [
        {
          schoolId,
          category: "Donations",
          source: "Local Community Fund",
          dateBs: "2081-09-10",
          amountNpr: 25000,
          paymentMethod: "CASH",
          description: "Annual community donation",
          createdBy: accountantUser!._id
        }
      ],
      options
    );

    await SalaryPayment.create(
      [
        {
          schoolId,
          employeeType: "TEACHER",
          teacherId: teacherByCode.ram.profile._id,
          monthBs: "2081-09",
          basicSalaryNpr: 45000,
          allowancesNpr: 5000,
          bonusNpr: 2000,
          advanceSalaryNpr: 0,
          loanDeductionNpr: 1000,
          taxNpr: 1500,
          otherDeductionsNpr: 500,
          netSalaryNpr: 49000,
          status: "PAID",
          paidDateBs: "2081-09-05",
          paymentMethod: "BANK_TRANSFER",
          createdBy: accountantUser!._id
        }
      ],
      options
    );

    await Student.findByIdAndUpdate(students[0]!.profile._id, { feesDueNpr: 600 }, options);
    await Student.findByIdAndUpdate(students[1]!.profile._id, { feesDueNpr: 0 }, options);

    await CashBookEntry.create(
      [
        {
          schoolId,
          dateBs: "2081-09-01",
          entryType: "CREDIT",
          category: "Fee Collection",
          description: `Fee receipt ${feeCollection1!.receiptNumber}`,
          amountNpr: 3500,
          paymentMethod: "CASH",
          referenceType: "FeeCollection",
          referenceId: feeCollection1!._id,
          balanceAfterNpr: 3500,
          createdBy: accountantUser!._id
        },
        {
          schoolId,
          dateBs: "2081-09-05",
          entryType: "CREDIT",
          category: "Fee Collection",
          description: `Fee receipt ${feeCollection2!.receiptNumber}`,
          amountNpr: 5000,
          paymentMethod: "BANK_TRANSFER",
          referenceType: "FeeCollection",
          referenceId: feeCollection2!._id,
          balanceAfterNpr: 8500,
          createdBy: accountantUser!._id
        }
      ],
      options
    );

    await Notification.create(
      [
        {
          schoolId,
          recipientUserId: parentUser!._id,
          title: "Attendance Alert",
          message: "Your child was marked absent in a subject class on 2081-09-16.",
          channel: "IN_APP",
          type: "ATTENDANCE",
          read: false,
          smsStatus: "SKIPPED"
        }
      ],
      options
    );

    console.log(`Demo college created: ${school!.name} (${school!.code})`);
  });
};

