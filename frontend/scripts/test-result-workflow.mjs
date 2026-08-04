/**
 * Functional test for the Result Management workflow:
 * 1. Partial publish (publish approved subjects without waiting for all)
 * 2. Unapprove / return approved result back to teacher
 * 3. Delete entire result (subject/class) with confirmation
 *
 * Run: node frontend/scripts/test-result-workflow.mjs
 */
const BASE = "http://localhost:5000/api";

let cookie = "";

async function apiCall(method, path, body, expectedStatus) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });

  // Capture all set-cookie headers from login (contains auth token + active school)
  const setCookieHeaders = res.headers.getSetCookie();
  if (setCookieHeaders.length > 0) {
    cookie = setCookieHeaders.map((c) => c.split(";")[0]).join("; ");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  const status = res.status;
  const ok = expectedStatus ? status === expectedStatus : status >= 200 && status < 300;

  console.log(
    `${ok ? "✅" : "❌"} ${method} ${path} → ${status}${expectedStatus ? ` (expected ${expectedStatus})` : ""}`
  );

  if (!ok) {
    console.log(`   Response: ${JSON.stringify(data)?.slice(0, 500)}`);
  }

  return { status, data, ok };
}

async function login(email, password) {
  const result = await apiCall("POST", "/auth/login", { email, password }, 200);
  if (!result.ok) {
    console.error(`Login failed for ${email}`);
    process.exit(1);
  }
  return result.data.data;
}

async function main() {
  console.log("=".repeat(70));
  console.log("RESULT MANAGEMENT WORKFLOW — FUNCTIONAL TEST");
  console.log("=".repeat(70));

  // 1. Login as Super Admin
  console.log("\n--- 1. AUTHENTICATION ---");
  const admin = await login("superadmin@nepal-school.com", "Admin@123456");
  console.log(`   Logged in as: ${admin.user.fullName} (${admin.user.role})`);
  console.log(`   Active school: ${admin.activeSchoolId}`);

  // 2. List exams
  console.log("\n--- 2. LIST EXAMS ---");
  const examsRes = await apiCall("GET", "/exams");
  if (!examsRes.ok) {
    console.error("Failed to list exams");
    process.exit(1);
  }
  const exams = examsRes.data.data;
  console.log(`   Found ${exams.length} exam(s)`);
  exams.forEach((exam) => {
    console.log(
      `   - ${exam._id}: ${exam.name} (status: ${exam.status}, resultsPublished: ${exam.resultsPublished}, resultsLocked: ${exam.resultsLocked})`
    );
  });

  if (exams.length === 0) {
    console.error("No exams found. Seed demo data first.");
    process.exit(1);
  }

  const exam = exams[0];
  const examId = exam._id;

  // 3. List result submissions for the exam
  console.log("\n--- 3. LIST RESULT SUBMISSIONS ---");
  const subsRes = await apiCall("GET", `/exams/result-submissions?examId=${examId}`);
  const submissions = subsRes.ok ? subsRes.data.data : [];
  console.log(`   Found ${submissions.length} submission(s) for exam "${exam.name}"`);
  submissions.forEach((sub) => {
    console.log(
      `   - ${sub._id}: ${sub.scopeLabel} [${sub.status}] marks: ${sub.marksEntered}/${sub.studentsTotal}`
    );
  });

  // 4. Test partial publish — publish approved subjects only
  console.log("\n--- 4. PARTIAL PUBLISH (publish approved subjects) ---");
  const approvedSubs = submissions.filter((s) => s.status === "APPROVED");
  const publishedSubs = submissions.filter((s) => s.status === "PUBLISHED");

  if (approvedSubs.length > 0) {
    console.log(`   Found ${approvedSubs.length} approved submission(s) ready to publish`);
    const pubRes = await apiCall("POST", `/exams/${examId}/results/publish`, {}, 200);
    if (pubRes.ok) {
      console.log(`   ✅ Partial publish succeeded: ${JSON.stringify(pubRes.data.data)?.slice(0, 300)}`);
    }
  } else if (publishedSubs.length > 0) {
    console.log(`   ${publishedSubs.length} submission(s) already published — partial publish already verified`);
  } else {
    console.log("   ⚠️ No approved submissions to publish. Checking if any are pending review...");
    const pendingSubs = submissions.filter((s) => s.status === "PENDING_ADMIN_REVIEW" || s.status === "SUBMITTED_FOR_REVIEW");
    if (pendingSubs.length > 0) {
      console.log(`   Found ${pendingSubs.length} pending submission(s). Approving one to test partial publish...`);
      const target = pendingSubs[0];
      const approveRes = await apiCall(
        "POST",
        `/exams/result-submissions/${target._id}/approve`,
        { comments: "Approved for partial publish test" },
        200
      );
      if (approveRes.ok) {
        console.log(`   ✅ Approved submission: ${target.scopeLabel}`);
        const pubRes = await apiCall("POST", `/exams/${examId}/results/publish`, {}, 200);
        if (pubRes.ok) {
          console.log(`   ✅ Partial publish succeeded after approving one subject`);
        }
      }
    } else {
      console.log("   ⚠️ No pending or approved submissions. Cannot test partial publish without data.");
    }
  }

  // 5. Test unapprove / return workflow
  console.log("\n--- 5. UNAPPROVE / RETURN TO TEACHER ---");
  const subsAfterPublish = await apiCall("GET", `/exams/result-submissions?examId=${examId}`);
  const currentSubs = subsAfterPublish.ok ? subsAfterPublish.data.data : submissions;

  const approvedOrPublished = currentSubs.find(
    (s) => s.status === "APPROVED" || s.status === "PUBLISHED"
  );

  if (approvedOrPublished) {
    console.log(`   Found ${approvedOrPublished.status} submission: ${approvedOrPublished.scopeLabel}`);
    const unapproveRes = await apiCall(
      "POST",
      `/exams/result-submissions/${approvedOrPublished._id}/unapprove`,
      { comments: "Please correct the marks for student 3 — theory marks look incorrect." },
      200
    );
    if (unapproveRes.ok) {
      console.log(`   ✅ Unapprove succeeded. Status should now be RETURNED_FOR_CORRECTION`);
      console.log(`   Response: ${JSON.stringify(unapproveRes.data.data)?.slice(0, 300)}`);
    }
  } else {
    console.log("   ⚠️ No approved/published submission found to test unapprove.");
  }

  // 6. Test delete with confirmation
  console.log("\n--- 6. DELETE SUBJECT RESULTS (with confirmation) ---");
  const subsAfterUnapprove = await apiCall("GET", `/exams/result-submissions?examId=${examId}`);
  const subsForDelete = subsAfterUnapprove.ok ? subsAfterUnapprove.data.data : currentSubs;

  const deleteTarget = subsForDelete.find(
    (s) => s.status === "RETURNED_FOR_CORRECTION" || s.status === "DRAFT" || s.status === "PENDING_ADMIN_REVIEW"
  );

  if (deleteTarget) {
    console.log(`   Target: ${deleteTarget.scopeLabel} [${deleteTarget.status}]`);

    // 6a. Test without confirmation — should fail (400)
    console.log("\n   --- 6a. Delete WITHOUT confirmation (should fail) ---");
    const noConfirmRes = await apiCall(
      "POST",
      `/exams/result-submissions/${deleteTarget._id}/delete`,
      {},
      400
    );
    if (noConfirmRes.status === 400) {
      console.log("   ✅ Delete without confirmation correctly rejected (400)");
    } else {
      console.log("   ❌ Delete without confirmation should have been rejected with 400!");
    }

    // 6b. Test with wrong confirmation — should fail (400)
    console.log("\n   --- 6b. Delete with WRONG confirmation (should fail) ---");
    const wrongConfirmRes = await apiCall(
      "POST",
      `/exams/result-submissions/${deleteTarget._id}/delete`,
      { confirm: "YES" },
      400
    );
    if (wrongConfirmRes.status === 400) {
      console.log("   ✅ Delete with wrong confirmation correctly rejected (400)");
    } else {
      console.log("   ❌ Delete with wrong confirmation should have been rejected with 400!");
    }

    // 6c. Test with correct confirmation — should succeed
    console.log("\n   --- 6c. Delete with CORRECT confirmation (should succeed) ---");
    const correctConfirmRes = await apiCall(
      "POST",
      `/exams/result-submissions/${deleteTarget._id}/delete`,
      { confirm: "DELETE" },
      200
    );
    if (correctConfirmRes.ok) {
      console.log(`   ✅ Delete succeeded: ${JSON.stringify(correctConfirmRes.data.data)?.slice(0, 300)}`);
    }
  } else {
    console.log("   ⚠️ No suitable submission found to test delete.");
  }

  // 7. Verify audit log entries
  console.log("\n--- 7. AUDIT LOG VERIFICATION ---");
  const auditRes = await apiCall("GET", `/exams/result-submissions/audit-log?examId=${examId}`);
  if (auditRes.ok) {
    const logs = auditRes.data.data;
    console.log(`   Found ${logs.length} audit entries`);
    logs.slice(0, 10).forEach((log) => {
      console.log(`   - [${log.action}] ${log.actorRole} @ ${log.createdAt ? new Date(log.createdAt).toLocaleString() : "?"}`);
    });
  }

  // 8. Verify teacher can re-enter marks after delete
  console.log("\n--- 8. TEACHER RE-ENTRY AFTER DELETE ---");
  console.log("   (Verifying submission is gone — teacher must create a new one)");
  const finalSubs = await apiCall("GET", `/exams/result-submissions?examId=${examId}`);
  if (finalSubs.ok) {
    const remaining = finalSubs.data.data;
    const deletedStillExists = remaining.some((s) => s._id === deleteTarget?._id);
    if (deletedStillExists) {
      console.log("   ❌ Deleted submission still exists!");
    } else {
      console.log("   ✅ Deleted submission no longer exists in the list");
    }
    console.log(`   Remaining submissions: ${remaining.length}`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("TEST COMPLETE");
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
