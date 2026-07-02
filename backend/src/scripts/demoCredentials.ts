export const DEMO_SCHOOL_CODE = "DEMOERP";
export const DEMO_PASSWORD = "Demo@123456";

export const demoCredentials = {
  superAdmin: {
    email: "superadmin@nepal-school.com",
    password: "Admin@123456",
    role: "SUPER_ADMIN"
  },
  schoolAdmin: {
    email: "admin@demoerp.nepal-school.com",
    password: DEMO_PASSWORD,
    role: "SCHOOL_ADMIN"
  },
  teachers: [
    { email: "ram.sharma@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Ram Sharma", subjects: "Math & Science (Class 9-A)" },
    { email: "sita.gurung@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Sita Gurung", subjects: "English (Class 9-A & 10-A)" },
    { email: "hari.thapa@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Hari Thapa", subjects: "Math, Science & Nepali (Class 10-A)" },
    { email: "gita.rai@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Gita Rai", subjects: "Nepali & Social (Class 9-A & 10-A)" }
  ],
  students: [
    { email: "student01@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Aarav Sharma", class: "Class 9", section: "A", roll: 1 },
    { email: "student02@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Priya Karki", class: "Class 9", section: "A", roll: 2 },
    { email: "student03@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Rohan Thapa", class: "Class 9", section: "A", roll: 3 },
    { email: "student04@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Sneha Gurung", class: "Class 9", section: "A", roll: 4 },
    { email: "student05@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Niraj Adhikari", class: "Class 9", section: "A", roll: 5 },
    { email: "student06@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Kritika Rai", class: "Class 10", section: "A", roll: 1 },
    { email: "student07@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Bikash Tamang", class: "Class 10", section: "A", roll: 2 },
    { email: "student08@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Anjali Shrestha", class: "Class 10", section: "A", roll: 3 },
    { email: "student09@demoerp.nepal-school.com", password: DEMO_PASSWORD, name: "Suman Magar", class: "Class 10", section: "A", roll: 4 }
  ],
  parent: {
    email: "parent.sharma@demoerp.nepal-school.com",
    password: DEMO_PASSWORD,
    role: "PARENT",
    linkedStudent: "Aarav Sharma (student01)"
  },
  libraryStaff: {
    email: "maya.poudel@demoerp.nepal-school.com",
    password: DEMO_PASSWORD,
    name: "Maya Poudel",
    role: "LIBRARY_STAFF"
  },
  laboratoryStaff: {
    email: "binod.shrestha@demoerp.nepal-school.com",
    password: DEMO_PASSWORD,
    name: "Binod Shrestha",
    role: "LABORATORY_STAFF"
  },
  accountant: {
    email: "accountant@demo.school",
    password: "12345678",
    name: "Demo Accountant",
    employeeId: "ACC001",
    role: "ACCOUNTANT"
  }
} as const;

export const printDemoCredentials = (): void => {
  console.log("\n========== DEMO LOGIN CREDENTIALS ==========\n");
  console.log("Super Admin");
  console.log(`  Email:    ${demoCredentials.superAdmin.email}`);
  console.log(`  Password: ${demoCredentials.superAdmin.password}\n`);

  console.log("School Admin (Public Himal Institute of Technology)");
  console.log(`  Email:    ${demoCredentials.schoolAdmin.email}`);
  console.log(`  Password: ${demoCredentials.schoolAdmin.password}\n`);

  console.log("Teachers");
  demoCredentials.teachers.forEach((teacher) => {
    console.log(`  ${teacher.name} — ${teacher.subjects}`);
    console.log(`    Email: ${teacher.email}  Password: ${teacher.password}`);
  });

  console.log("\nStudents");
  demoCredentials.students.forEach((student) => {
    console.log(`  ${student.name} (${student.class} ${student.section}, Roll ${student.roll})`);
    console.log(`    Email: ${student.email}  Password: ${student.password}`);
  });

  console.log("\nParent");
  console.log(`  Email:    ${demoCredentials.parent.email}`);
  console.log(`  Password: ${demoCredentials.parent.password}`);
  console.log(`  Linked:   ${demoCredentials.parent.linkedStudent}`);

  console.log("\nLibrary Staff");
  console.log(`  ${demoCredentials.libraryStaff.name}`);
  console.log(`  Email:    ${demoCredentials.libraryStaff.email}`);
  console.log(`  Password: ${demoCredentials.libraryStaff.password}`);

  console.log("\nLaboratory Staff");
  console.log(`  ${demoCredentials.laboratoryStaff.name}`);
  console.log(`  Email:    ${demoCredentials.laboratoryStaff.email}`);
  console.log(`  Password: ${demoCredentials.laboratoryStaff.password}`);

  console.log("\nAccountant");
  console.log(`  ${demoCredentials.accountant.name} (${demoCredentials.accountant.employeeId})`);
  console.log(`  Email:    ${demoCredentials.accountant.email}`);
  console.log(`  Password: ${demoCredentials.accountant.password}`);
  console.log("\n==============================================\n");
};