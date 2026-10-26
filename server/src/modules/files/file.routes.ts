import { Router } from "express";
import { z } from "zod";
import { can } from "../../config/permissions.js";
import {
  ApiError,
  asyncHandler,
  created,
  escapeRegex,
  idParams,
  objectId,
  ok,
  requireAuth,
  validate,
} from "../../utils/http.js";
import { paginate, paginationQuery } from "../../utils/pagination.js";
import { authenticate } from "../../middleware/index.js";
import { audit } from "../audit-logs/audit.service.js";
import { FILE_CATEGORIES, FileAsset } from "./file.model.js";
import {
  abortUpload,
  canAccessFile,
  completeUpload,
  createUploadSession,
  downloadUrl,
  fileListFilter,
  presignParts,
} from "./file.service.js";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  validate({
    query: paginationQuery.extend({
      orderId: objectId.optional(),
      plateId: objectId.optional(),
      clientId: objectId.optional(),
      category: z.enum(FILE_CATEGORIES).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const q = req.validated!.query;
    const base = await fileListFilter(a);
    if (!base) throw ApiError.forbidden();
    const filter: any = { ...base };
    for (const k of ["orderId", "plateId", "category"] as const)
      if (q[k]) filter[k] = q[k];
    if (q.clientId && a.role !== "client") filter.clientId = q.clientId;
    if (q.search) filter.originalName = new RegExp(escapeRegex(q.search), "i");
    const { items, meta } = await paginate(FileAsset, filter, q, {
      allowedSort: ["originalName", "createdAt", "sizeBytes"],
    });
    ok(res, items, "OK", meta);
  }),
);

router.post(
  "/uploads",
  validate({
    body: z.object({
      fileName: z.string().trim().min(1).max(255),
      mimeType: z.string().trim().min(1).max(150),
      sizeBytes: z.number().int().positive(),
      category: z.enum(FILE_CATEGORIES).optional(),
      orderId: objectId.optional(),
      plateId: objectId.optional(),
      invoiceId: objectId.optional(),
      deliveryId: objectId.optional(),
      clientId: objectId.optional(),
      previousVersionId: objectId.optional(),
      accessClass: z.enum(["shared", "internal"]).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    created(
      res,
      await createUploadSession(requireAuth(req), req.validated!.body),
      "Upload session created",
    );
  }),
);

router.post(
  "/:id/parts",
  validate({
    params: idParams,
    body: z.object({
      partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(100),
    }),
  }),
  asyncHandler(async (req, res) => {
    ok(res, {
      parts: await presignParts(
        requireAuth(req),
        req.params.id,
        req.validated!.body.partNumbers,
      ),
    });
  }),
);

router.post(
  "/:id/complete",
  validate({
    params: idParams,
    body: z.object({
      parts: z
        .array(
          z.object({
            partNumber: z.number().int().min(1),
            etag: z.string().min(1).max(200),
          }),
        )
        .max(10000)
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const f = await completeUpload(
      requireAuth(req),
      req.params.id,
      req.validated!.body.parts,
    );
    ok(res, f, "Upload completed");
  }),
);

router.post(
  "/:id/abort",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    ok(
      res,
      await abortUpload(requireAuth(req), req.params.id),
      "Upload aborted",
    );
  }),
);

const loadVisible = async (req: any) => {
  const a = requireAuth(req);
  const f = await FileAsset.findById(req.params.id);
  if (!f || !(await canAccessFile(a, f)))
    throw ApiError.notFound("File not found");
  return f;
};

router.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => ok(res, await loadVisible(req))),
);

router.get(
  "/:id/versions",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const f = await loadVisible(req);
    const versions = await FileAsset.find({
      versionGroupId: f.versionGroupId,
      uploadState: "ready",
    }).sort({ version: 1 });
    const visible = [];
    for (const v of versions) if (await canAccessFile(a, v)) visible.push(v);
    ok(res, visible);
  }),
);

router.get(
  "/:id/download-url",
  validate({ params: idParams }),
  asyncHandler(async (req, res) =>
    ok(res, await downloadUrl(requireAuth(req), req.params.id)),
  ),
);

// Files are never physically deleted: archiving hides them and keeps every version for traceability.
router.post(
  "/:id/archive",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!(a.role === "admin" || can(a, "orders.edit")))
      throw ApiError.forbidden();
    const f = await loadVisible(req);
    f.archivedAt = new Date();
    await f.save();
    await audit(
      a,
      "file.archived",
      "FileAsset",
      f._id,
      { name: f.originalName },
      req,
    );
    ok(res, f, "File archived");
  }),
);

export default router;
