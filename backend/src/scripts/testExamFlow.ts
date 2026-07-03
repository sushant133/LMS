import axios, { type AxiosInstance } from "axios";

const BASE = "http://localhost:5000/api";
const PASSWORD = "Demo@123456";

const adminEmail = "admin@demoerp.nepal-school.com";
const teacherEmail = "ram.sharma@demoerp.nepal-school.com";
const studentEmail = "student01@demoerp.nepal-school.com";

type StepResult = { name: string; ok: boolean; detail?: string };

const results: StepResult[] = [];

const pass = (name: string, detail?: string) => {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
};

const fail = (name: string, detail: string) => {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name} — ${detail}`);
};

const login = async (email: string): Promise<AxiosInstance> => {
  const response = await axios.post(`${BASE}/auth/login`, { email, password: PASSWORD }, { withCredentials: true, validateStatus: () => true });
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

const unwrap = <T>(response: { status: number; data: { data?: T; message?: string } }): T => {
  if (response.status >= 400) {
    throw new Error(`${response.status}: ${JSON.stringify(response.data)}`);
  }
  return response.data.data as T;
};

const run = async (): Promise<void> => {
  console.log("\n=== Exams & Results Smoke Test ===\n");

  const admin = await login(adminEmail);
  const teacher = await login(teacherEmail);
  const student = await login(studentEmail);

  // Admin: list exams
  try {
    const exams = unwrap<Array<{ _id: string; name: string; batchIds: string[]; yearIds: string[] }>>(await admin.get("/exams"));
    pass("Admin lists exams", `${exams.length} exam(s)`);

    const batches = unwrap<Array<{ _id: string; name: string }>>(await admin.get("/academics/batches"));
    const years = unwrap<Array<{ _id: string; name: string; batchId: string }>>(await admin.get("/academics/years"));
    const subjects = unwrap<Array<{ _id: string; name: string; yearIds?: string[]; fullMarks: number; passMarks: number }>>(
      await admin.get("/academics/subjects")
    );

    if (batches.length === 0 || years.length === 0) {
      throw new Error("No batches/years in demo data");
    }

    const batchId = batches[0]!._id;
    const yearId = years.find((year) => year.batchId === batchId)?._id ?? years[0]!._id;
    const yearSubject = subjects.find((subject) => (subject.yearIds ?? []).includes(yearId));

    // Create smoke exam
    const examName = `Smoke Test Exam ${Date.now()}`;
    const createdExam = unwrap<{ _id: string; name: string; status: string }>(
      await admin.post("/exams", {
        name: examName,
        academicYearBs: "2083/2084",
        startDateBs: "2083-10-01",
        endDateBs: "2083-10-15",
        resultPublishDateBs: "",
        status: "DRAFT",
        classIds: [],
        batchIds: [batchId],
        yearIds: [yearId]
      })
    );
    pass("Admin creates exam", createdExam.name);

    if (!yearSubject) {
      throw new Error("No subject found for selected year");
    }

    // Create routine
    const routine = unwrap<{ _id: string; subjectId: string }>(
      await admin.post(`/exams/${createdExam._id}/routines`, {
        subjectId: yearSubject._id,
        examDateBs: "2083-10-05",
        day: "Monday",
        startTime: "10:00",
        endTime: "12:00",
        durationMinutes: 120,
        examHall: "Hall A",
        invigilator: "Ram Sharma",
        remarks: "Smoke test routine"
      })
    );
    pass("Admin creates exam routine", `subject ${yearSubject.name}`);

    // Duplicate routine should fail
    const duplicate = await admin.post(`/exams/${createdExam._id}/routines`, {
      subjectId: yearSubject._id,
      examDateBs: "2083-10-06",
      day: "Tuesday",
      startTime: "10:00",
      endTime: "12:00",
      durationMinutes: 120
    });
    if (duplicate.status === 409) {
      pass("Duplicate subject routine blocked", "409 Conflict");
    } else {
      fail("Duplicate subject routine blocked", `Expected 409, got ${duplicate.status}`);
    }

    // Publish routine
    const publishedExam = unwrap<{ routinePublished: boolean; status: string }>(await admin.post(`/exams/${createdExam._id}/routines/publish`));
    if (publishedExam.routinePublished) {
      pass("Admin publishes exam routine", `status=${publishedExam.status}`);
    } else {
      fail("Admin publishes exam routine", "routinePublished is false");
    }

    // Student sees published routine
    const studentRoutinesBefore = unwrap<unknown[]>(await student.get("/exams/routines", { params: { examId: createdExam._id } }));
    if (studentRoutinesBefore.length > 0) {
      pass("Student sees published routine", `${studentRoutinesBefore.length} entry(ies)`);
    } else {
      fail("Student sees published routine", "No routines returned");
    }

    // Teacher sees routine for assigned subject only
    const teacherRoutines = unwrap<Array<{ subjectId: string }>>(await teacher.get("/exams/routines", { params: { examId: createdExam._id } }));
    const teacherScope = unwrap<{ scope: { subjectIds: string[] } }>(await teacher.get("/teacher/scope"));
    const allAssigned = teacherRoutines.every((routine) => teacherScope.scope.subjectIds.includes(routine.subjectId));
    if (allAssigned) {
      pass("Teacher sees scoped routines", `${teacherRoutines.length} entry(ies)`);
    } else {
      fail("Teacher sees scoped routines", "Routine includes unassigned subject");
    }

    // Teacher enters marks for the logged-in student portal user
    const allStudents = unwrap<Array<{ _id: string; batchId?: string; yearId?: string; user: { email: string } }>>(await admin.get("/students"));
    const scopedStudent = allStudents.find((item) => item.user.email === studentEmail && item.batchId === batchId && item.yearId === yearId);
    if (!scopedStudent) {
      throw new Error("Logged-in student is not in teacher scope for marks entry");
    }

    const savedResult = unwrap<{ _id: string; percentage: number; grade: string; passFailStatus: string; marks: Array<{ obtainedMarks: number }> }>(
      await teacher.post("/exams/results", {
        examId: createdExam._id,
        studentId: scopedStudent._id,
        batchId,
        yearId,
        marks: [
          {
            subjectId: yearSubject._id,
            fullMarks: yearSubject.fullMarks,
            passMarks: yearSubject.passMarks,
            theoryMarks: 40,
            practicalMarks: 30,
            internalMarks: 10,
            attendanceStatus: "PRESENT",
            teacherRemarks: "Smoke test marks"
          }
        ]
      })
    );
    if (savedResult.marks[0]!.obtainedMarks === 80) {
      pass("Teacher enters marks with auto-calculation", `${savedResult.percentage}% · ${savedResult.grade} · ${savedResult.passFailStatus}`);
    } else {
      fail("Teacher enters marks with auto-calculation", `Expected obtained 80, got ${savedResult.marks[0]!.obtainedMarks}`);
    }

    // Admin analytics
    const analytics = unwrap<{ resultsEntered: number; passCount: number; subjectPerformance: unknown[] }>(
      await admin.get(`/exams/${createdExam._id}/analytics`)
    );
    if (analytics.resultsEntered >= 1) {
      pass("Admin fetches exam analytics", `${analytics.resultsEntered} result(s), ${analytics.subjectPerformance.length} subject(s)`);
    } else {
      fail("Admin fetches exam analytics", "No results in analytics");
    }

    // Publish results
    const publishedResultsExam = unwrap<{ resultsPublished: boolean; status: string }>(await admin.post(`/exams/${createdExam._id}/results/publish`));
    if (publishedResultsExam.resultsPublished) {
      pass("Admin publishes results", `status=${publishedResultsExam.status}`);
    } else {
      fail("Admin publishes results", "resultsPublished is false");
    }

    // Student sees published results
    const studentResults = unwrap<Array<{ examId: string }>>(await student.get("/exams/results/all"));
    const hasSmokeResult = studentResults.some((result) => result.examId === createdExam._id);
    if (hasSmokeResult) {
      pass("Student sees published results", `${studentResults.length} total result card(s)`);
    } else {
      fail("Student sees published results", "Smoke exam result not visible to student");
    }

    // PDF marksheet
    const pdf = await student.get(`/exams/results/${createdExam._id}/${scopedStudent._id}/marksheet/pdf`, { responseType: "arraybuffer" });
    if (pdf.status === 200 && pdf.headers["content-type"]?.includes("pdf")) {
      pass("Student downloads marksheet PDF", `${(pdf.data as ArrayBuffer).byteLength} bytes`);
    } else {
      fail("Student downloads marksheet PDF", `status=${pdf.status}, type=${pdf.headers["content-type"]}`);
    }

    // Lock results blocks teacher edit
    await admin.post(`/exams/${createdExam._id}/results/lock`);
    const lockedAttempt = await teacher.post("/exams/results", {
      examId: createdExam._id,
      studentId: scopedStudent._id,
      batchId,
      yearId,
      marks: [
        {
          subjectId: yearSubject._id,
          fullMarks: yearSubject.fullMarks,
          passMarks: yearSubject.passMarks,
          theoryMarks: 35,
          practicalMarks: 25,
          internalMarks: 10,
          attendanceStatus: "PRESENT"
        }
      ]
    });
    if (lockedAttempt.status === 403) {
      pass("Locked results block teacher edits", "403 Forbidden");
    } else {
      fail("Locked results block teacher edits", `Expected 403, got ${lockedAttempt.status}`);
    }

    await admin.post(`/exams/${createdExam._id}/results/unlock`);

    // Cleanup smoke exam
    const deleted = await admin.delete(`/exams/${createdExam._id}`);
    if (deleted.status === 200) {
      pass("Admin deletes smoke exam", "cleanup complete");
    } else {
      fail("Admin deletes smoke exam", `status=${deleted.status}`);
    }
  } catch (error) {
    fail("Admin workflow", error instanceof Error ? error.message : String(error));
  }

  // Student should not see results before publish on a fresh unpublished exam - quick check via list exams
  try {
    const studentExams = unwrap<Array<{ _id: string; name: string }>>(await student.get("/exams"));
    pass("Student lists scoped exams", `${studentExams.length} exam(s)`);
  } catch (error) {
    fail("Student lists scoped exams", error instanceof Error ? error.message : String(error));
  }

  console.log("\n=== Summary ===");
  const passed = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok);
  console.log(`${passed}/${results.length} passed`);
  if (failed.length > 0) {
    console.log("\nFailures:");
    for (const item of failed) {
      console.log(`- ${item.name}: ${item.detail}`);
    }
    process.exit(1);
  }
};

run().catch((error) => {
  console.error("Smoke test crashed:", error.response?.data ?? error.message);
  process.exit(1);
});