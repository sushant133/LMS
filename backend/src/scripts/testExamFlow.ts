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

    const teacherScope = unwrap<{
      scope: { subjectIds: string[]; batchIds: string[]; yearIds: string[] };
      subjects: Array<{ _id: string; name: string; yearIds?: string[]; fullMarks: number; passMarks: number }>;
      years: Array<{ _id: string; name: string; batchId: string }>;
      batches: Array<{ _id: string; name: string }>;
      students: Array<{ _id: string; batchId?: string; yearId?: string; user: { email: string } }>;
    }>(await teacher.get("/teacher/scope"));

    if (teacherScope.subjects.length === 0 || teacherScope.years.length === 0) {
      throw new Error("Teacher has no assigned subjects/years in demo data");
    }

    const yearSubject = teacherScope.subjects[0]!;
    const yearId = (yearSubject.yearIds ?? []).find((linkedYearId) => teacherScope.scope.yearIds.includes(linkedYearId));
    if (!yearId) {
      throw new Error("No matching year for teacher subject");
    }

    const yearWithSubject = teacherScope.years.find((year) => year._id === yearId);
    if (!yearWithSubject) {
      throw new Error("Year record not found for teacher subject");
    }

    const batchId = yearWithSubject.batchId;

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
    const allAssigned = teacherRoutines.every((routine) => teacherScope.scope.subjectIds.includes(routine.subjectId));
    if (allAssigned) {
      pass("Teacher sees scoped routines", `${teacherRoutines.length} entry(ies)`);
    } else {
      fail("Teacher sees scoped routines", "Routine includes unassigned subject");
    }

    // Teacher enters marks for the logged-in student portal user
    const scopedStudents = teacherScope.students.filter((item) => item.batchId === batchId && item.yearId === yearId);
    const scopedStudent = scopedStudents.find((item) => item.user.email === studentEmail) ?? scopedStudents[0];
    if (!scopedStudent) {
      throw new Error("No students in teacher scope for marks entry");
    }
    if (scopedStudents.length === 0) {
      throw new Error("No students in selected batch/year");
    }

    let savedResult: { _id: string; percentage: number; grade: string; passFailStatus: string; marks: Array<{ obtainedMarks: number }> } | null = null;
    for (const targetStudent of scopedStudents) {
      savedResult = unwrap(
        await teacher.post("/exams/results", {
          examId: createdExam._id,
          studentId: targetStudent._id,
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
    }
    if (savedResult && savedResult.marks[0]!.obtainedMarks === 80) {
      pass("Teacher enters marks with auto-calculation", `${scopedStudents.length} student(s) · ${savedResult.percentage}% · ${savedResult.grade}`);
    } else {
      fail("Teacher enters marks with auto-calculation", `Expected obtained 80, got ${savedResult?.marks[0]?.obtainedMarks}`);
    }

    // Teacher cannot publish results
    const teacherPublishAttempt = await teacher.post(`/exams/${createdExam._id}/results/publish`);
    if (teacherPublishAttempt.status === 403) {
      pass("Teacher blocked from publishing results", "403 Forbidden");
    } else {
      fail("Teacher blocked from publishing results", `Expected 403, got ${teacherPublishAttempt.status}`);
    }

    // Submit for review
    const submitted = unwrap<{ _id: string; status: string }>(
      await teacher.post("/exams/result-submissions/submit", {
        examId: createdExam._id,
        subjectId: yearSubject._id,
        batchId,
        yearId
      })
    );
    if (submitted.status === "PENDING_ADMIN_REVIEW") {
      pass("Teacher submits results for review", `submission=${submitted._id}`);
    } else {
      fail("Teacher submits results for review", `Expected PENDING_ADMIN_REVIEW, got ${submitted.status}`);
    }

    // Teacher cannot edit after submit
    const editAfterSubmit = await teacher.post("/exams/results", {
      examId: createdExam._id,
      studentId: scopedStudent._id,
      batchId,
      yearId,
      marks: [
        {
          subjectId: yearSubject._id,
          fullMarks: yearSubject.fullMarks,
          passMarks: yearSubject.passMarks,
          theoryMarks: 30,
          practicalMarks: 20,
          internalMarks: 10,
          attendanceStatus: "PRESENT"
        }
      ]
    });
    if (editAfterSubmit.status === 403) {
      pass("Submitted results block teacher edits", "403 Forbidden");
    } else {
      fail("Submitted results block teacher edits", `Expected 403, got ${editAfterSubmit.status}`);
    }

    // Publish without approval should fail
    const prematurePublish = await admin.post(`/exams/${createdExam._id}/results/publish`);
    if (prematurePublish.status === 400) {
      pass("Publish blocked until submissions approved", "400 Bad Request");
    } else {
      fail("Publish blocked until submissions approved", `Expected 400, got ${prematurePublish.status}`);
    }

    // Admin approves submission
    const approved = unwrap<{ status: string }>(await admin.post(`/exams/result-submissions/${submitted._id}/approve`, { comments: "Looks good" }));
    if (approved.status === "APPROVED") {
      pass("Admin approves result submission", approved.status);
    } else {
      fail("Admin approves result submission", `Expected APPROVED, got ${approved.status}`);
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

    // Audit log available
    const auditLog = unwrap<unknown[]>(
      await admin.get("/exams/result-submissions/audit-log", { params: { examId: createdExam._id } })
    );
    if (auditLog.length > 0) {
      pass("Admin views result audit log", `${auditLog.length} entry(ies)`);
    } else {
      fail("Admin views result audit log", "No audit entries");
    }

    // Publish results after approval
    const publishedResultsExam = unwrap<{ resultsPublished: boolean; resultsLocked: boolean; status: string }>(
      await admin.post(`/exams/${createdExam._id}/results/publish`)
    );
    if (publishedResultsExam.resultsPublished && publishedResultsExam.resultsLocked) {
      pass("Admin publishes results", `status=${publishedResultsExam.status}, locked=true`);
    } else {
      fail("Admin publishes results", "resultsPublished or resultsLocked is false");
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