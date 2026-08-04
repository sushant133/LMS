/**
 * Link missing CollegeStaff (HR) profiles for library / lab / accountant demo users
 * so /employee-attendance/me works without a full reseed.
 *
 * Usage: node scripts/repairStaffProfiles.mjs
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const address = {
  province: "Bagmati",
  district: "Kathmandu",
  municipality: "Kathmandu Metropolitan City",
  ward: "10",
  streetAddress: "Demo Campus"
};

const TARGETS = [
  {
    email: "maya.poudel@demoerp.nepal-school.com",
    staffId: "LIB001",
    category: "LIBRARIAN",
    designation: "Librarian",
    department: "Library",
    gender: "Female",
    basicSalaryNpr: 30000
  },
  {
    email: "binod.shrestha@demoerp.nepal-school.com",
    staffId: "LAB001",
    category: "LABORATORY_STAFF",
    designation: "Lab In-Charge",
    department: "Laboratory",
    gender: "Male",
    basicSalaryNpr: 32000
  },
  {
    email: "accountant@demo.school",
    staffId: "ACC001",
    category: "ACCOUNTANT",
    designation: "Accountant",
    department: "Accounts",
    gender: "Female",
    basicSalaryNpr: 40000
  }
];

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

for (const t of TARGETS) {
  const user = await db.collection("users").findOne({ email: t.email });
  if (!user) {
    console.log("SKIP no user", t.email);
    continue;
  }

  const existing = await db.collection("collegestaffs").findOne({
    user: user._id,
    isDeleted: { $ne: true }
  });
  if (existing) {
    console.log("OK already linked", t.email, String(existing._id));
    continue;
  }

  // Avoid staffId collision
  const staffIdTaken = await db.collection("collegestaffs").findOne({
    schoolId: user.schoolId,
    staffId: t.staffId
  });
  const staffId = staffIdTaken ? `${t.staffId}-U` : t.staffId;

  const doc = {
    schoolId: user.schoolId,
    user: user._id,
    staffId,
    fullName: user.fullName || t.email.split("@")[0],
    gender: t.gender,
    phone: user.phone || "9800000000",
    email: user.email,
    address,
    joinedDateBs: "2080-04-01",
    designation: t.designation,
    department: t.department,
    category: t.category,
    qualification: "As per HR record",
    experienceYears: 3,
    employmentType: "FULL_TIME",
    basicSalaryNpr: t.basicSalaryNpr,
    status: "ACTIVE",
    enableLogin: true,
    credentialsEmailStatus: "SENT",
    credentialsEmailSentAt: new Date(),
    isDeleted: false,
    documents: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection("collegestaffs").insertOne(doc);
  console.log("CREATED", t.email, "CollegeStaff", String(result.insertedId), "staffId=" + staffId);
}

await mongoose.disconnect();
console.log("Done.");
