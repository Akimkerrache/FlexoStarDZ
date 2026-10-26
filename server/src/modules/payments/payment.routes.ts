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
import { nextCode } from "../../database/index.js";
import { authenticate } from "../../middleware/index.js";
import { audit } from "../audit-logs/audit.service.js";
import { FileAsset } from "../files/file.model.js";
import { Invoice, Payment } from "../invoices/invoice.model.js";

const router = Router();
router.use(authenticate);

const manage = (a: AuthContext) => can(a, "finance.manage");
const scope = (a: AuthContext) =>
  can(a, "finance.view") || manage(a)
    ? {}
    : a.role === "client" && a.clientId
      ? { clientId: a.clientId, direction: "in", status: "recorded" }
      : null;

const input = z.object({
  invoiceId: objectId,
  amountMinor: z.number().int().positive(),
  paymentDate: z.coerce.date(),
  method: z.enum(["cash", "bank_transfer", "cheque", "card", "other"]),
  reference: z.string().trim().min(1).max(100).optional(),
  notes: z.string().max(1000).optional(),
  proofFileId: objectId.optional(),
});

router.get(
  "/",
  validate({
    query: paginationQuery.extend({
      invoiceId: objectId.optional(),
      clientId: objectId.optional(),
      supplierId: objectId.optional(),
      direction: z.enum(["in", "out"]).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const s = scope(a);
    if (!s) throw ApiError.forbidden();
    const q = req.validated!.query;
    const filter: any = { ...s };
    if (q.invoiceId) filter.invoiceId = q.invoiceId;
    if (a.role !== "client") {
      if (q.clientId) filter.clientId = q.clientId;
      if (q.supplierId) filter.supplierId = q.supplierId;
      if (q.direction) filter.direction = q.direction;
    }
    const { items, meta } = await paginate(Payment, filter, q, {
      allowedSort: ["paymentDate", "amountMinor", "createdAt"],
      populate: { path: "invoiceId", select: "number type" },
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
    const rawKey = req.get("idempotency-key");
    const idempotencyKey =
      rawKey && /^[A-Za-z0-9_-]{8,100}$/.test(rawKey) ? rawKey : undefined;
    if (idempotencyKey) {
      const prev = await Payment.findOne({
        createdBy: a.userId,
        idempotencyKey,
      });
      if (prev) return ok(res, prev, "Payment already recorded");
    }
    const inv = await Invoice.findById(b.invoiceId);
    if (!inv || !["issued", "partially_paid", "overdue"].includes(inv.status))
      throw ApiError.unprocessable(
        "Payments can only be recorded on issued, unpaid invoices",
        "INVOICE_NOT_PAYABLE",
      );
    if (
      b.reference &&
      (await Payment.exists({ invoiceId: inv._id, reference: b.reference }))
    )
      throw ApiError.conflict(
        "A payment with this reference already exists for the invoice",
        "DUPLICATE_PAYMENT",
      );
    if (!b.reference) {
      // Without a reference, an identical payment recorded moments ago is almost certainly a double submit.
      const dup = await Payment.exists({
        invoiceId: inv._id,
        amountMinor: b.amountMinor,
        method: b.method,
        paymentDate: b.paymentDate,
        createdBy: a.userId,
        status: "recorded",
        createdAt: { $gt: new Date(Date.now() - 120_000) },
      });
      if (dup)
        throw ApiError.conflict(
          "An identical payment was just recorded. Add a reference if this is intentional.",
          "DUPLICATE_PAYMENT",
        );
    }
    if (
      b.proofFileId &&
      !(await FileAsset.exists({ _id: b.proofFileId, uploadState: "ready" }))
    )
      throw ApiError.unprocessable(
        "Proof file does not exist",
        "INVALID_REFERENCE",
      );

    // Conditional atomic increment: concurrent payments can never push the balance past zero.
    const updated = await Invoice.findOneAndUpdate(
      {
        _id: inv._id,
        status: { $in: ["issued", "partially_paid", "overdue"] },
        $expr: {
          $lte: [
            { $add: ["$amountPaidMinor", b.amountMinor] },
            "$grandTotalMinor",
          ],
        },
      },
      { $inc: { amountPaidMinor: b.amountMinor } },
      { new: true },
    );
    if (!updated) {
      const outstanding = inv.grandTotalMinor - inv.amountPaidMinor;
      throw ApiError.unprocessable(
        `Payment exceeds the outstanding balance (${outstanding})`,
        "OVERPAYMENT",
      );
    }
    const balance = updated.grandTotalMinor - updated.amountPaidMinor;
    let payment;
    try {
      payment = await Payment.create({
        ...b,
        number: await nextCode("PAY"),
        idempotencyKey,
        direction: inv.type === "client" ? "in" : "out",
        clientId: inv.clientId,
        supplierId: inv.supplierId,
        currency: inv.currency,
        classification: balance === 0 ? "full" : "partial",
        balanceAfterMinor: balance,
        createdBy: a.userId,
        updatedBy: a.userId,
      });
    } catch (e) {
      await Invoice.updateOne(
        { _id: inv._id },
        { $inc: { amountPaidMinor: -b.amountMinor } },
      );
      throw e;
    }
    updated.status = balance === 0 ? "paid" : "partially_paid";
    updated.history.push({
      action: "payment",
      by: a.userId,
      at: new Date(),
      details: { paymentId: payment._id, amountMinor: b.amountMinor },
    } as any);
    await updated.save();
    await audit(
      a,
      "payment.recorded",
      "Payment",
      payment._id,
      {
        invoiceId: String(inv._id),
        amountMinor: b.amountMinor,
        classification: payment.classification,
      },
      req,
    );
    created(res, payment, "Payment recorded");
  }),
);

router.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const s = scope(a);
    if (!s) throw ApiError.forbidden();
    const p = await Payment.findOne({ ...s, _id: req.params.id });
    if (!p) throw ApiError.notFound("Payment not found");
    ok(res, p);
  }),
);

// Corrections are explicit, admin-only and audited; the original record is kept (voided), never deleted.
router.post(
  "/:id/void",
  validate({
    params: idParams,
    body: z.object({ reason: z.string().trim().min(3).max(500) }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (a.role !== "admin")
      throw ApiError.forbidden("Only an administrator can void a payment");
    const p = await Payment.findOneAndUpdate(
      { _id: req.params.id, status: "recorded" },
      {
        status: "voided",
        voidedAt: new Date(),
        voidedBy: a.userId,
        voidReason: req.validated!.body.reason,
      },
      { new: true },
    );
    if (!p)
      throw ApiError.unprocessable(
        "Payment not found or already voided",
        "INVALID_STATE",
      );
    if (p.reference) {
      p.voidedReference = p.reference;
      p.reference = undefined;
      await p.save();
    }
    const inv = await Invoice.findByIdAndUpdate(
      p.invoiceId,
      { $inc: { amountPaidMinor: -p.amountMinor } },
      { new: true },
    );
    if (inv && inv.status !== "cancelled") {
      inv.status =
        inv.amountPaidMinor <= 0
          ? "issued"
          : inv.amountPaidMinor >= inv.grandTotalMinor
            ? "paid"
            : "partially_paid";
      inv.history.push({
        action: "payment_voided",
        by: a.userId,
        at: new Date(),
        details: { paymentId: p._id },
      } as any);
      await inv.save();
    }
    await audit(
      a,
      "payment.voided",
      "Payment",
      p._id,
      { reason: req.validated!.body.reason },
      req,
    );
    ok(res, p, "Payment voided");
  }),
);

export default router;
