import { DEFAULT_ACADEMIC_YEAR_BS, DEFAULT_LAB_CATEGORIES, DEMO_PASSWORD, DEMO_SCHOOL_CODE, demoCredentials } from "@nepal-school-erp/shared";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Assignment, AssignmentSubmission } from "../models/Assignment.js";
import { Attendance } from "../models/Attendance.js";
import { Exam } from "../models/Exam.js";
import { Accountant } from "../models/Accountant.js";
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
import { Laboratory, LaboratoryCategory, LaboratoryEquipment, LaboratoryIssue } from "../models/Laboratory.js";
import { LeaveRequest, Payroll } from "../models/LeaveRequest.js";
import { Notice } from "../models/Notice.js";
import { Notification } from "../models/Notification.js";
import { ParentChildLink } from "../models/ParentChildLink.js";
import { Result } from "../models/Result.js";
import { School } from "../models/School.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Setting } from "../models/Setting.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { TransportAssignment, TransportRoute } from "../models/TransportRoute.js";
import { User } from "../models/User.js";
import { deleteSchoolCascade } from "../utils/deleteSchoolCascade.js";
import { calculateResultGrade, getOffsetBsDate, getTodayBs } from "../utils/nepaliDate.js";
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
    LeaveRequest.syncIndexes(),
    Payroll.syncIndexes(),
    Notice.syncIndexes(),
    Notification.syncIndexes(),
    ParentChildLink.syncIndexes(),
    Result.syncIndexes(),
    School.syncIndexes(),
    SchoolClass.syncIndexes(),
    Section.syncIndexes(),
    Setting.syncIndexes(),
    Student.syncIndexes(),
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
        console.log(`Demo school (${DEMO_SCHOOL_CODE}) already exists — skipping seed.`);
        return;
      }

      console.log(`Removing existing demo school (${DEMO_SCHOOL_CODE})...`);
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
          fullName: "Demo School Administrator",
          email: demoCredentials.schoolAdmin.email,
          phone: "9801111000",
          password: DEMO_PASSWORD,
          role: "SCHOOL_ADMIN",
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

    const [class9, class10] = await SchoolClass.create(
      [
        { schoolId, name: "Class 9", level: "Class 9", academicYearBs: DEFAULT_ACADEMIC_YEAR_BS, isActive: true },
        { schoolId, name: "Class 10", level: "Class 10", academicYearBs: DEFAULT_ACADEMIC_YEAR_BS, isActive: true }
      ],
      options
    );

    const [section9A, section10A] = await Section.create(
      [
        { schoolId, classId: class9!._id, name: "A", capacity: 40 },
        { schoolId, classId: class10!._id, name: "A", capacity: 35 }
      ],
      options
    );

    const subjectDefs = [
      { name: "Mathematics", code: "MATH9", classId: class9!._id, fullMarks: 100, passMarks: 35 },
      { name: "English", code: "ENG9", classId: class9!._id, fullMarks: 100, passMarks: 35 },
      { name: "Science", code: "SCI9", classId: class9!._id, fullMarks: 100, passMarks: 35 },
      { name: "Social Studies", code: "SOC9", classId: class9!._id, fullMarks: 100, passMarks: 35 },
      { name: "Nepali", code: "NEP9", classId: class9!._id, fullMarks: 100, passMarks: 35 },
      { name: "Mathematics", code: "MATH10", classId: class10!._id, fullMarks: 100, passMarks: 35 },
      { name: "English", code: "ENG10", classId: class10!._id, fullMarks: 100, passMarks: 35 },
      { name: "Science", code: "SCI10", classId: class10!._id, fullMarks: 100, passMarks: 35 },
      { name: "Social Studies", code: "SOC10", classId: class10!._id, fullMarks: 100, passMarks: 35 },
      { name: "Nepali", code: "NEP10", classId: class10!._id, fullMarks: 100, passMarks: 35 }
    ];

    const subjects = await Subject.create(
      subjectDefs.map((item) => ({
        schoolId,
        name: item.name,
        code: item.code,
        classIds: [item.classId],
        teacherIds: [],
        fullMarks: item.fullMarks,
        passMarks: item.passMarks
      })),
      options
    );

    const subjectByCode = {
      MATH9: subjects[0]!,
      ENG9: subjects[1]!,
      SCI9: subjects[2]!,
      SOC9: subjects[3]!,
      NEP9: subjects[4]!,
      MATH10: subjects[5]!,
      ENG10: subjects[6]!,
      SCI10: subjects[7]!,
      SOC10: subjects[8]!,
      NEP10: subjects[9]!
    };

    const teacherDefs = [
      {
        cred: demoCredentials.teachers[0],
        code: "TCH001",
        subjects: [subjectByCode.MATH9, subjectByCode.SCI9],
        classIds: [class9!._id],
        sectionIds: [section9A!._id],
        salary: 45000
      },
      {
        cred: demoCredentials.teachers[1],
        code: "TCH002",
        subjects: [subjectByCode.ENG9, subjectByCode.ENG10],
        classIds: [class9!._id, class10!._id],
        sectionIds: [section9A!._id, section10A!._id],
        salary: 42000
      },
      {
        cred: demoCredentials.teachers[2],
        code: "TCH003",
        subjects: [subjectByCode.MATH10, subjectByCode.SCI10, subjectByCode.NEP10],
        classIds: [class10!._id],
        sectionIds: [section10A!._id],
        salary: 44000
      },
      {
        cred: demoCredentials.teachers[3],
        code: "TCH004",
        subjects: [subjectByCode.NEP9, subjectByCode.SOC9, subjectByCode.SOC10],
        classIds: [class9!._id, class10!._id],
        sectionIds: [section9A!._id, section10A!._id],
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
            qualification: "M.Ed.",
            joinedDateBs: "2078-04-01",
            address,
            subjects: def.subjects.map((s) => s._id),
            assignedClassIds: def.classIds,
            assignedSectionIds: def.sectionIds,
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
        classId: class9!._id,
        sectionId: section9A!._id,
        admissionNumber: `ADM9-${String(index + 1).padStart(3, "0")}`,
        roll: index + 1
      })),
      ...demoCredentials.students.slice(5).map((cred, index) => ({
        cred,
        classId: class10!._id,
        sectionId: section10A!._id,
        admissionNumber: `ADM10-${String(index + 1).padStart(3, "0")}`,
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
            classId: def.classId,
            sectionId: def.sectionId,
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

    const class9Students = students.slice(0, 5).map((s) => s.profile);
    const class10Students = students.slice(5).map((s) => s.profile);

    for (const dateBs of attendanceDates) {
      const attendanceRows = [
        { teacher: teacherByCode.ram, subject: subjectByCode.MATH9, classId: class9!._id, sectionId: section9A!._id, roster: class9Students },
        { teacher: teacherByCode.sita, subject: subjectByCode.ENG9, classId: class9!._id, sectionId: section9A!._id, roster: class9Students },
        { teacher: teacherByCode.gita, subject: subjectByCode.NEP9, classId: class9!._id, sectionId: section9A!._id, roster: class9Students },
        { teacher: teacherByCode.hari, subject: subjectByCode.MATH10, classId: class10!._id, sectionId: section10A!._id, roster: class10Students },
        { teacher: teacherByCode.sita, subject: subjectByCode.ENG10, classId: class10!._id, sectionId: section10A!._id, roster: class10Students }
      ];

      for (const row of attendanceRows) {
        await Attendance.create(
          [
            {
              schoolId,
              classId: row.classId,
              sectionId: row.sectionId,
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

    const dueTodayBs = getTodayBs();
    const dueUpcomingBs = getOffsetBsDate(5);
    const dueOverdueBs = getOffsetBsDate(-3);

    const assignmentRows = [
      {
        teacher: teacherByCode.ram,
        subject: subjectByCode.MATH9,
        classId: class9!._id,
        sectionId: section9A!._id,
        type: "HOMEWORK",
        title: "Algebra Practice Set 3",
        description: "Complete exercises 1-15 from chapter 4. Show all working steps.",
        topic: "Algebra — Unit 4",
        dueDateBs: dueUpcomingBs,
        isPinned: true,
        links: [{ title: "Khan Academy: Linear Equations", url: "https://www.khanacademy.org/math/algebra" }]
      },
      {
        teacher: teacherByCode.ram,
        subject: subjectByCode.SCI9,
        classId: class9!._id,
        sectionId: section9A!._id,
        type: "CAS",
        title: "Lab Report: Acid-Base Reaction",
        description: "Submit your lab observation report with hypothesis and conclusion.",
        topic: "Chemistry Lab",
        dueDateBs: dueTodayBs,
        maxMarks: 20
      },
      {
        teacher: teacherByCode.sita,
        subject: subjectByCode.ENG9,
        classId: class9!._id,
        sectionId: section9A!._id,
        type: "NOTE",
        title: "Essay Writing Tips",
        description: "Key points for descriptive essay structure: introduction, body paragraphs, and conclusion.",
        topic: "Writing Skills",
        allowSubmission: false
      },
      {
        teacher: teacherByCode.gita,
        subject: subjectByCode.SOC9,
        classId: class9!._id,
        sectionId: section9A!._id,
        type: "HOMEWORK",
        title: "Civic Responsibility Essay",
        description: "Write 300 words on civic duties of students in Nepal.",
        topic: "Civics",
        dueDateBs: dueOverdueBs
      },
      {
        teacher: teacherByCode.sita,
        subject: subjectByCode.ENG9,
        classId: class9!._id,
        sectionId: section9A!._id,
        type: "HOMEWORK",
        title: "Reading Comprehension — Unit 2",
        description: "Read the passage on page 42 and answer questions 1-8.",
        topic: "Reading Skills",
        dueDateBs: dueTodayBs
      },
      {
        teacher: teacherByCode.hari,
        subject: subjectByCode.MATH10,
        classId: class10!._id,
        sectionId: section10A!._id,
        type: "HOMEWORK",
        title: "Trigonometry Worksheet",
        description: "Solve problems 1-20 from the trigonometry chapter.",
        topic: "Trigonometry",
        dueDateBs: dueUpcomingBs,
        isPinned: true
      },
      {
        teacher: teacherByCode.hari,
        subject: subjectByCode.SCI10,
        classId: class10!._id,
        sectionId: section10A!._id,
        type: "CAS",
        title: "Physics Practical: Ohm's Law",
        description: "Record observations and calculate resistance from your circuit experiment.",
        topic: "Physics Lab",
        dueDateBs: dueTodayBs,
        maxMarks: 25
      },
      {
        teacher: teacherByCode.sita,
        subject: subjectByCode.ENG10,
        classId: class10!._id,
        sectionId: section10A!._id,
        type: "NOTE",
        title: "Poetry Analysis Framework",
        description: "Use the TPCASTT method when analyzing poems for your upcoming unit test.",
        topic: "Literature",
        allowSubmission: false
      }
    ];

    const createdAssignments = await Assignment.create(
      assignmentRows.map((row) => ({
        schoolId,
        type: row.type,
        title: row.title,
        description: row.description,
        classId: row.classId,
        sectionId: row.sectionId,
        subjectId: row.subject._id,
        teacherId: row.teacher.profile._id,
        topic: row.topic,
        dueDateBs: row.dueDateBs,
        maxMarks: row.maxMarks,
        visibleTo: ["STUDENT", "PARENT"],
        allowSubmission: row.allowSubmission ?? true,
        isPinned: row.isPinned ?? false,
        attachments: [],
        links: row.links ?? []
      })),
      options
    );

    const { AssignmentComment } = await import("../models/AssignmentComment.js");
    await AssignmentComment.create(
      [
        {
          schoolId,
          assignmentId: createdAssignments[0]!._id,
          authorUserId: teacherByCode.ram.userId,
          authorName: demoCredentials.teachers[0]!.name,
          authorRole: "TEACHER",
          content: "Remember to submit by the end of this week. Ask questions in class if stuck."
        },
        {
          schoolId,
          assignmentId: createdAssignments[1]!._id,
          authorUserId: teacherByCode.ram.userId,
          authorName: demoCredentials.teachers[0]!.name,
          authorRole: "TEACHER",
          content: "Lab reports must include a labelled diagram of your setup."
        },
        {
          schoolId,
          assignmentId: createdAssignments[2]!._id,
          authorUserId: teacherByCode.sita.userId,
          authorName: demoCredentials.teachers[1]!.name,
          authorRole: "TEACHER",
          content: "We will discuss these tips in tomorrow's English period."
        }
      ],
      options
    );

    await AssignmentSubmission.create(
      [
        {
          schoolId,
          assignmentId: createdAssignments[0]!._id,
          studentId: students[0]!.profile._id,
          content: "Completed all algebra exercises.",
          status: "GRADED",
          marks: 18,
          feedback: "Good work. Show steps more clearly.",
          submittedAt: new Date()
        },
        {
          schoolId,
          assignmentId: createdAssignments[0]!._id,
          studentId: students[1]!.profile._id,
          content: "Submitted partial solutions.",
          status: "SUBMITTED",
          submittedAt: new Date()
        }
      ],
      options
    );

    const [exam] = await Exam.create(
      [
        {
          schoolId,
          name: "First Terminal Examination",
          academicYearBs: DEFAULT_ACADEMIC_YEAR_BS,
          startDateBs: "2081-08-01",
          endDateBs: "2081-08-15",
          classIds: [class9!._id, class10!._id]
        }
      ],
      options
    );

    const resultPlans = [
      { student: students[0]!, classId: class9!._id, sectionId: section9A!._id, marks: [{ subject: subjectByCode.MATH9, obtained: 82 }, { subject: subjectByCode.ENG9, obtained: 76 }, { subject: subjectByCode.SCI9, obtained: 88 }] },
      { student: students[1]!, classId: class9!._id, sectionId: section9A!._id, marks: [{ subject: subjectByCode.MATH9, obtained: 71 }, { subject: subjectByCode.ENG9, obtained: 79 }, { subject: subjectByCode.SCI9, obtained: 74 }] },
      { student: students[5]!, classId: class10!._id, sectionId: section10A!._id, marks: [{ subject: subjectByCode.MATH10, obtained: 85 }, { subject: subjectByCode.ENG10, obtained: 72 }, { subject: subjectByCode.SCI10, obtained: 80 }] },
      { student: students[6]!, classId: class10!._id, sectionId: section10A!._id, marks: [{ subject: subjectByCode.MATH10, obtained: 68 }, { subject: subjectByCode.ENG10, obtained: 70 }, { subject: subjectByCode.SCI10, obtained: 65 }] }
    ];

    for (const plan of resultPlans) {
      const totalFull = plan.marks.reduce((sum, mark) => sum + mark.subject.fullMarks, 0);
      const totalObtained = plan.marks.reduce((sum, mark) => sum + mark.obtained, 0);
      const { percentage, gpa, grade } = calculateResultGrade(totalObtained, totalFull);

      await Result.create(
        [
          {
            schoolId,
            examId: exam!._id,
            studentId: plan.student.profile._id,
            classId: plan.classId,
            sectionId: plan.sectionId,
            marks: plan.marks.map((mark) => ({ subjectId: mark.subject._id, obtainedMarks: mark.obtained })),
            percentage,
            gpa,
            grade,
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
          visibleTo: ["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"],
          publishDateBs: "2081-08-25",
          createdBy: adminUser!._id
        },
        {
          schoolId,
          title: "Math Unit Test Reminder",
          content: "Class 9 Mathematics unit test is scheduled for next week.",
          visibleTo: ["STUDENT", "PARENT", "TEACHER"],
          publishDateBs: "2081-09-10",
          subjectId: subjectByCode.MATH9._id,
          classId: class9!._id,
          sectionId: section9A!._id,
          teacherId: teacherByCode.ram.profile._id,
          createdBy: teacherByCode.ram.userId
        }
      ],
      options
    );

    const timetableRows = [
      { classId: class9!._id, sectionId: section9A!._id, day: 1, period: 1, subject: subjectByCode.MATH9, teacher: teacherByCode.ram, start: "10:00", end: "10:45" },
      { classId: class9!._id, sectionId: section9A!._id, day: 1, period: 2, subject: subjectByCode.ENG9, teacher: teacherByCode.sita, start: "10:45", end: "11:30" },
      { classId: class9!._id, sectionId: section9A!._id, day: 2, period: 1, subject: subjectByCode.SCI9, teacher: teacherByCode.ram, start: "10:00", end: "10:45" },
      { classId: class10!._id, sectionId: section10A!._id, day: 1, period: 1, subject: subjectByCode.MATH10, teacher: teacherByCode.hari, start: "10:00", end: "10:45" },
      { classId: class10!._id, sectionId: section10A!._id, day: 1, period: 2, subject: subjectByCode.ENG10, teacher: teacherByCode.sita, start: "10:45", end: "11:30" }
    ];

    await TimetableSlot.create(
      timetableRows.map((row) => ({
        schoolId,
        classId: row.classId,
        sectionId: row.sectionId,
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
      { name: "Chemistry Lab", type: "CHEMISTRY" as const },
      { name: "Physics Lab", type: "PHYSICS" as const }
    ];

    for (const labDef of labDefs) {
      const [lab] = await Laboratory.create(
        [
          {
            schoolId,
            name: labDef.name,
            type: labDef.type,
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
              quantity: 20,
              availableQuantity: 18,
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
              dueDateBs: dueUpcomingBs,
              status: "ISSUED"
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
              quantity: 15,
              availableQuantity: 14,
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
            { name: "School Gate", pickupTime: "07:15" }
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
          dropStop: "School Gate",
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
          classIds: [class9!._id, class10!._id],
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
          description: "Class 9 & 10 textbooks",
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
        },
        {
          schoolId,
          recipientUserId: students[0]!.userId,
          title: "New Homework",
          message: "Algebra Practice Set 3 has been published.",
          channel: "IN_APP",
          type: "HOMEWORK",
          read: false,
          smsStatus: "SKIPPED"
        }
      ],
      options
    );

    console.log(`Demo school created: ${school!.name} (${school!.code})`);
  });
};

