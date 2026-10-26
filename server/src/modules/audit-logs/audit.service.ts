import mongoose from "mongoose";
import { makeSchema, ObjectId } from "../../database/index.js";
import { logger } from "../../config/logger.js";
import type { Request } from "express";

const auditSchema = makeSchema(
  {
    actorId: { type: ObjectId, ref: "User", index: true },
    actorRole: String,
    action: { type: String, required: true, index: true },
    targetType: { type: String, index: true },
    targetId: { type: String, index: true },
    metadata: { type: Object, default: {} },
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ createdAt: -1 });
export const AuditLog = mongoose.model<any>("AuditLog", auditSchema);

const SENSITIVE = /password|token|secret|hash|authorization/i;
function scrub(v: any, depth = 0): any {
  if (v == null || depth > 4) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, depth + 1));
  if (typeof v === "object" && !(v instanceof Date) && !(v as any)._bsontype) {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        SENSITIVE.test(k) ? "[redacted]" : scrub(x, depth + 1),
      ]),
    );
  }
  return v;
}

export interface AuditActor {
  userId?: string;
  role?: string;
}

/** Fire-and-record audit entry; failures are logged but never break the business operation. */
export async function audit(
  actor: AuditActor | undefined,
  action: string,
  targetType?: string,
  targetId?: unknown,
  metadata: Record<string, unknown> = {},
  req?: Request,
) {
  try {
    await AuditLog.create({
      actorId: actor?.userId,
      actorRole: actor?.role,
      action,
      targetType,
      targetId: targetId == null ? undefined : String(targetId),
      metadata: scrub(metadata),
      ip: req?.ip,
    });
  } catch (err) {
    logger.error({ err, action }, "audit log write failed");
  }
}
