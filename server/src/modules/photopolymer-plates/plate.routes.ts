import { Router } from "express";
import { z } from "zod";
import { can, type AuthContext } from "../../config/permissions.js";
import { env } from "../../config/env.js";
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
import { nextCode } from "../../database/index.js";
import { authenticate, requireRole } from "../../middleware/index.js";
import { audit } from "../audit-logs/audit.service.js";
import { Client } from "../clients/client.model.js";
import { Order } from "../orders/order.model.js";
import { Supplier } from "../suppliers/supplier.routes.js";
import { FileAsset } from "../files/file.model.js";
import { notifyClient } from "../notifications/notification.service.js";
import {
  PLATE_STATUSES,
  PLATE_TRANSITIONS,
  PhotopolymerPlate,
  PlatePricingRule,
  assertPlateTransition,
  computePlatePrice,
  computeSurfaceCm2,
  pricingRuleInput,
  type PlateStatus,
} from "./plate.model.js";

const router = Router();
router.use(authenticate);

const canManage = (a: AuthContext) => can(a, "plates.manage");
const dims = z.number().positive().max(100_000);

async function activeRule(clientId?: unknown) {
  return (
    (clientId &&
      (await PlatePricingRule.findOne({ clientId, isActive: true }).sort({
        version: -1,
      }))) ||
    PlatePricingRule.findOne({ clientId: null, isActive: true }).sort({
      version: -1,
    })
  );
}

function view(p: any, a: AuthContext) {
  const o = p.toJSON();
  o.allowedTransitions = canManage(a)
    ? PLATE_TRANSITIONS[o.status as PlateStatus]
    : [];
  if (a.role === "client") {
    for (const k of [
      "purchasePriceMinor",
      "supplierId",
      "pricing",
      "priceHistory",
      "responsibleUserId",
      "createdBy",
      "updatedBy",
      "productionOperationId",
    ])
      delete o[k];
    o.operations = (o.operations ?? []).filter((x: any) => !x.internal);
  }
  return o;
}

const scope = (a: AuthContext) =>
  a.role === "client"
    ? a.clientId
      ? { clientId: a.clientId }
      : null
    : canManage(a)
      ? {}
      : null;

router.get(
  "/",
  validate({
    query: paginationQuery.extend({
      clientId: objectId.optional(),
      orderId: objectId.optional(),
      status: z.enum(PLATE_STATUSES).optional(),
      widthMm: z.coerce.number().optional(),
      heightMm: z.coerce.number().optional(),
      dateFrom: z.coerce.date().optional(),
      dateTo: z.coerce.date().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const s = scope(a);
    if (!s) throw ApiError.forbidden();
    const q = req.validated!.query;
    const filter: any = { ...s, archivedAt: null };
    if (q.clientId && a.role !== "client") filter.clientId = q.clientId;
    for (const k of ["orderId", "status", "widthMm", "heightMm"] as const)
      if (q[k] !== undefined) filter[k] = q[k];
    if (q.dateFrom || q.dateTo)
      filter.receivedAt = {
        ...(q.dateFrom && { $gte: q.dateFrom }),
        ...(q.dateTo && { $lte: q.dateTo }),
      };
    if (q.search) {
      const rx = new RegExp(escapeRegex(q.search), "i");
      const fileIds = await FileAsset.find({ originalName: rx }).distinct(
        "_id",
      );
      filter.$or = [
        { reference: rx },
        { printSpecs: rx },
        { originalFileId: { $in: fileIds } },
      ];
    }
    const { items, meta } = await paginate(PhotopolymerPlate, filter, q, {
      allowedSort: [
        "reference",
        "receivedAt",
        "status",
        "surfaceCm2",
        "createdAt",
      ],
    });
    ok(
      res,
      items.map((p) => view(p, a)),
      "OK",
      meta,
    );
  }),
);

// Surface and price preview (no persistence)
router.post(
  "/calculate",
  validate({
    body: z.object({
      widthMm: dims,
      heightMm: dims,
      clientId: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!canManage(a)) throw ApiError.forbidden();
    const { widthMm, heightMm, clientId } = req.validated!.body;
    const surfaceCm2 = computeSurfaceCm2(widthMm, heightMm);
    const rule = await activeRule(clientId);
    ok(res, {
      surfaceCm2,
      price: computePlatePrice(surfaceCm2, rule),
      ruleVersion: rule?.version ?? null,
      pricingConfigured: !!rule,
    });
  }),
);

// ---- Pricing rules (versioned: every change creates a new version, history is retained) ----
const rules = Router();
rules.use(requireRole("admin", "manager"));
rules.get(
  "/",
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (
      !(
        a.role === "admin" ||
        can(a, "finance.view") ||
        can(a, "finance.manage")
      )
    )
      throw ApiError.forbidden();
    ok(res, await PlatePricingRule.find().sort({ createdAt: -1 }).limit(200));
  }),
);
rules.post(
  "/",
  validate({ body: pricingRuleInput }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!can(a, "finance.manage")) throw ApiError.forbidden();
    const b = req.validated!.body;
    const last = await PlatePricingRule.findOne({
      clientId: b.clientId ?? null,
    }).sort({ version: -1 });
    await PlatePricingRule.updateMany(
      { clientId: b.clientId ?? null, isActive: true },
      { isActive: false },
    );
    const rule = await PlatePricingRule.create({
      ...b,
      version: (last?.version ?? 0) + 1,
      currency: env.DEFAULT_CURRENCY,
      createdBy: a.userId,
    });
    await audit(
      a,
      "plate.pricing_rule_changed",
      "PlatePricingRule",
      rule._id,
      { version: rule.version, clientId: b.clientId },
      req,
    );
    created(res, rule);
  }),
);
router.use("/pricing-rules", rules);


const plateInput = z.object({
  clientId: objectId,
  orderId: objectId.optional(),
  receivedAt: z.coerce.date().optional(),
  widthMm: dims,
  heightMm: dims,
  thicknessMm: z.number().positive().max(100).optional(),
  plateType: z.string().trim().max(60).optional(),
  colorsCount: z.number().int().min(0).max(20).optional(),
  printSpecs: z.string().max(2000).optional(),
  supplierId: objectId.optional(),
  purchasePriceMinor: z.number().int().min(0).optional(),
  sellingPriceMinor: z.number().int().min(0).optional(),
  plannedDate: z.coerce.date().optional(),
  responsibleUserId: objectId.optional(),
  originalFileId: objectId.optional(),
});

async function checkRefs(
  i: Partial<z.infer<typeof plateInput>>,
  clientId: string,
) {
  if (i.clientId && !(await Client.exists({ _id: i.clientId, isActive: true })))
    throw ApiError.unprocessable("Client does not exist", "INVALID_REFERENCE");
  if (i.orderId && !(await Order.exists({ _id: i.orderId, clientId })))
    throw ApiError.unprocessable(
      "Order does not exist for this client",
      "INVALID_REFERENCE",
    );
  if (
    i.supplierId &&
    !(await Supplier.exists({ _id: i.supplierId, isActive: true }))
  )
    throw ApiError.unprocessable(
      "Supplier does not exist",
      "INVALID_REFERENCE",
    );
  if (
    i.originalFileId &&
    !(await FileAsset.exists({
      _id: i.originalFileId,
      clientId,
      uploadState: "ready",
    }))
  )
    throw ApiError.unprocessable(
      "File does not exist for this client",
      "INVALID_REFERENCE",
    );
}

router.post(
  "/",
  validate({ body: plateInput }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!canManage(a)) throw ApiError.forbidden();
    const b = req.validated!.body;
    await checkRefs(b, b.clientId);
    const surfaceCm2 = computeSurfaceCm2(b.widthMm, b.heightMm);
    const rule = await activeRule(b.clientId);
    const price = computePlatePrice(surfaceCm2, rule);
    const canPrice = can(a, "finance.manage");
    const selling =
      b.sellingPriceMinor ?? (price && canPrice ? price.totalMinor : 0);
    const plate = await PhotopolymerPlate.create({
      ...b,
      reference: await nextCode("PLT"),
      surfaceCm2,
      currency: env.DEFAULT_CURRENCY,
      purchasePriceMinor: canPrice ? (b.purchasePriceMinor ?? 0) : 0,
      sellingPriceMinor: canPrice ? selling : 0,
      pricing:
        price && rule
          ? { ruleId: rule._id, ruleVersion: rule.version, breakdown: price }
          : undefined,
      priceHistory: canPrice
        ? [
            {
              purchasePriceMinor: b.purchasePriceMinor ?? 0,
              sellingPriceMinor: selling,
              by: a.userId,
              at: new Date(),
              reason: "initial",
            },
          ]
        : [],
      history: [
        {
          from: null,
          to: "file_received",
          by: a.userId,
          at: new Date(),
          note: "Plate registered",
        },
      ],
      createdBy: a.userId,
      updatedBy: a.userId,
    });
    await audit(
      a,
      "plate.created",
      "PhotopolymerPlate",
      plate._id,
      { reference: plate.reference, surfaceCm2 },
      req,
    );
    created(res, view(plate, a));
  }),
);

const load = async (a: AuthContext, id: string) => {
  const s = scope(a);
  if (!s) throw ApiError.forbidden();
  const p = await PhotopolymerPlate.findOne({ ...s, _id: id });
  if (!p) throw ApiError.notFound("Plate not found");
  return p;
};

router.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    ok(res, view(await load(a, req.params.id), a));
  }),
);

router.patch(
  "/:id",
  validate({
    params: idParams,
    body: plateInput.omit({ clientId: true }).partial().strict(),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!canManage(a)) throw ApiError.forbidden();
    const p = await load(a, req.params.id);
    if (["delivered", "cancelled"].includes(p.status))
      throw ApiError.unprocessable(
        "Closed plates cannot be edited",
        "PLATE_CLOSED",
      );
    const b = req.validated!.body;
    await checkRefs(b, String(p.clientId));
    const priceTouched =
      b.purchasePriceMinor !== undefined || b.sellingPriceMinor !== undefined;
    if (priceTouched && !can(a, "finance.manage"))
      throw ApiError.forbidden("Changing prices requires financial permission");
    const { purchasePriceMinor, sellingPriceMinor, ...rest } = b;
    p.set({ ...rest, updatedBy: a.userId });
    if (b.widthMm || b.heightMm)
      p.surfaceCm2 = computeSurfaceCm2(p.widthMm, p.heightMm);
    if (priceTouched) {
      p.purchasePriceMinor = purchasePriceMinor ?? p.purchasePriceMinor;
      p.sellingPriceMinor = sellingPriceMinor ?? p.sellingPriceMinor;
      p.priceHistory.push({
        purchasePriceMinor: p.purchasePriceMinor,
        sellingPriceMinor: p.sellingPriceMinor,
        by: a.userId,
        at: new Date(),
        reason: "manual update",
      } as any);
    }
    await p.save();
    await audit(
      a,
      priceTouched ? "plate.price_changed" : "plate.updated",
      "PhotopolymerPlate",
      p._id,
      { fields: Object.keys(b) },
      req,
    );
    ok(res, view(p, a), "Updated");
  }),
);

router.post(
  "/:id/status",
  validate({
    params: idParams,
    body: z.object({
      status: z.enum(PLATE_STATUSES),
      note: z.string().trim().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!canManage(a)) throw ApiError.forbidden();
    const p = await load(a, req.params.id);
    const { status, note } = req.validated!.body;
    assertPlateTransition(p.status as PlateStatus, status);
    if (status === "supplier_order" && !p.supplierId)
      throw ApiError.unprocessable(
        "Assign a supplier before ordering from the supplier",
        "SUPPLIER_REQUIRED",
      );
    p.history.push({
      from: p.status,
      to: status,
      by: a.userId,
      at: new Date(),
      note,
    } as any);
    p.status = status;
    if (status === "delivered") p.actualDate = new Date();
    p.updatedBy = a.userId as any;
    await p.save();
    await audit(
      a,
      "plate.status_changed",
      "PhotopolymerPlate",
      p._id,
      { to: status, note },
      req,
    );
    await notifyClient(p.clientId, {
      type: "order_status",
      title: `Plate ${p.reference}: ${status.replace(/_/g, " ")}`,
      link: `/plates`,
    });
    ok(res, view(p, a), "Status updated");
  }),
);

router.post(
  "/:id/notes",
  validate({
    params: idParams,
    body: z.object({
      type: z.string().trim().max(40).default("note"),
      text: z.string().trim().min(1).max(2000),
      internal: z.boolean().default(true),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!canManage(a)) throw ApiError.forbidden();
    const p = await load(a, req.params.id);
    p.operations.push({
      ...req.validated!.body,
      by: a.userId,
      byName: a.name,
      at: new Date(),
    } as any);
    await p.save();
    ok(res, view(p, a), "Note added");
  }),
);

// Reuse an existing reference for a new order without altering the history of the earlier one.
router.post(
  "/:id/reuse",
  validate({
    params: idParams,
    body: z.object({ orderId: objectId.optional() }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!canManage(a)) throw ApiError.forbidden();
    const src = await load(a, req.params.id);
    const orderId = req.validated!.body.orderId;
    if (orderId) await checkRefs({ orderId }, String(src.clientId));
    const plate = await PhotopolymerPlate.create({
      clientId: src.clientId,
      orderId,
      reference: await nextCode("PLT"),
      widthMm: src.widthMm,
      heightMm: src.heightMm,
      surfaceCm2: src.surfaceCm2,
      thicknessMm: src.thicknessMm,
      plateType: src.plateType,
      colorsCount: src.colorsCount,
      printSpecs: src.printSpecs,
      supplierId: src.supplierId,
      originalFileId: src.originalFileId,
      currency: src.currency,
      reusedFromId: src._id,
      history: [
        {
          from: null,
          to: "file_received",
          by: a.userId,
          at: new Date(),
          note: `Reused from ${src.reference}`,
        },
      ],
      createdBy: a.userId,
      updatedBy: a.userId,
    });
    await audit(
      a,
      "plate.reused",
      "PhotopolymerPlate",
      plate._id,
      { from: src.reference },
      req,
    );
    created(res, view(plate, a));
  }),
);

router.get(
  "/:id/files",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const p = await load(a, req.params.id);
    const filter: any = {
      $or: [{ plateId: p._id }, { _id: p.originalFileId }],
      uploadState: "ready",
      archivedAt: null,
    };
    if (a.role === "client") filter.accessClass = "shared";
    ok(
      res,
      await FileAsset.find(filter).sort({ versionGroupId: 1, version: 1 }),
    );
  }),
);

export default router;
