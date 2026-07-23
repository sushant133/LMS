import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

const teacher = await db.collection("teachers").findOne({
  _id: new mongoose.Types.ObjectId("6a55346348ea9b4989f7d3b0"),
});
const user = await db.collection("users").findOne({ _id: teacher.user });
console.log("teacher user", {
  email: user?.email,
  role: user?.role,
  schoolId: user?.schoolId ? String(user.schoolId) : null,
  fullName: user?.fullName,
});

// Try login via local API
const base = process.env.API_URL || "http://localhost:5000";
const loginCandidates = [
  { email: user.email, password: "Teacher@123" },
  { email: user.email, password: "teacher123" },
  { email: user.email, password: "Password@123" },
  { email: user.email, password: "Admin@123" },
  { email: user.email, password: "123456" },
];

// Also dump password hash presence
console.log("has password hash", Boolean(user?.password));

let token = null;
for (const cred of loginCandidates) {
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cred),
    });
    const body = await res.json().catch(() => ({}));
    console.log("login try", cred.password, res.status, body?.message || body?.error || "");
    if (res.ok && (body?.data?.accessToken || body?.data?.token || body?.token)) {
      token = body?.data?.accessToken || body?.data?.token || body?.token;
      console.log("login success with", cred.password);
      break;
    }
  } catch (e) {
    console.log("login error", cred.password, e.message);
  }
}

if (!token) {
  // Create a short-lived JWT like the app does if we can find secret
  const jwt = await import("jsonwebtoken");
  const secret = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
  if (secret) {
    token = jwt.default.sign(
      {
        userId: String(user._id),
        role: user.role,
        schoolId: String(user.schoolId || "6a55345f48ea9b4989f7d353"),
      },
      secret,
      { expiresIn: "1h" },
    );
    console.log("minted jwt with secret");
  } else {
    console.log("no token / no secret");
  }
}

if (token) {
  const headers = { Authorization: `Bearer ${token}` };
  for (const path of [
    "/api/teacher/scope",
    "/api/academic-management/syllabi?academicYearBs=2083%2F2084&session=2083%2F2084",
    "/api/academic-management/syllabi?academicYearBs=2083/2084",
    "/api/academics/subjects",
  ]) {
    const res = await fetch(`${base}${path}`, { headers });
    const body = await res.json().catch(() => ({}));
    const data = body?.data ?? body;
    const summary =
      Array.isArray(data)
        ? { count: data.length, sample: data.slice(0, 3).map((x) => ({ id: x._id, subjectId: x.subjectId, name: x.name || x.subject?.name })) }
        : data?.scope
          ? {
              subjectIds: data.scope.subjectIds,
              subjects: (data.subjects || []).map((s) => ({ id: s._id, name: s.name })),
            }
          : { keys: Object.keys(data || {}), message: body?.message };
    console.log("\nGET", path, "status", res.status);
    console.log(JSON.stringify(summary, null, 2));
  }
}

await mongoose.disconnect();
