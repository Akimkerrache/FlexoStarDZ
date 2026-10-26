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
import { nextSequence } from "../../database/index.js";
import { authenticate } from "../../middleware/index.js";
import { audit } from "../audit-logs/audit.service.js";
import { Client } from "../clients/client.model.js";
import { Supplier } from "../suppliers/supplier.routes.js";
import { Order } from "../orders/order.model.js";
import { transitionOrder } from "../orders/order.service.js";
import {
  commercialLineInput,
  priceCommercialLines,
} from "../shared/commercial.js";
import { notifyClient } from "../notifications/notification.service.js";
import { INVOICE_STATUSES, INVOICE_TYPES, Invoice } from "./invoice.model.js";

const router = Router();
router.use(authenticate);

export const canViewFinance = (a: AuthContext) =>
  can(a, "finance.view") || can(a, "finance.manage");
const manage = (a: AuthContext) => can(a, "finance.manage");

export const invoiceScope = (a: AuthContext) =>
  canViewFinance(a)
    ? {}
    : a.role === "client" && a.clientId
      ? { clientId: a.clientId, type: "client", status: { $nin: ["draft"] } }
      : null;

/** Stored status plus time-based overdue, so the UI is right even before the scheduled scan runs. */
export function effectiveStatus(inv: {
  status: string;
  dueDate?: Date | null;
}) {
  return ["issued", "partially_paid"].includes(inv.status) &&
    inv.dueDate &&
    inv.dueDate < new Date()
    ? "overdue"
    : inv.status;
}

function view(inv: any, a: AuthContext) {
  const o = inv.toJSON();
  o.status = effectiveStatus(o);
  o.outstandingMinor = Math.max(0, o.grandTotalMinor - o.amountPaidMinor);
  if (a.role === "client")
    o.lines = o.lines.map(({ unitCostMinor: _c, ...l }: any) => l);
  return o;
}

async function nextInvoiceNumber(type: "client" | "supplier") {
  const y = new Date().getFullYear();
  const prefix = type === "client" ? "INV" : "SINV";
  return `${prefix}-${y}-${String(await nextSequence(`invoice-${type}-${y}`)).padStart(5, "0")}`;
}

const input = z.object({
  type: z.enum(INVOICE_TYPES),
  clientId: objectId.optional(),
  supplierId: objectId.optional(),
  supplierInvoiceNumber: z.string().trim().max(60).optional(),
  orderIds: z.array(objectId).max(50).optional(),
  invoiceDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  lines: z.array(commercialLineInput).min(1).max(200),
  notes: z.string().max(3000).optional(),
});

router.get(
  "/",
  validate({
    query: paginationQuery.extend({
      type: z.enum(INVOICE_TYPES).optional(),
      status: z.enum(INVOICE_STATUSES).optional(),
      clientId: objectId.optional(),
      supplierId: objectId.optional(),
      orderId: objectId.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const s = invoiceScope(a);
    if (!s) throw ApiError.forbidden();
    const q = req.validated!.query;
    const filter: any = { ...s, archivedAt: null };
    if (q.type && a.role !== "client") filter.type = q.type;
    if (q.status === "overdue")
      Object.assign(filter, {
        status: { $in: ["issued", "partially_paid", "overdue"] },
        dueDate: { $lt: new Date() },
      });
    else if (q.status) filter.status = q.status;
    if (q.clientId && a.role !== "client") filter.clientId = q.clientId;
    if (q.supplierId && a.role !== "client") filter.supplierId = q.supplierId;
    if (q.orderId) filter.orderIds = q.orderId;
    if (q.search)
      filter.$or = [
        { number: new RegExp(escapeRegex(q.search), "i") },
        { supplierInvoiceNumber: new RegExp(escapeRegex(q.search), "i") },
      ];
    const { items, meta } = await paginate(Invoice, filter, q, {
      allowedSort: [
        "number",
        "invoiceDate",
        "dueDate",
        "status",
        "grandTotalMinor",
        "createdAt",
      ],
      populate: [
        { path: "clientId", select: "legalName code" },
        { path: "supplierId", select: "name code" },
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

router.post(
  "/",
  validate({ body: input }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const b = req.validated!.body;
    let dueDate = b.dueDate;
    if (b.type === "client") {
      if (!b.clientId)
        throw ApiError.unprocessable("Client is required", "CLIENT_REQUIRED");
      const client = await Client.findOne({
        _id: b.clientId,
        isActive: true,
      }).lean<any>();
      if (!client)
        throw ApiError.unprocessable(
          "Client does not exist",
          "INVALID_REFERENCE",
        );
      if (
        b.orderIds?.length &&
        (await Order.countDocuments({
          _id: { $in: b.orderIds },
          clientId: b.clientId,
        })) !== new Set(b.orderIds).size
      ) {
        throw ApiError.unprocessable(
          "Orders must belong to the invoiced client",
          "INVALID_REFERENCE",
        );
      }
      if (!dueDate && client.commercial?.paymentTermsDays != null)
        dueDate = new Date(
          (b.invoiceDate ?? new Date()).getTime() +
            client.commercial.paymentTermsDays * 86400000,
        );
    } else {
      if (
        !b.supplierId ||
        !(await Supplier.exists({ _id: b.supplierId, isActive: true }))
      )
        throw ApiError.unprocessable(
          "Supplier does not exist",
          "INVALID_REFERENCE",
        );
    }
    const { lines, ...totals } = priceCommercialLines(b.lines);
    const inv = await Invoice.create({
      ...b,
      dueDate,
      lines,
      ...totals,
      currency: env.DEFAULT_CURRENCY,
      // Supplier invoices are records of received documents: they are issued immediately.
      status: b.type === "supplier" ? "issued" : "draft",
      number:
        b.type === "supplier" ? await nextInvoiceNumber("supplier") : undefined,
      history: [{ action: "created", by: a.userId, at: new Date() }],
      createdBy: a.userId,
      updatedBy: a.userId,
    });
    if (b.type === "supplier" && b.orderIds?.length)
      await Order.updateMany(
        { _id: { $in: b.orderIds } },
        { $addToSet: { invoiceIds: inv._id } },
      );
    await audit(
      a,
      "invoice.created",
      "Invoice",
      inv._id,
      { type: b.type, total: totals.grandTotalMinor },
      req,
    );
    created(res, view(inv, a));
  }),
);

const load = async (a: AuthContext, id: string) => {
  const s = invoiceScope(a);
  if (!s) throw ApiError.forbidden();
  const inv = await Invoice.findOne({ ...s, _id: id });
  if (!inv) throw ApiError.notFound("Invoice not found");
  return inv;
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
      .omit({ type: true, clientId: true, supplierId: true })
      .partial()
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const inv = await load(a, req.params.id);
    const { lines, ...rest } = req.validated!.body;
    if (inv.status !== "draft") {
      // Issued invoices are immutable except for notes.
      const forbidden = Object.keys(req.validated!.body).filter(
        (k) => k !== "notes",
      );
      if (forbidden.length)
        throw ApiError.unprocessable(
          "Issued invoices cannot be modified",
          "INVOICE_LOCKED",
        );
    }
    inv.set({ ...rest, updatedBy: a.userId });
    if (lines) inv.set(priceCommercialLines(lines));
    inv.history.push({
      action: "updated",
      by: a.userId,
      at: new Date(),
      details: { fields: Object.keys(req.validated!.body) },
    } as any);
    await inv.save();
    await audit(
      a,
      "invoice.updated",
      "Invoice",
      inv._id,
      { fields: Object.keys(req.validated!.body), total: inv.grandTotalMinor },
      req,
    );
    ok(res, view(inv, a), "Updated");
  }),
);

router.post(
  "/:id/issue",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    // Atomic claim prevents two concurrent issues from both numbering the invoice.
    const claimed = await Invoice.findOneAndUpdate(
      { _id: req.params.id, status: "draft", type: "client", number: null },
      {
        status: "issued",
        number: await nextInvoiceNumber("client"),
        invoiceDate: new Date(),
        updatedBy: a.userId,
      },
      { new: true },
    );
    if (!claimed)
      throw ApiError.unprocessable(
        "Only draft client invoices can be issued",
        "INVALID_STATE",
      );
    claimed.history.push({
      action: "issued",
      by: a.userId,
      at: new Date(),
    } as any);
    await claimed.save();
    if (claimed.orderIds.length) {
      await Order.updateMany(
        { _id: { $in: claimed.orderIds } },
        { $addToSet: { invoiceIds: claimed._id } },
      );
      for (const o of await Order.find({
        _id: { $in: claimed.orderIds },
        status: "delivered",
      }))
        await transitionOrder(o, "invoiced", "system", {
          note: `Invoice ${claimed.number}`,
        });
    }
    await audit(
      a,
      "invoice.issued",
      "Invoice",
      claimed._id,
      { number: claimed.number, total: claimed.grandTotalMinor },
      req,
    );
    await notifyClient(claimed.clientId, {
      type: "invoice_unpaid",
      title: `Invoice ${claimed.number} issued`,
      link: "/invoices",
    });
    ok(res, view(claimed, a), "Invoice issued");
  }),
);

router.post(
  "/:id/cancel",
  validate({
    params: idParams,
    body: z.object({ reason: z.string().trim().min(3).max(500) }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const inv = await load(a, req.params.id);
    if (inv.status === "cancelled")
      throw ApiError.unprocessable("Already cancelled", "INVALID_STATE");
    if (inv.amountPaidMinor > 0)
      throw ApiError.unprocessable(
        "Invoices with recorded payments cannot be cancelled; void the payments first",
        "HAS_PAYMENTS",
      );
    inv.status = "cancelled";
    inv.history.push({
      action: "cancelled",
      by: a.userId,
      at: new Date(),
      details: { reason: req.validated!.body.reason },
    } as any);
    await inv.save();
    await audit(
      a,
      "invoice.cancelled",
      "Invoice",
      inv._id,
      { reason: req.validated!.body.reason },
      req,
    );
    ok(res, view(inv, a), "Invoice cancelled");
  }),
);

export default router;
