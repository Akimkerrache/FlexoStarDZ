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
import { nextCode } from "../../database/index.js";
import { authenticate } from "../../middleware/index.js";
import { audit } from "../audit-logs/audit.service.js";
import { Order } from "../orders/order.model.js";
import { recomputeOrderCosts } from "../orders/order.service.js";
import { ProductionOperation } from "../production/production.routes.js";
import { Supplier } from "../suppliers/supplier.routes.js";
import { Expense } from "../invoices/invoice.model.js";
import { env } from "../../config/env.js";

const router = Router();
router.use(authenticate);

const manage = (a: AuthContext) => can(a, "finance.manage");
const read = (a: AuthContext) => manage(a) || can(a, "finance.view");

const input = z.object({
  category: z.string().trim().min(1).max(60),
  amountMinor: z.number().int().positive(),
  date: z.coerce.date(),
  supplierId: objectId.optional(),
  payee: z.string().trim().max(200).optional(),
  orderId: objectId.optional(),
  productionOperationId: objectId.optional(),
  documentFileId: objectId.optional(),
  notes: z.string().max(2000).optional(),
});

async function refs(b: Partial<z.infer<typeof input>>) {
  if (b.supplierId && !(await Supplier.exists({ _id: b.supplierId })))
    throw ApiError.unprocessable(
      "Supplier does not exist",
      "INVALID_REFERENCE",
    );
  if (b.orderId && !(await Order.exists({ _id: b.orderId })))
    throw ApiError.unprocessable("Order does not exist", "INVALID_REFERENCE");
  if (b.productionOperationId) {
    const op = await ProductionOperation.findById(
      b.productionOperationId,
    ).select("orderId");
    if (!op)
      throw ApiError.unprocessable(
        "Operation does not exist",
        "INVALID_REFERENCE",
      );
    if (b.orderId && String(op.orderId) !== b.orderId)
      throw ApiError.unprocessable(
        "Operation belongs to another order",
        "INVALID_REFERENCE",
      );
  }
}

router.get(
  "/",
  validate({
    query: paginationQuery.extend({
      category: z.string().max(60).optional(),
      orderId: objectId.optional(),
      supplierId: objectId.optional(),
      dateFrom: z.coerce.date().optional(),
      dateTo: z.coerce.date().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!read(a)) throw ApiError.forbidden();
    const q = req.validated!.query;
    const filter: any = { archivedAt: null };
    for (const k of ["category", "orderId", "supplierId"] as const)
      if (q[k]) filter[k] = q[k];
    if (q.dateFrom || q.dateTo)
      filter.date = {
        ...(q.dateFrom && { $gte: q.dateFrom }),
        ...(q.dateTo && { $lte: q.dateTo }),
      };
    if (q.search)
      filter.$or = [
        { number: new RegExp(escapeRegex(q.search), "i") },
        { payee: new RegExp(escapeRegex(q.search), "i") },
      ];
    const { items, meta } = await paginate(Expense, filter, q, {
      allowedSort: ["date", "amountMinor", "category", "createdAt"],
    });
    ok(res, items, "OK", meta);
  }),
);

router.post(
  "/",
  validate({ body: input }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const b = req.validated!.body;
    await refs(b);
    let orderId = b.orderId;
    if (b.productionOperationId && !orderId)
      orderId = String(
        (await ProductionOperation.findById(b.productionOperationId).select(
          "orderId",
        ))!.orderId,
      );
    const e = await Expense.create({
      ...b,
      orderId,
      number: await nextCode("EXP"),
      currency: env.DEFAULT_CURRENCY,
      createdBy: a.userId,
      updatedBy: a.userId,
    });
    if (orderId) await recomputeOrderCosts(orderId);
    await audit(
      a,
      "expense.created",
      "Expense",
      e._id,
      { amountMinor: b.amountMinor, category: b.category },
      req,
    );
    created(res, e);
  }),
);

router.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    if (!read(requireAuth(req))) throw ApiError.forbidden();
    const e = await Expense.findById(req.params.id);
    if (!e) throw ApiError.notFound("Expense not found");
    ok(res, e);
  }),
);

router.patch(
  "/:id",
  validate({ params: idParams, body: input.partial().strict() }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const e = await Expense.findOne({ _id: req.params.id, archivedAt: null });
    if (!e) throw ApiError.notFound("Expense not found");
    await refs(req.validated!.body);
    const oldOrder = e.orderId;
    const before = e.amountMinor;
    e.set({ ...req.validated!.body, updatedBy: a.userId });
    await e.save();
    for (const o of new Set([oldOrder, e.orderId].filter(Boolean).map(String)))
      await recomputeOrderCosts(o);
    await audit(
      a,
      "expense.updated",
      "Expense",
      e._id,
      { amountBefore: before, amountAfter: e.amountMinor },
      req,
    );
    ok(res, e, "Updated");
  }),
);

router.post(
  "/:id/archive",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!manage(a)) throw ApiError.forbidden();
    const e = await Expense.findOneAndUpdate(
      { _id: req.params.id, archivedAt: null },
      { archivedAt: new Date(), updatedBy: a.userId },
      { new: true },
    );
    if (!e) throw ApiError.notFound("Expense not found");
    if (e.orderId) await recomputeOrderCosts(e.orderId);
    await audit(a, "expense.archived", "Expense", e._id, {}, req);
    ok(res, e, "Archived");
  }),
);

export default router;
