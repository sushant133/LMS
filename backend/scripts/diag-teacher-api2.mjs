import "dotenv/config";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { env } from "../src/config/env.ts";

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

const teacher = await db.collection("teachers").findOne({
  _id: new mongoose.Types.ObjectId("6a55346348ea9b4989f7d3b0"),
});
const user = await db.collection("users").findOne({ _id: teacher.user });

const token = jwt.sign(
  {
    userId: String(user._id),
    role: user.role,
    email: user.email,
    schoolId: String(user.schoolId),
  },
  env.JWT_SECRET,
  { algorithm: "HS256", expiresIn: "1h" },
);

const base = `http://localhost:${env.PORT || 5000}`;
const cookieName = env.COOKIE_NAME || "token";
const headers = {
  Cookie: `${cookieName}=${token}`,
  "Content-Type": "application/json",
};

console.log("cookie", cookieName, "user", user.email);

for (const path of [
  "/api/teacher/scope",
  "/api/academic-management/syllabi?academicYearBs=2083%2F2084&session=2083%2F2084",
  "/api/academic-management/syllabi?academicYearBs=2083%2F2084",
  "/api/academics/subjects",
]) {
  const res = await fetch(`${base}${path}`, { headers });
  const body = await res.json().catch(() => ({}));
  const data = body?.data ?? body;
  console.log("\n===", path, res.status, body?.message);
  if (Array.isArray(data)) {
    console.log(
      "array",
      data.length,
      data.map((x) => ({
        id: x._id,
        subjectId: x.subjectId,
        name: x.name || x.subject?.name,
        yearId: x.yearId,
        status: x.status,
      })),
    );
  } else if (data?.scope) {
    console.log({
      subjectIds: data.scope.subjectIds,
      yearIds: data.scope.yearIds,
      subjects: (data.subjects || []).map((s) => ({ id: s._id, name: s.name, code: s.code })),
      years: (data.years || []).map((y) => ({ id: y._id, name: y.name, level: y.level })),
    });
  } else {
    console.log(JSON.stringify(body).slice(0, 500));
  }
}

await mongoose.disconnect();
