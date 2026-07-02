import axios from "axios";

const run = async (): Promise<void> => {
  const login = await axios.post(
    "http://localhost:5173/api/auth/login",
    { email: "student01@demoerp.nepal-school.com", password: "Demo@123456" },
    { withCredentials: true, validateStatus: () => true }
  );

  console.log("proxy login status:", login.status, login.data?.message);
  const cookieHeader = login.headers["set-cookie"]?.map((value: string) => value.split(";")[0]).join("; ");
  console.log("proxy cookies:", cookieHeader ?? "NONE");

  if (!cookieHeader) {
    process.exit(1);
  }

  const me = await axios.get("http://localhost:5173/api/auth/me", {
    headers: { Cookie: cookieHeader },
    validateStatus: () => true
  });
  console.log("proxy me status:", me.status, me.data?.data?.user?.role);
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});