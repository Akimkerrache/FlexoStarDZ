import crypto from "node:crypto";
import path from "node:path";
import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { can, isStaff, type AuthContext } from "../../config/permissions.js";
import { ApiError } from "../../utils/http.js";
import { audit } from "../audit-logs/audit.service.js";
import { Order } from "../orders/order.model.js";
import { FINAL_STATUSES } from "../orders/order.rules.js";
import { FileAsset } from "./file.model.js";
import { getStorage, type StoredPart } from "./storage.js";

const MiB = 1024 * 1024;
const MIN_PART = 5 * MiB; // R2/S3 minimum for all but the last part
const MAX_PARTS = 10_000;

const DEFAULT_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/gif",
  "image/webp",
  "image/vnd.adobe.photoshop",
  "application/x-photoshop",
  "application/postscript",
  "application/illustrator",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.corel-draw",
  "application/octet-stream",
];
const ALLOWED_EXT = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "tif",
  "tiff",
  "gif",
  "webp",
  "psd",
  "ai",
  "eps",
  "cdr",
  "indd",
  "zip",
  "rar",
  "7z",
  "txt",
  "csv",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "dxf",
];
const BLOCKED_EXT = [
  "exe",
  "bat",
  "cmd",
  "com",
  "msi",
  "scr",
  "dll",
  "sh",
  "js",
  "mjs",
  "jar",
  "ps1",
  "vbs",
  "apk",
  "app",
  "dmg",
  "html",
  "htm",
  "svg",
  "php",
];

const allowedMime = () =>
  env.ALLOWED_UPLOAD_MIME_TYPES
    ? env.ALLOWED_UPLOAD_MIME_TYPES.split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : DEFAULT_MIME;

export function sanitizeFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/"));
  const printable = [...base.normalize("NFKC")].filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127).join("");
  const cleaned = printable
    .replace(/[<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const ext = path.extname(cleaned);
  const stem = cleaned
    .slice(0, cleaned.length - ext.length)
    .slice(0, 150 - ext.length);
  return stem + ext || "file";
}

export function validateUpload(
  name: string,
  mimeType: string,
  sizeBytes: number,
) {
  const ext = path.extname(name).slice(1).toLowerCase();
  const mime = mimeType.toLowerCase();
  if (BLOCKED_EXT.includes(ext) || !ALLOWED_EXT.includes(ext))
    throw ApiError.unprocessable(
      `File type ".${ext}" is not allowed`,
      "FILE_TYPE_NOT_ALLOWED",
    );
  if (!allowedMime().includes(mime))
    throw ApiError.unprocessable(
      `MIME type "${mimeType}" is not allowed`,
      "FILE_TYPE_NOT_ALLOWED",
    );
  if (mime === "application/octet-stream" && !ALLOWED_EXT.includes(ext))
    throw ApiError.unprocessable("Unknown file type", "FILE_TYPE_NOT_ALLOWED");
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0)
    throw ApiError.unprocessable("Invalid file size", "FILE_SIZE_INVALID");
  if (sizeBytes > env.MAX_UPLOAD_SIZE_MB * MiB)
    throw ApiError.unprocessable(
      `File exceeds the maximum size of ${env.MAX_UPLOAD_SIZE_MB} MB`,
      "FILE_TOO_LARGE",
    );
  return { ext };
}

export function planUpload(sizeBytes: number) {
  if (sizeBytes <= env.MAX_SINGLE_UPLOAD_SIZE_MB * MiB)
    return { mode: "single" as const };
  const partSizeBytes = Math.max(
    env.R2_MULTIPART_PART_SIZE_MB * MiB,
    MIN_PART,
    Math.ceil(sizeBytes / MAX_PARTS),
  );
  return {
    mode: "multipart" as const,
    partSizeBytes,
    partCount: Math.ceil(sizeBytes / partSizeBytes),
  };
}

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  pdf: (b) => b.subarray(0, 4).toString("latin1") === "%PDF",
  png: (b) => b.subarray(1, 4).toString("latin1") === "PNG",
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
  zip: (b) => b[0] === 0x50 && b[1] === 0x4b,
  gif: (b) => b.subarray(0, 3).toString("latin1") === "GIF",
  psd: (b) => b.subarray(0, 4).toString("latin1") === "8BPS",
};
export const sniffMatches = (ext: string, head: Buffer) =>
  MAGIC[ext] ? MAGIC[ext](head) : true;

const lazy = (n: string) => mongoose.model<any>(n);

type TargetInput = {
  orderId?: string;
  plateId?: string;
  invoiceId?: string;
  deliveryId?: string;
  clientId?: string;
};

/** Resolves and authorizes the entity a file will belong to. Never trusts a client-supplied clientId. */
export async function resolveTarget(a: AuthContext, t: TargetInput) {
  if (a.role === "printer")
    throw ApiError.forbidden("Printer accounts cannot upload files");
  let clientId: string | undefined;
  if (a.role === "client") {
    if (!a.clientId) throw ApiError.forbidden();
    if (t.plateId || t.invoiceId || t.deliveryId) throw ApiError.forbidden();
    clientId = a.clientId;
    if (t.orderId) {
      const o = await Order.findOne({ _id: t.orderId, clientId }).select(
        "status",
      );
      if (!o) throw ApiError.notFound("Order not found");
      if (FINAL_STATUSES.includes(o.status as any))
        throw ApiError.unprocessable("This order is closed", "ORDER_CLOSED");
    }
    return { clientId };
  }
  if (t.orderId) {
    if (!can(a, "orders.edit")) throw ApiError.forbidden();
    const o = await Order.findById(t.orderId).select("clientId");
    if (!o) throw ApiError.notFound("Order not found");
    clientId = String(o.clientId);
  } else if (t.plateId) {
    if (!can(a, "plates.manage")) throw ApiError.forbidden();
    const p = await lazy("PhotopolymerPlate")
      .findById(t.plateId)
      .select("clientId");
    if (!p) throw ApiError.notFound("Plate not found");
    clientId = String((p as any).clientId);
  } else if (t.invoiceId) {
    if (!can(a, "finance.manage")) throw ApiError.forbidden();
    const i = await lazy("Invoice").findById(t.invoiceId).select("clientId");
    if (!i) throw ApiError.notFound("Invoice not found");
    clientId = (i as any).clientId ? String((i as any).clientId) : undefined;
  } else if (t.deliveryId) {
    if (!can(a, "deliveries.manage")) throw ApiError.forbidden();
    const d = await lazy("Delivery").findById(t.deliveryId).select("clientId");
    if (!d) throw ApiError.notFound("Delivery not found");
    clientId = String((d as any).clientId);
  } else {
    if (!(can(a, "orders.create") || can(a, "orders.edit")))
      throw ApiError.forbidden();
    clientId = t.clientId;
    if (!clientId)
      throw ApiError.unprocessable("clientId is required", "CLIENT_REQUIRED");
  }
  return { clientId };
}

export interface CreateSessionInput extends TargetInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category?: string;
  previousVersionId?: string;
  accessClass?: "shared" | "internal";
}

export async function createUploadSession(
  a: AuthContext,
  input: CreateSessionInput,
) {
  const originalName = sanitizeFilename(input.fileName);
  const { ext } = validateUpload(originalName, input.mimeType, input.sizeBytes);
  const { clientId } = await resolveTarget(a, input);
  const plan = planUpload(input.sizeBytes);

  let previous: any;
  if (input.previousVersionId) {
    previous = await FileAsset.findOne({
      _id: input.previousVersionId,
      uploadState: "ready",
    });
    if (!previous || !(await canAccessFile(a, previous)))
      throw ApiError.notFound("Previous version not found");
    if (String(previous.clientId ?? "") !== String(clientId ?? ""))
      throw ApiError.forbidden();
  }
  const key = `${env.NODE_ENV}/clients/${clientId ?? "none"}/${crypto.randomUUID()}.${ext}`;
  const file = new FileAsset({
    originalName,
    objectKey: key,
    mimeType: input.mimeType.toLowerCase(),
    sizeBytes: input.sizeBytes,
    category: input.category ?? previous?.category ?? "design",
    clientId,
    orderId: input.orderId ?? previous?.orderId,
    plateId: input.plateId ?? previous?.plateId,
    invoiceId: input.invoiceId ?? previous?.invoiceId,
    deliveryId: input.deliveryId ?? previous?.deliveryId,
    uploadedBy: a.userId,
    accessClass:
      a.role === "client"
        ? "shared"
        : (input.accessClass ?? previous?.accessClass ?? "shared"),
    previousVersionId: previous?._id,
    uploadMode: plan.mode,
    partSizeBytes: plan.mode === "multipart" ? plan.partSizeBytes : undefined,
    partCount: plan.mode === "multipart" ? plan.partCount : undefined,
  });
  file.versionGroupId = previous?.versionGroupId ?? file._id;

  const storage = getStorage();
  const ttl = env.R2_PRESIGNED_URL_TTL_SECONDS;
  let uploadUrl: string | undefined;
  if (plan.mode === "single") {
    uploadUrl = await storage.presignPut(
      key,
      file.mimeType,
      file.sizeBytes,
      ttl,
    );
  } else {
    file.multipartUploadId = await storage.createMultipart(key, file.mimeType);
  }
  await file.save();
  await audit(a, "file.upload_started", "FileAsset", file._id, {
    name: originalName,
    size: file.sizeBytes,
    mode: plan.mode,
  });
  return {
    file: file.toJSON(),
    upload:
      plan.mode === "single"
        ? {
            mode: "single",
            url: uploadUrl,
            headers: { "Content-Type": file.mimeType },
            expiresInSeconds: ttl,
          }
        : {
            mode: "multipart",
            partSizeBytes: plan.partSizeBytes,
            partCount: plan.partCount,
            expiresInSeconds: ttl,
          },
  };
}

async function loadOwnPending(a: AuthContext, id: string) {
  const file = await FileAsset.findById(id).select("+multipartUploadId");
  if (!file || (String(file.uploadedBy) !== a.userId && a.role !== "admin"))
    throw ApiError.notFound("File not found");
  if (file.uploadState !== "pending")
    throw ApiError.conflict(
      "Upload is no longer in progress",
      "UPLOAD_NOT_PENDING",
    );
  return file;
}

export async function presignParts(
  a: AuthContext,
  id: string,
  partNumbers: number[],
) {
  const file = await loadOwnPending(a, id);
  if (file.uploadMode !== "multipart" || !file.multipartUploadId)
    throw ApiError.unprocessable(
      "This upload is not multipart",
      "NOT_MULTIPART",
    );
  if (partNumbers.some((n) => n < 1 || n > (file.partCount ?? 0)))
    throw ApiError.unprocessable("Invalid part number", "INVALID_PART");
  const storage = getStorage();
  const urls = await Promise.all(
    partNumbers.map(async (n) => ({
      partNumber: n,
      url: await storage.presignPart(
        file.objectKey,
        file.multipartUploadId!,
        n,
        env.R2_PRESIGNED_URL_TTL_SECONDS,
      ),
    })),
  );
  return urls;
}

async function failUpload(file: any, message: string, code: string) {
  await getStorage()
    .remove(file.objectKey)
    .catch(() => undefined);
  file.uploadState = "failed";
  await file.save();
  throw ApiError.unprocessable(message, code);
}

export async function completeUpload(
  a: AuthContext,
  id: string,
  parts?: StoredPart[],
) {
  const file = await loadOwnPending(a, id);
  const storage = getStorage();
  if (file.uploadMode === "multipart") {
    const nums = (parts ?? []).map((p) => p.partNumber).sort((x, y) => x - y);
    if (
      nums.length !== file.partCount ||
      nums.some((n, i) => n !== i + 1) ||
      (parts ?? []).some((p) => !p.etag)
    ) {
      throw ApiError.unprocessable(
        "All parts must be reported before completing the upload",
        "PARTS_INCOMPLETE",
      );
    }
    try {
      await storage.completeMultipart(
        file.objectKey,
        file.multipartUploadId!,
        parts!,
      );
    } catch {
      throw ApiError.unprocessable(
        "Storage rejected the uploaded parts; retry the failed parts",
        "STORAGE_COMPLETE_FAILED",
      );
    }
  }
  const head = await storage.head(file.objectKey);
  if (!head)
    throw ApiError.unprocessable(
      "The file was not found in storage; upload it again",
      "OBJECT_MISSING",
    );
  if (head.sizeBytes !== file.sizeBytes)
    await failUpload(
      file,
      "Uploaded size does not match the declared size",
      "SIZE_MISMATCH",
    );
  const ext = path.extname(file.originalName).slice(1).toLowerCase();
  if (MAGIC[ext]) {
    const bytes = await storage.readHead(file.objectKey, 16);
    if (!sniffMatches(ext, bytes))
      await failUpload(
        file,
        "File content does not match its extension",
        "CONTENT_MISMATCH",
      );
  }
  const latest = await FileAsset.findOne({
    versionGroupId: file.versionGroupId,
    uploadState: "ready",
  })
    .sort({ version: -1 })
    .select("version");
  file.version = (latest?.version ?? 0) + 1;
  file.uploadState = "ready";
  file.completedAt = new Date();
  file.multipartUploadId = undefined;
  await file.save();
  // The order only references the file once the upload is verified.
  if (file.orderId)
    await Order.updateOne(
      { _id: file.orderId },
      { $addToSet: { fileAssetIds: file._id } },
    );
  await audit(
    a,
    file.version > 1 ? "file.version_created" : "file.uploaded",
    "FileAsset",
    file._id,
    { name: file.originalName, version: file.version, orderId: file.orderId },
  );
  return file;
}

export async function abortUpload(a: AuthContext, id: string) {
  const file = await loadOwnPending(a, id);
  if (file.uploadMode === "multipart" && file.multipartUploadId)
    await getStorage()
      .abortMultipart(file.objectKey, file.multipartUploadId)
      .catch(() => undefined);
  else
    await getStorage()
      .remove(file.objectKey)
      .catch(() => undefined);
  file.uploadState = "aborted";
  file.multipartUploadId = undefined;
  await file.save();
  await audit(a, "file.upload_aborted", "FileAsset", file._id);
  return file;
}

/** Aborts uploads that were never completed (run via `npm run files:cleanup`; also configure an R2 lifecycle rule). */
export async function cleanupAbandoned(hours = env.ABANDONED_UPLOAD_HOURS) {
  const stale = await FileAsset.find({
    uploadState: "pending",
    createdAt: { $lt: new Date(Date.now() - hours * 3600_000) },
  }).select("+multipartUploadId");
  for (const f of stale) {
    if (f.uploadMode === "multipart" && f.multipartUploadId)
      await getStorage()
        .abortMultipart(f.objectKey, f.multipartUploadId)
        .catch(() => undefined);
    f.uploadState = "aborted";
    f.multipartUploadId = undefined;
    await f.save();
  }
  return stale.length;
}

// ---- Access control -------------------------------------------------------

const managerCanSee = (a: AuthContext, f: any) => {
  if (f.plateId) return can(a, "plates.manage");
  if (f.invoiceId) return can(a, "finance.view");
  if (f.deliveryId) return can(a, "deliveries.manage");
  return can(a, "orders.view");
};

export async function canAccessFile(a: AuthContext, f: any): Promise<boolean> {
  if (f.archivedAt && a.role !== "admin") return false;
  if (a.role === "admin") return true;
  if (a.role === "manager") return managerCanSee(a, f);
  if (f.accessClass !== "shared") return false;
  if (a.role === "client")
    return (
      !!a.clientId &&
      String(f.clientId ?? "") === a.clientId &&
      (f.uploadState === "ready" || String(f.uploadedBy) === a.userId)
    );
  if (a.role === "printer") {
    if (!a.printerId || f.uploadState !== "ready") return false;
    return !!(await Order.exists({
      assignedPrinterId: a.printerId,
      fileAssetIds: f._id,
    }));
  }
  return false;
}

export async function fileListFilter(
  a: AuthContext,
): Promise<Record<string, any> | null> {
  const base = { uploadState: "ready", archivedAt: null };
  if (a.role === "admin") return base;
  if (a.role === "client")
    return a.clientId
      ? { ...base, clientId: a.clientId, accessClass: "shared" }
      : null;
  if (a.role === "printer") {
    if (!a.printerId) return null;
    const ids = await Order.find({ assignedPrinterId: a.printerId }).distinct(
      "fileAssetIds",
    );
    return { ...base, _id: { $in: ids }, accessClass: "shared" };
  }
  const or: any[] = [];
  if (can(a, "orders.view"))
    or.push({ plateId: null, invoiceId: null, deliveryId: null });
  if (can(a, "plates.manage")) or.push({ plateId: { $ne: null } });
  if (can(a, "finance.view")) or.push({ invoiceId: { $ne: null } });
  if (can(a, "deliveries.manage")) or.push({ deliveryId: { $ne: null } });
  return or.length ? { ...base, $or: or } : null;
}

export async function downloadUrl(a: AuthContext, id: string) {
  const f = await FileAsset.findById(id);
  if (!f || f.uploadState !== "ready" || !(await canAccessFile(a, f)))
    throw ApiError.notFound("File not found");
  const url = await getStorage().presignGet(
    f.objectKey,
    f.originalName,
    f.mimeType,
    env.R2_PRESIGNED_URL_TTL_SECONDS,
  );
  await audit(a, "file.download_url_issued", "FileAsset", f._id, {
    name: f.originalName,
  });
  return {
    url,
    expiresInSeconds: env.R2_PRESIGNED_URL_TTL_SECONDS,
    fileName: f.originalName,
  };
}

export { isStaff };
