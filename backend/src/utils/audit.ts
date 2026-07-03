import type { Request } from "express";
import { AuditLog } from "../models/AuditLog.js";
import { tenantObjectId } from "./tenant.js";

interface AuditParams {
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Records an audit log entry. Always tenant-scoped.
 * Call this after successful mutations for IEMIS compliance and accountability.
 */
export async function recordAudit(req: Request, params: AuditParams): Promise<void> {
  try {
    const schoolId = tenantObjectId(req);
    const actor = req.user;

    if (!actor) return;

    await AuditLog.create({
      schoolId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      before: params.before ?? null,
      after: params.after ?? null,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || ""
    });
  } catch (error) {
    // Never break business logic because of audit failure
    console.error("Audit logging failed:", error);
  }
}
