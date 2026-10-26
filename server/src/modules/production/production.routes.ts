import mongoose from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { can, type AuthContext } from "../../config/permissions.js";
import {
  ApiError,
  asyncHandler,
  created,
  idParams,
  objectId,
  ok,
  requireAuth,
  validate,
} from "../../utils/http.js";
import { paginate, paginationQuery } from "../../utils/pagination.js";
import {
  makeSchema,
  auditFields,
  ObjectId,
  nextCode,
} from "../../database/index.js";
import { authenticate } from "../../middleware/index.js";
import { audit } from "../audit-logs/audit.service.js";
import { Order } from "../orders/order.model.js";
import { recomputeOrderCosts } from "../orders/order.service.js";
import { Supplier } from "../suppliers/supplier.routes.js";
import { Printer } from "../printers/printer.routes.js";
import { notifyStaff } from "../notifications/notification.service.js";

export const OP_STATUSES = [
  "planned",
  "awaiting_approval",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
] as const;

const opSchema = makeSchema({
  reference: { type: String, required: true, unique: true },
  orderId: { type: ObjectId, ref: "Order", required: true, index: true },
  lineItemId: ObjectId,
  executorType: {
    type: String,
    enum: ["internal", "supplier", "subcontractor", "printer"],
    required: true,
  },
  supplierId: { type: ObjectId, ref: "Supplier", index: true },
  printerId: { type: ObjectId, ref: "Printer", index: true },
  operationType: { type: String, required: true },
  sequence: { type: Number, default: 1 },
  agreedCostMinor: { type: Number, default: 0, min: 0 },
  actualCostMinor: { type: Number, default: 0, min: 0 },
  additionalCostMinor: { type: Number, default: 0, min: 0 },
  plannedStart: Date,
  plannedEnd: Date,
  actualStart: Date,
  actualEnd: Date,
  quantityOrdered: { type: Number, default: 0, min: 0 },
  quantityProduced: { type: Number, default: 0, min: 0 },
  quantityDelivered: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: OP_STATUSES, default: "planned", index: true },
  technicalNotes: String,
  issues: [
    new mongoose.Schema(
      { text: String, by: ObjectId, byName: String, at: Date },
      { _id: true },
    ),
  ],
  nonConformities: [
    new mongoose.Schema(
      {
        type: { type: String },
        description: String,
        reworkRequired: Boolean,
        extraCostMinor: { type: Number, default: 0 },
        by: ObjectId,
        at: Date,
        resolvedAt: Date,
      },
      { _id: true },
    ),
  ],
  responsibleUserIds: [{ type: ObjectId, ref: "User" }],
  history: [
    new mongoose.Schema(
      { at: Date, by: ObjectId, change: String },
      { _id: false },
    ),
  ],
  archivedAt: Date,
  ...auditFields,
});
export const ProductionOperation = mongoose.model<any>(
  "ProductionOperation",
  opSchema,
);

const input = z.object({
  orderId: objectId,
  lineItemId: objectId.optional(),
  executorType: z.enum(["internal", "supplier", "subcontractor", "printer"]),
  supplierId: objectId.optional(),
  printerId: objectId.optional(),
  operationType: z.string().trim().min(1).max(100),
  sequence: z.number().int().min(1).max(100).optional(),
  agreedCostMinor: z.number().int().min(0).optional(),
  actualCostMinor: z.number().int().min(0).optional(),
  plannedStart: z.coerce.date().optional(),
  plannedEnd: z.coerce.date().optional(),
  actualStart: z.coerce.date().optional(),
  actualEnd: z.coerce.date().optional(),
  quantityOrdered: z.number().min(0).optional(),
  quantityProduced: z.number().min(0).optional(),
  quantityDelivered: z.number().min(0).optional(),
  technicalNotes: z.string().max(3000).optional(),
  responsibleUserIds: z.array(objectId).max(10).optional(),
});
const COST_FIELDS = ["agreedCostMinor", "actualCostMinor"];

const manage = (a: AuthContext) => can(a, "production.manage");
const seesCost = (a: AuthContext) =>
  a.role === "admin" || can(a, "finance.view") || can(a, "finance.manage");

function scope(a: AuthContext) {
  if (manage(a)) return {};
  if (a.role === "printer" && a.printerId) return { printerId: a.printerId };
  return null;
}

function view(op: any, a: AuthContext) {
  const o = op.toJSON();
  if (!seesCost(a))
    for (const k of [...COST_FIELDS, "additionalCostMinor"]) delete o[k];
  if (a.role === "printer")
    o.nonConformities = (o.nonConformities ?? []).map(
      ({ extraCostMinor: _e, ...x }: any) => x,
    );
  return o;
}

async function checkRefs(i: any) {
  if (i.orderId && !(await Order.exists({ _id: i.orderId })))
    throw ApiError.unprocessable("Order does not exist", "INVALID_REFERENCE");
  if (
    i.supplierId &&
    !(await Supplier.exists({ _id: i.supplierId, isActive: true }))
  )
    throw ApiError.unprocessable(
      "Supplier does not exist",
      "INVALID_REFERENCE",
    );
  if (
    i.printerId &&
    !(await Printer.exists({ _id: i.printerId, isActive: true }))
  )
    throw ApiError.unprocessable("Printer does not exist", "INVALID_REFERENCE");
}

const router = Router();
router.use(authenticate);

router.get(
  "/",
  validate({
    query: paginationQuery.extend({
      orderId: objectId.optional(),
      supplierId: objectId.optional(),
      status: z.enum(OP_STATUSES).optional(),
      queue: z.enum(["delayed", "blocked", "awaiting_approval"]).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const s = scope(a);
    if (!s) throw ApiError.forbidden();
    const q = req.validated!.query;
    const filter: any = { ...s, archivedAt: null };
    for (const k of ["orderId", "supplierId", "status"] as const)
      if (q[k]) filter[k] = q[k];
    if (q.queue === "delayed")
      Object.assign(filter, {
        plannedEnd: { $lt: new Date() },
        status: { $nin: ["completed", "cancelled"] },
      });
    if (q.queue === "blocked") filter.status = "blocked";
    if (q.queue === "awaiting_approval") filter.status = "awaiting_approval";
    if (q.search)
      filter.$or = [
        {
          reference: new RegExp(
            q.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i",
          ),
        },
        {
          operationType: new RegExp(
            q.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i",
          ),
        },
      ];
    const { items, meta } = await paginate(ProductionOperation, filter, q, {
      allowedSort: ["reference", "plannedEnd", "status", "createdAt"],
    });
    ok(
      res,
      items.map((o) => view(o, a)),
      "OK",
      meta,
    );
  }),
);

router.post(
  "/",
  validate({ body: input }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const b = req.validated!.body;
    await checkRefs(b);
    if (b.executorType === "printer" && !b.printerId)
      throw ApiError.unprocessable("Printer is required", "PRINTER_REQUIRED");
    if (["supplier", "subcontractor"].includes(b.executorType) && !b.supplierId)
      throw ApiError.unprocessable("Supplier is required", "SUPPLIER_REQUIRED");
    const costs = seesCost(a) && can(a, "finance.manage");
    const op = await ProductionOperation.create({
      ...b,
      ...(costs ? {} : { agreedCostMinor: 0, actualCostMinor: 0 }),
      reference: await nextCode("OP"),
      history: [{ at: new Date(), by: a.userId, change: "created" }],
      createdBy: a.userId,
      updatedBy: a.userId,
    });
    await recomputeOrderCosts(op.orderId);
    await audit(
      a,
      "production.created",
      "ProductionOperation",
      op._id,
      { orderId: b.orderId },
      req,
    );
    created(res, view(op, a));
  }),
);

const load = async (a: AuthContext, id: string) => {
  const s = scope(a);
  if (!s) throw ApiError.forbidden();
  const op = await ProductionOperation.findOne({ ...s, _id: id });
  if (!op) throw ApiError.notFound("Operation not found");
  return op;
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
    body: input
      .omit({ orderId: true })
      .partial()
      .extend({ additionalCostMinor: z.number().int().min(0).optional() })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const op = await load(a, req.params.id);
    const b = req.validated!.body;
    await checkRefs(b);
    const costKeys = Object.keys(b).filter((k) =>
      [...COST_FIELDS, "additionalCostMinor"].includes(k),
    );
    if (costKeys.length && !can(a, "finance.manage"))
      throw ApiError.forbidden("Changing costs requires financial permission");
    op.set({ ...b, updatedBy: a.userId });
    op.history.push({
      at: new Date(),
      by: a.userId,
      change: `updated: ${Object.keys(b).join(", ")}`,
    } as any);
    await op.save();
    await recomputeOrderCosts(op.orderId);
    await audit(
      a,
      costKeys.length ? "production.cost_changed" : "production.updated",
      "ProductionOperation",
      op._id,
      { fields: Object.keys(b) },
      req,
    );
    ok(res, view(op, a), "Updated");
  }),
);

const OP_TRANSITIONS: Record<string, string[]> = {
  planned: ["awaiting_approval", "in_progress", "cancelled"],
  awaiting_approval: ["in_progress", "planned", "cancelled"],
  in_progress: ["blocked", "completed", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  completed: [],
  cancelled: [],
};

router.post(
  "/:id/status",
  validate({
    params: idParams,
    body: z.object({
      status: z.enum(OP_STATUSES),
      note: z.string().max(1000).optional(),
      quantityProduced: z.number().min(0).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const op = await load(a, req.params.id);
    const { status, note, quantityProduced } = req.validated!.body;
    // Printers may only start/complete/block their own work; approvals are staff decisions.
    if (
      a.role === "printer" &&
      !["in_progress", "blocked", "completed"].includes(status)
    )
      throw ApiError.forbidden();
    if (!OP_TRANSITIONS[op.status]?.includes(status))
      throw ApiError.unprocessable(
        `Transition ${op.status} -> ${status} is not allowed`,
        "TRANSITION_NOT_ALLOWED",
      );
    if (
      status === "in_progress" &&
      op.status === "awaiting_approval" &&
      !manage(a)
    )
      throw ApiError.forbidden();
    if (status === "in_progress" && !op.actualStart)
      op.actualStart = new Date();
    if (status === "completed") op.actualEnd = new Date();
    if (quantityProduced !== undefined) op.quantityProduced = quantityProduced;
    op.history.push({
      at: new Date(),
      by: a.userId,
      change: `status ${op.status} -> ${status}${note ? `: ${note}` : ""}`,
    } as any);
    op.status = status;
    await op.save();
    await audit(
      a,
      "production.status_changed",
      "ProductionOperation",
      op._id,
      { to: status, note },
      req,
    );
    if (status === "awaiting_approval" || status === "blocked") {
      await notifyStaff(
        "production.manage",
        {
          type: "approval_pending",
          title: `Operation ${op.reference} is ${status.replace("_", " ")}`,
          link: "/production",
        },
        a.userId,
      );
    }
    ok(res, view(op, a), "Status updated");
  }),
);

router.post(
  "/:id/issues",
  validate({
    params: idParams,
    body: z.object({ text: z.string().trim().min(3).max(2000) }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const op = await load(a, req.params.id);
    op.issues.push({
      text: req.validated!.body.text,
      by: a.userId,
      byName: a.name,
      at: new Date(),
    } as any);
    await op.save();
    await notifyStaff(
      "production.manage",
      {
        type: "non_conformity",
        title: `Issue on operation ${op.reference}`,
        body: req.validated!.body.text,
        link: "/production",
      },
      a.userId,
    );
    created(res, view(op, a), "Issue recorded");
  }),
);

router.post(
  "/:id/non-conformities",
  validate({
    params: idParams,
    body: z.object({
      type: z.string().trim().max(60),
      description: z.string().trim().min(3).max(2000),
      reworkRequired: z.boolean().default(false),
      extraCostMinor: z.number().int().min(0).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const op = await load(a, req.params.id);
    const b = req.validated!.body;
    if (b.extraCostMinor && !can(a, "finance.manage"))
      throw ApiError.forbidden("Extra costs require financial permission");
    op.nonConformities.push({ ...b, by: a.userId, at: new Date() } as any);
    if (b.extraCostMinor)
      op.additionalCostMinor = (op.additionalCostMinor ?? 0) + b.extraCostMinor;
    await op.save();
    await recomputeOrderCosts(op.orderId);
    await audit(
      a,
      "production.non_conformity",
      "ProductionOperation",
      op._id,
      { type: b.type },
      req,
    );
    await notifyStaff(
      "production.manage",
      {
        type: "non_conformity",
        title: `Non-conformity on ${op.reference}`,
        body: b.description,
        link: "/production",
      },
      a.userId,
    );
    created(res, view(op, a), "Non-conformity recorded");
  }),
);

export default router;
