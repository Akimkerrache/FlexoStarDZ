import mongoose from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { can, type AuthContext } from "../../config/permissions.js";
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
import {
  makeSchema,
  auditFields,
  ObjectId,
  nextSequence,
} from "../../database/index.js";
import { authenticate } from "../../middleware/index.js";
import { audit } from "../audit-logs/audit.service.js";
import { Client } from "../clients/client.model.js";
import { Order } from "../orders/order.model.js";
import { createOrder } from "../orders/order.service.js";
import { createOrderInput } from "../orders/order.schemas.js";
import {
  commercialLineInput,
  commercialLineSchema,
  priceCommercialLines,
  totalsDef,
} from "../shared/commercial.js";
import { env } from "../../config/env.js";

export const QUOTATION_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "converted",
] as const;
const NEXT: Record<string, string[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected", "expired", "draft"],
  accepted: [],
  rejected: ["draft"],
  expired: ["draft"],
  converted: [],
};

const quotationSchema = makeSchema({
  number: { type: String, required: true, unique: true },
  clientId: { type: ObjectId, ref: "Client", required: true, index: true },
  issueDate: { type: Date, default: Date.now },
  validUntil: { type: Date, required: true },
  status: {
    type: String,
    enum: QUOTATION_STATUSES,
    default: "draft",
    index: true,
  },
  title: String,
  lines: [commercialLineSchema],
  ...totalsDef,
  estimatedCostMinor: { type: Number, default: 0 },
  marginMinor: { type: Number, default: 0 },
  marginPercent: { type: Number, default: 0 },
  currency: { type: String, default: "DZD" },
  notes: String,
  fileAssetIds: [{ type: ObjectId, ref: "FileAsset" }],
  history: [
    new mongoose.Schema(
      { status: String, by: ObjectId, at: Date, note: String },
      { _id: false },
    ),
  ],
  convertedOrderId: { type: ObjectId, ref: "Order" },
  ...auditFields,
});
quotationSchema.index({ status: 1, validUntil: 1 });
export const Quotation = mongoose.model<any>("Quotation", quotationSchema);

const input = z.object({
  clientId: objectId,
  validUntil: z.coerce.date(),
  title: z.string().trim().max(200).optional(),
  lines: z.array(commercialLineInput).min(1).max(100),
  notes: z.string().max(3000).optional(),
});

const manage = (a: AuthContext) => can(a, "quotations.manage");
const seesCost = (a: AuthContext) =>
  a.role === "admin" || can(a, "finance.view") || can(a, "finance.manage");
const scope = (a: AuthContext) =>
  manage(a)
    ? {}
    : a.role === "client" && a.clientId
      ? { clientId: a.clientId, status: { $ne: "draft" } }
      : null;

function view(q: any, a: AuthContext) {
  const o = q.toJSON();
  if (a.role === "client" || !seesCost(a)) {
    for (const k of [
      "estimatedCostMinor",
      "marginMinor",
      "marginPercent",
      "createdBy",
      "updatedBy",
    ])
      delete o[k];
    o.lines = o.lines.map(({ unitCostMinor: _c, ...l }: any) => l);
  }
  return o;
}

const router = Router();
router.use(authenticate);

/** Quotations past validity are expired lazily so lists and conversion never act on stale offers. */
export async function expireQuotations() {
  const r = await Quotation.updateMany(
    { status: "sent", validUntil: { $lt: new Date() } },
    {
      status: "expired",
      $push: {
        history: {
          status: "expired",
          at: new Date(),
          note: "Validity period elapsed",
        },
      },
    },
  );
  return r.modifiedCount;
}

router.get(
  "/",
  validate({
    query: paginationQuery.extend({
      clientId: objectId.optional(),
      status: z.enum(QUOTATION_STATUSES).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const s = scope(a);
    if (!s) throw ApiError.forbidden();
    await expireQuotations();
    const q = req.validated!.query;
    const filter: any = { ...s };
    if (q.status) filter.status = q.status;
    if (q.clientId && a.role !== "client") filter.clientId = q.clientId;
    if (q.search) filter.number = new RegExp(escapeRegex(q.search), "i");
    const { items, meta } = await paginate(Quotation, filter, q, {
      allowedSort: [
        "number",
        "validUntil",
        "status",
        "grandTotalMinor",
        "createdAt",
      ],
      populate: { path: "clientId", select: "legalName code" },
    });
    ok(
      res,
      items.map((d) => view(d, a)),
      "OK",
      meta,
    );
  }),
);

async function nextNumber() {
  const y = new Date().getFullYear();
  return `QUO-${y}-${String(await nextSequence(`quotation-${y}`)).padStart(5, "0")}`;
}

router.post(
  "/",
  validate({ body: input }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const b = req.validated!.body;
    if (!(await Client.exists({ _id: b.clientId, isActive: true })))
      throw ApiError.unprocessable(
        "Client does not exist",
        "INVALID_REFERENCE",
      );
    const priced = priceCommercialLines(b.lines);
    const { lines, ...totals } = priced;
    const doc = await Quotation.create({
      ...b,
      lines,
      ...totals,
      number: await nextNumber(),
      currency: env.DEFAULT_CURRENCY,
      history: [
        { status: "draft", by: a.userId, at: new Date(), note: "Created" },
      ],
      createdBy: a.userId,
      updatedBy: a.userId,
    });
    await audit(
      a,
      "quotation.created",
      "Quotation",
      doc._id,
      { number: doc.number },
      req,
    );
    created(res, view(doc, a));
  }),
);

const load = async (a: AuthContext, id: string) => {
  const s = scope(a);
  if (!s) throw ApiError.forbidden();
  const q = await Quotation.findOne({ ...s, _id: id });
  if (!q) throw ApiError.notFound("Quotation not found");
  return q;
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
    body: input.omit({ clientId: true }).partial().strict(),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const q = await load(a, req.params.id);
    if (q.status !== "draft")
      throw ApiError.unprocessable(
        "Only draft quotations can be edited; revise it back to draft first",
        "QUOTATION_LOCKED",
      );
    const { lines, ...rest } = req.validated!.body;
    q.set({ ...rest, updatedBy: a.userId });
    if (lines) q.set(priceCommercialLines(lines));
    q.history.push({
      status: "draft",
      by: a.userId,
      at: new Date(),
      note: "Edited",
    } as any);
    await q.save();
    await audit(
      a,
      "quotation.updated",
      "Quotation",
      q._id,
      { prices: !!lines },
      req,
    );
    ok(res, view(q, a), "Updated");
  }),
);

router.post(
  "/:id/status",
  validate({
    params: idParams,
    body: z.object({
      status: z.enum(["draft", "sent", "accepted", "rejected", "expired"]),
      note: z.string().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const q = await load(a, req.params.id);
    const { status, note } = req.validated!.body;
    if (!NEXT[q.status]?.includes(status))
      throw ApiError.unprocessable(
        `Transition ${q.status} -> ${status} is not allowed`,
        "TRANSITION_NOT_ALLOWED",
      );
    if (status === "accepted" && q.validUntil < new Date())
      throw ApiError.unprocessable(
        "Quotation validity has elapsed",
        "QUOTATION_EXPIRED",
      );
    q.status = status;
    q.history.push({ status, by: a.userId, at: new Date(), note } as any);
    await q.save();
    await audit(
      a,
      "quotation.status_changed",
      "Quotation",
      q._id,
      { to: status },
      req,
    );
    ok(res, view(q, a), "Status updated");
  }),
);

// Order creation needs the technical block; the commercial data comes from the accepted quotation.
const convertBody = createOrderInput.pick({
  machineId: true,
  jobName: true,
  technicalSpecifications: true,
  requestedDeliveryDate: true,
  customerNotes: true,
  internalNotes: true,
});
router.post(
  "/:id/convert",
  validate({ params: idParams, body: convertBody }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a) || !can(a, "orders.create")) throw ApiError.forbidden();
    const q = await load(a, req.params.id);
    // Idempotent: a retry returns the order created by the first call.
    const existing = await Order.findOne({ quotationId: q._id });
    if (existing)
      return ok(
        res,
        { orderId: existing._id, jobCode: existing.jobCode, replayed: true },
        "Quotation already converted",
      );
    if (q.status !== "accepted")
      throw ApiError.unprocessable(
        "Only accepted quotations can be converted",
        "QUOTATION_NOT_ACCEPTED",
      );
    const b = req.validated!.body;
    let order;
    try {
      ({ order } = await createOrder(
        a,
        {
          ...b,
          clientId: String(q.clientId),
          submit: false,
          lineItems: q.lines.map((l: any) => ({
            catalogItemId: l.catalogItemId
              ? String(l.catalogItemId)
              : undefined,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit ?? undefined,
            unitPriceMinor: l.unitPriceMinor,
            discountPercent: l.discountPercent ?? 0,
            taxPercent: l.taxPercent ?? 0,
          })),
        },
        undefined,
        {
          quotationId: String(q._id),
          estimatedCostMinor: q.estimatedCostMinor,
        },
      ));
    } catch (e: any) {
      const dup =
        e?.code === 11000 ? await Order.findOne({ quotationId: q._id }) : null;
      if (!dup) throw e;
      return ok(
        res,
        { orderId: dup._id, jobCode: dup.jobCode, replayed: true },
        "Quotation already converted",
      );
    }
    q.status = "converted";
    q.convertedOrderId = order._id;
    q.history.push({
      status: "converted",
      by: a.userId,
      at: new Date(),
      note: `Order ${order.jobCode}`,
    } as any);
    await q.save();
    await audit(
      a,
      "quotation.converted",
      "Quotation",
      q._id,
      { orderId: String(order._id) },
      req,
    );
    created(
      res,
      { orderId: order._id, jobCode: order.jobCode, replayed: false },
      "Order created from quotation",
    );
  }),
);

export default router;
