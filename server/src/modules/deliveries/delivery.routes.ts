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
  nextCode,
} from "../../database/index.js";
import { authenticate } from "../../middleware/index.js";
import { audit } from "../audit-logs/audit.service.js";
import { Order } from "../orders/order.model.js";
import { transitionOrder } from "../orders/order.service.js";
import { addressDef, addressSchema } from "../clients/client.model.js";
import { FileAsset } from "../files/file.model.js";
import { notifyClient } from "../notifications/notification.service.js";

export const DELIVERY_STATUSES = [
  "planned",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
] as const;
const NEXT: Record<string, string[]> = {
  planned: ["in_transit", "delivered", "cancelled"],
  in_transit: ["delivered", "failed"],
  failed: ["planned", "cancelled"],
  delivered: [],
  cancelled: [],
};

const deliverySchema = makeSchema({
  reference: { type: String, required: true, unique: true },
  orderId: { type: ObjectId, ref: "Order", required: true, index: true },
  clientId: { type: ObjectId, ref: "Client", required: true, index: true },
  address: addressDef,
  lines: [
    new mongoose.Schema(
      {
        lineItemId: ObjectId,
        description: String,
        quantity: { type: Number, min: 0 },
      },
      { _id: false },
    ),
  ],
  plannedDate: Date,
  actualDate: Date,
  carrier: String,
  status: {
    type: String,
    enum: DELIVERY_STATUSES,
    default: "planned",
    index: true,
  },
  trackingRef: String,
  trackingUrl: String,
  proofFileId: { type: ObjectId, ref: "FileAsset" },
  /** Only meaningful for orders without line items: marks that this delivery completes the order. */
  completesOrder: { type: Boolean, default: false },
  incidents: [
    new mongoose.Schema(
      { text: String, by: ObjectId, byName: String, at: Date },
      { _id: true },
    ),
  ],
  notes: String,
  ...auditFields,
});
export const Delivery = mongoose.model<any>("Delivery", deliverySchema);

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), "Only https links are allowed");
const input = z.object({
  orderId: objectId,
  address: addressSchema.optional(),
  lines: z
    .array(
      z.object({
        lineItemId: objectId.optional(),
        description: z.string().trim().max(300).optional(),
        quantity: z.number().positive(),
      }),
    )
    .max(100)
    .default([]),
  plannedDate: z.coerce.date().optional(),
  carrier: z.string().trim().max(120).optional(),
  trackingRef: z.string().trim().max(100).optional(),
  trackingUrl: httpsUrl.optional(),
  completesOrder: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

const manage = (a: AuthContext) => can(a, "deliveries.manage");
const scope = (a: AuthContext) =>
  manage(a)
    ? {}
    : a.role === "client" && a.clientId
      ? { clientId: a.clientId }
      : null;
const view = (d: any, a: AuthContext) => {
  const o = d.toJSON();
  if (a.role === "client") delete o.incidents;
  return o;
};

const router = Router();
router.use(authenticate);

router.get(
  "/",
  validate({
    query: paginationQuery.extend({
      orderId: objectId.optional(),
      clientId: objectId.optional(),
      status: z.enum(DELIVERY_STATUSES).optional(),
      scheduled: z.enum(["true"]).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const s = scope(a);
    if (!s) throw ApiError.forbidden();
    const q = req.validated!.query;
    const filter: any = { ...s };
    for (const k of ["orderId", "status"] as const) if (q[k]) filter[k] = q[k];
    if (q.clientId && a.role !== "client") filter.clientId = q.clientId;
    if (q.scheduled) filter.status = { $in: ["planned", "in_transit"] };
    if (q.search) filter.reference = new RegExp(escapeRegex(q.search), "i");
    const { items, meta } = await paginate(Delivery, filter, q, {
      allowedSort: [
        "reference",
        "plannedDate",
        "actualDate",
        "status",
        "createdAt",
      ],
    });
    ok(
      res,
      items.map((d) => view(d, a)),
      "OK",
      meta,
    );
  }),
);

/** Quantity of a line already committed to deliveries that are not cancelled/failed. */
async function committed(
  orderId: unknown,
  lineId: string,
  excludeId?: unknown,
) {
  const rows = await Delivery.find({
    orderId,
    status: { $in: ["planned", "in_transit", "delivered"] },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).lean<any>();
  return rows
    .flatMap((d: any) => d.lines)
    .filter((l: any) => String(l.lineItemId) === lineId)
    .reduce((s: number, l: any) => s + l.quantity, 0);
}

async function validateLines(
  order: any,
  lines: z.infer<typeof input>["lines"],
  excludeId?: unknown,
) {
  if (order.lineItems.length && !lines.length)
    throw ApiError.unprocessable(
      "Select at least one order line to deliver",
      "LINES_REQUIRED",
    );
  const out = [];
  for (const l of lines) {
    const item = l.lineItemId ? order.lineItems.id(l.lineItemId) : undefined;
    if (order.lineItems.length && !item)
      throw ApiError.unprocessable(
        "Line does not belong to this order",
        "INVALID_REFERENCE",
      );
    if (item) {
      const remaining =
        item.quantity -
        (await committed(order._id, String(item._id), excludeId));
      if (l.quantity > remaining + 1e-9)
        throw ApiError.unprocessable(
          `Quantity exceeds the outstanding amount (${remaining}) for "${item.description}"`,
          "EXCEEDS_OUTSTANDING",
        );
    }
    out.push({
      lineItemId: l.lineItemId,
      description: item?.description ?? l.description,
      quantity: l.quantity,
    });
  }
  return out;
}

router.post(
  "/",
  validate({ body: input }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const b = req.validated!.body;
    const order = await Order.findById(b.orderId);
    if (!order)
      throw ApiError.unprocessable("Order does not exist", "INVALID_REFERENCE");
    if (
      ![
        "in_production",
        "packed",
        "in_transit",
        "partially_delivered",
      ].includes(order.status)
    ) {
      throw ApiError.unprocessable(
        `Orders in status "${order.status}" cannot be delivered`,
        "ORDER_NOT_DELIVERABLE",
      );
    }
    const lines = await validateLines(order, b.lines);
    const d = await Delivery.create({
      ...b,
      lines,
      clientId: order.clientId,
      reference: await nextCode("DEL"),
      createdBy: a.userId,
      updatedBy: a.userId,
    });
    await Order.updateOne(
      { _id: order._id },
      { $addToSet: { deliveryIds: d._id } },
    );
    await audit(
      a,
      "delivery.created",
      "Delivery",
      d._id,
      { orderId: b.orderId },
      req,
    );
    created(res, view(d, a));
  }),
);

const load = async (a: AuthContext, id: string) => {
  const s = scope(a);
  if (!s) throw ApiError.forbidden();
  const d = await Delivery.findOne({ ...s, _id: id });
  if (!d) throw ApiError.notFound("Delivery not found");
  return d;
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
      .extend({ proofFileId: objectId.optional() })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const d = await load(a, req.params.id);
    if (["delivered", "cancelled"].includes(d.status))
      throw ApiError.unprocessable(
        "Closed deliveries cannot be edited",
        "DELIVERY_CLOSED",
      );
    const b = req.validated!.body;
    if (b.lines)
      b.lines = (await validateLines(
        await Order.findById(d.orderId),
        b.lines,
        d._id,
      )) as any;
    if (
      b.proofFileId &&
      !(await FileAsset.exists({
        _id: b.proofFileId,
        deliveryId: d._id,
        uploadState: "ready",
      }))
    )
      throw ApiError.unprocessable(
        "Proof file must be uploaded to this delivery",
        "INVALID_REFERENCE",
      );
    d.set({ ...b, updatedBy: a.userId });
    await d.save();
    ok(res, view(d, a), "Updated");
  }),
);

router.post(
  "/:id/status",
  validate({
    params: idParams,
    body: z.object({
      status: z.enum(DELIVERY_STATUSES),
      actualDate: z.coerce.date().optional(),
      note: z.string().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const d = await load(a, req.params.id);
    const { status, actualDate, note } = req.validated!.body;
    if (!NEXT[d.status]?.includes(status))
      throw ApiError.unprocessable(
        `Transition ${d.status} -> ${status} is not allowed`,
        "TRANSITION_NOT_ALLOWED",
      );
    d.status = status;
    if (status === "delivered") d.actualDate = actualDate ?? new Date();
    if (note)
      d.incidents.push({
        text: note,
        by: a.userId,
        byName: a.name,
        at: new Date(),
      } as any);
    await d.save();

    if (status === "delivered") {
      const order = await Order.findById(d.orderId);
      if (order) {
        for (const l of d.lines) {
          const item = l.lineItemId
            ? (order.lineItems as any).id(l.lineItemId)
            : undefined;
          if (item) item.deliveredQuantity += l.quantity;
        }
        await order.save();
        const hasLines = order.lineItems.length > 0;
        const complete = hasLines
          ? order.lineItems.every((i: any) => i.deliveredQuantity >= i.quantity)
          : !!d.completesOrder;
        // Only mark the order fully delivered when every ordered quantity has actually been delivered.
        if (!["partially_delivered", "delivered"].includes(order.status))
          await transitionOrder(order, "partially_delivered", "system", {
            note: `Delivery ${d.reference}`,
          });
        if (complete && order.status !== "delivered")
          await transitionOrder(order, "delivered", "system", {
            note: `Delivery ${d.reference}`,
          });
      }
      await notifyClient(d.clientId, {
        type: "delivery_expected",
        title: `Delivery ${d.reference} delivered`,
        link: "/deliveries",
      });
    }
    await audit(
      a,
      "delivery.status_changed",
      "Delivery",
      d._id,
      { to: status },
      req,
    );
    ok(res, view(d, a), "Status updated");
  }),
);

router.get(
  "/:id/outstanding",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const d = await load(a, req.params.id);
    const order = await Order.findById(d.orderId);
    ok(
      res,
      (order?.lineItems ?? []).map((l: any) => ({
        lineItemId: String(l._id),
        description: l.description,
        ordered: l.quantity,
        delivered: l.deliveredQuantity,
        outstanding: Math.max(0, l.quantity - l.deliveredQuantity),
      })),
    );
  }),
);

export default router;
