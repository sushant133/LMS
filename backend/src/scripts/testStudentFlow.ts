import axios from "axios";

const run = async (): Promise<void> => {
  const login = await axios.post(
    "http://localhost:5000/api/auth/login",
    { email: "student01@demoerp.nepal-school.com", password: "Demo@123456" },
    { withCredentials: true }
  );

  const cookieHeader = login.headers["set-cookie"]?.map((value: string) => value.split(";")[0]).join("; ");
  console.log("cookies:", cookieHeader);

  const authHeaders = cookieHeader ? { Cookie: cookieHeader } : undefined;
  const me = await axios.get("http://localhost:5000/api/auth/me", { headers: authHeaders });
  console.log("me:", me.data.data.user.role);

  const dashboard = await axios.get("http://localhost:5000/api/dashboard", { headers: authHeaders });
  console.log("dashboard stats:", dashboard.data.data.stats.length);

  const subjects = await axios.get("http://localhost:5000/api/student/subjects", { headers: authHeaders });
  console.log("subjects:", subjects.data.data.length);
};

run().catch((error) => {
  console.error("flow failed:", error.response?.status, error.response?.data ?? error.message);
  process.exit(1);
});