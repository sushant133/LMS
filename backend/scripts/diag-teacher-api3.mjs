import "dotenv/config";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

const teacher = await db.collection("teachers").findOne({
  _id: new mongoose.Types.ObjectId("6a55346348ea9b4989f7d3b0"),
});
const user = await db.collection("users").findOne({ _id: teacher.user });

const secret = process.env.JWT_SECRET;
const cookieName = process.env.COOKIE_NAME || "phit_erp_token";
const port = process.env.PORT || 5000;

const token = jwt.sign(
  {
    userId: String(user._id),
    role: user.role,
    email: user.email,
    schoolId: String(user.schoolId),
  },
  secret,
  { algorithm: "HS256", expiresIn: "1h" },
);

const base = `http://localhost:${port}`;
const headers = {
  Cookie: `${cookieName}=${token}`,
  "Content-Type": "application/json",
};

console.log({ cookieName, port, email: user.email });

// try alternate cookie names if needed
const cookieNames = [cookieName, "token", "accessToken", "phit_token", "auth_token"];

async function tryGet(path, cookie) {
  const res = await fetch(`${base}${path}`, {
    headers: { Cookie: `${cookie}=${token}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// discover cookie name
let workingCookie = null;
for (const c of cookieNames) {
  const r = await tryGet("/api/auth/me", c);
  console.log("auth/me with", c, r.status, r.body?.message || r.body?.success);
  if (r.status === 200) {
    workingCookie = c;
    break;
  }
}

if (!workingCookie) {
  // dump env cookie from config by reading file
  console.log("COOKIE_NAME env", process.env.COOKIE_NAME);
  process.exit(1);
}

const headers2 = {
  Cookie: `${workingCookie}=${token}`,
  "Content-Type": "application/json",
};

for (const path of [
  "/api/teacher/scope",
  "/api/academic-management/syllabi?academicYearBs=2083%2F2084&session=2083%2F2084",
  "/api/academic-management/syllabi?academicYearBs=2083%2F2084",
  "/api/academics/subjects",
]) {
  const res = await fetch(`${base}${path}`, { headers: headers2 });
  const body = await res.json().catch(() => ({}));
  const data = body?.data ?? body;
  console.log("\n===", path, res.status, body?.message);
  if (Array.isArray(data)) {
    console.log(
      "array",
      data.length,
      JSON.stringify(
        data.map((x) => ({
          id: x._id,
          subjectId: x.subjectId,
          name: x.name || x.subject?.name,
          yearId: x.yearId,
          status: x.status,
          master: x.subject?.masterSubjectId,
        })),
        null,
        2,
      ),
    );
  } else if (data?.scope) {
    console.log(
      JSON.stringify(
        {
          subjectIds: data.scope.subjectIds,
          yearIds: data.scope.yearIds,
          subjects: (data.subjects || []).map((s) => ({
            id: s._id,
            name: s.name,
            code: s.code,
            master: s.masterSubjectId,
          })),
          years: (data.years || []).map((y) => ({ id: y._id, name: y.name, level: y.level })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(JSON.stringify(body).slice(0, 800));
  }
}

await mongoose.disconnect();
