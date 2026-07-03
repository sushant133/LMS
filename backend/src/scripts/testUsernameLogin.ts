import axios from "axios";

const BASE = `${process.env.TEST_API_BASE ?? "http://localhost:5001/api"}`;
const ADMIN_EMAIL = "admin@demoerp.nepal-school.com";
const ADMIN_PASSWORD = "Demo@123456";

const login = async (email: string, password: string) => {
  const response = await axios.post(`${BASE}/auth/login`, { email, password }, { validateStatus: () => true });
  return response;
};

const run = async (): Promise<void> => {
  const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (adminLogin.status !== 200) {
    throw new Error(`Admin login failed: ${adminLogin.status}`);
  }

  const cookieHeader = adminLogin.headers["set-cookie"]?.map((value: string) => value.split(";")[0]).join("; ");
  const admin = axios.create({
    baseURL: BASE,
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
    validateStatus: () => true
  });

  const batches = (await admin.get("/academics/batches")).data.data as Array<{ _id: string }>;
  const years = (await admin.get("/academics/years")).data.data as Array<{ _id: string; batchId: string }>;
  const batchId = batches[0]!._id;
  const yearId = years.find((year) => year.batchId === batchId)!._id;
  const stamp = Date.now();

  const teacherLoginId = `teacher.${stamp}`;
  const teacherPassword = "Portal123";
  const teacherCreate = await admin.post("/teachers", {
    fullName: "Username Teacher",
    email: teacherLoginId,
    phone: "9800000011",
    password: teacherPassword,
    teacherCode: `UT-${stamp}`,
    qualification: "B.Ed",
    joinedDateBs: "2081-04-01",
    address: {
      province: "Bagmati",
      district: "Kathmandu",
      municipality: "KMC",
      ward: "1",
      streetAddress: "Test St"
    },
    subjects: [],
    assignedBatchIds: [batchId],
    assignedYearIds: [yearId],
    basicSalaryNpr: 50000
  });

  console.log("Teacher create:", teacherCreate.status, teacherCreate.data?.data?.loginEmail);

  const teacherLogin = await login(`  ${teacherLoginId.toUpperCase()}  `, ` ${teacherPassword} `);
  console.log("Teacher login:", teacherLogin.status, teacherLogin.data?.data?.user?.role);

  const studentLoginId = `student.${stamp}`;
  const studentPassword = "Portal456";
  const studentCreate = await admin.post("/students", {
    fullName: "Username Student",
    email: studentLoginId,
    phone: "9800000022",
    password: studentPassword,
    admissionNumber: `ADM-U-${stamp}`,
    rollNumber: Number(String(stamp).slice(-5)),
    batchId,
    yearId,
    admissionDateBs: "2081-04-01",
    dateOfBirthBs: "2060-01-01",
    gender: "Male",
    bloodGroup: "A+",
    disabilityCategory: "None",
    ethnicityCategory: "Other",
    address: {
      province: "Bagmati",
      district: "Kathmandu",
      municipality: "KMC",
      ward: "1",
      streetAddress: "Test St"
    },
    fatherName: "Father Test",
    motherName: "Mother Test",
    guardianName: "Guardian Test",
    guardianPhone: "9800000003",
    feesDueNpr: 0,
    remarks: ""
  });

  console.log("Student create:", studentCreate.status, studentCreate.data?.data?.loginEmail);

  const studentLogin = await login(studentLoginId, studentPassword);
  console.log("Student login:", studentLogin.status, studentLogin.data?.data?.user?.role);
};

run().catch((error) => {
  console.error("Failed:", error.response?.status, JSON.stringify(error.response?.data));
  process.exit(1);
});