import axios from "axios";

const BASE = `${process.env.TEST_API_BASE ?? "http://localhost:5000/api"}`;
const ADMIN_EMAIL = "admin@demoerp.nepal-school.com";
const ADMIN_PASSWORD = "Demo@123456";

const login = async (email: string, password: string) => {
  const response = await axios.post(`${BASE}/auth/login`, { email, password }, { withCredentials: true, validateStatus: () => true });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.data)}`);
  }

  const cookieHeader = response.headers["set-cookie"]?.map((value: string) => value.split(";")[0]).join("; ");
  return axios.create({
    baseURL: BASE,
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
    validateStatus: () => true
  });
};

const run = async (): Promise<void> => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const batches = (await admin.get("/academics/batches")).data.data as Array<{ _id: string }>;
  const years = (await admin.get("/academics/years")).data.data as Array<{ _id: string; batchId: string }>;
  const batchId = batches[0]!._id;
  const yearId = years.find((year) => year.batchId === batchId)!._id;
  const stamp = Date.now();

  const teacherEmail = `portal.teacher.${stamp}@demoerp.nepal-school.com`;
  const teacherPassword = "PortalTest123";
  const teacherResponse = await admin.post("/teachers", {
    fullName: "Portal Test Teacher",
    email: teacherEmail,
    phone: "9800000001",
    password: teacherPassword,
    teacherCode: `PT-${stamp}`,
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

  console.log("Teacher create:", teacherResponse.status, JSON.stringify(teacherResponse.data, null, 2));

  const teacherLogin = await axios.post(`${BASE}/auth/login`, { email: teacherEmail, password: teacherPassword }, { validateStatus: () => true });
  console.log("Teacher login:", teacherLogin.status, teacherLogin.data?.data?.user?.role, teacherLogin.data?.data?.redirectTo);

  const studentEmail = `portal.student.${stamp}@demoerp.nepal-school.com`;
  const studentPassword = "PortalTest456";
  const studentResponse = await admin.post("/students", {
    fullName: "Portal Test Student",
    email: studentEmail,
    phone: "9800000002",
    password: studentPassword,
    admissionNumber: `ADM-${stamp}`,
    rollNumber: Number(String(stamp).slice(-4)),
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

  console.log("Student create:", studentResponse.status, JSON.stringify(studentResponse.data, null, 2));

  const studentLogin = await axios.post(`${BASE}/auth/login`, { email: studentEmail, password: studentPassword }, { validateStatus: () => true });
  console.log("Student login:", studentLogin.status, studentLogin.data?.data?.user?.role, studentLogin.data?.data?.redirectTo);
};

run().catch((error) => {
  console.error("Test failed:", error.response?.status, JSON.stringify(error.response?.data));
  console.error(error.message);
  process.exit(1);
});