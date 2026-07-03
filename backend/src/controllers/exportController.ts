import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/response.js";
import {
  generateStudentMasterExport,
  generateTeacherMasterExport,
  generateInfrastructureExport,
  generateFlashIIPerformance,
  toCsv
} from "../utils/iemisExport.js";
import { recordAudit } from "../utils/audit.js";

/**
 * Expanded IEMIS Export Controller
 * Now includes Teacher, Infrastructure, and improved Flash II data.
 */

export const exportStudentMasterCsv = asyncHandler(async (req: Request, res: Response) => {
  const rows = await generateStudentMasterExport(req);

  await recordAudit(req, {
    action: "export.iemis.student-master",
    entity: "Export",
    entityId: "student-master",
    after: { count: rows.length }
  });

  const csv = toCsv(rows);
  const filename = `iemis_student_master_${Date.now()}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\uFEFF" + csv);
});

export const exportTeacherMasterCsv = asyncHandler(async (req: Request, res: Response) => {
  const rows = await generateTeacherMasterExport(req);

  await recordAudit(req, {
    action: "export.iemis.teacher-master",
    entity: "Export",
    entityId: "teacher-master",
    after: { count: rows.length }
  });

  const csv = toCsv(rows);
  const filename = `iemis_teacher_master_${Date.now()}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\uFEFF" + csv);
});

export const exportInfrastructure = asyncHandler(async (req: Request, res: Response) => {
  const infra = await generateInfrastructureExport(req);

  await recordAudit(req, {
    action: "export.iemis.infrastructure",
    entity: "Export",
    entityId: "infrastructure"
  });

  const format = (req.query.format as string || "json").toLowerCase();

  if (format === "csv") {
    const csv = toCsv([infra]);
    const filename = `iemis_infrastructure_${Date.now()}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send("\uFEFF" + csv);
  }

  return sendSuccess(res, "IEMIS Infrastructure data", infra);
});

export const exportFlashII = asyncHandler(async (req: Request, res: Response) => {
  const performance = await generateFlashIIPerformance(req);

  await recordAudit(req, {
    action: "export.iemis.flash-ii",
    entity: "Export",
    entityId: "flash-ii-performance"
  });

  const format = (req.query.format as string || "json").toLowerCase();

  if (format === "csv") {
    const flat = Object.entries(performance).map(([key, value]) => ({ metric: key, value }));
    const csv = toCsv(flat);
    const filename = `iemis_flash_ii_performance_${Date.now()}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send("\uFEFF" + csv);
  }

  return sendSuccess(res, "IEMIS Flash II Performance Indicators", performance);
});

export const exportEnrollmentSummary = asyncHandler(async (req: Request, res: Response) => {
  // Keep the original enrollment summary for backward compatibility
  const { generateEnrollmentSummary } = await import("../utils/iemisExport.js");
  const summary = await generateEnrollmentSummary(req);

  await recordAudit(req, {
    action: "export.iemis.enrollment-summary",
    entity: "Export",
    entityId: "enrollment-summary"
  });

  const format = (req.query.format as string || "json").toLowerCase();

  if (format === "csv") {
    const flat = [
      { metric: "Total Students", value: summary.totalStudents },
      ...Object.entries(summary.byGender).map(([k, v]) => ({ metric: `Gender - ${k}`, value: v })),
      ...summary.byClass.map((c: any) => ({ metric: `Class - ${c.className}`, value: c.count })),
      ...summary.byDisability.map((d: any) => ({ metric: `Disability - ${d.category}`, value: d.count })),
      ...summary.byEthnicity.map((e: any) => ({ metric: `Ethnicity - ${e.category}`, value: e.count }))
    ];
    const csv = toCsv(flat);
    const filename = `iemis_enrollment_summary_${Date.now()}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send("\uFEFF" + csv);
  }

  return sendSuccess(res, "IEMIS Enrollment Summary", summary);
});
