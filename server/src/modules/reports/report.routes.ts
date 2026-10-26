import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { can } from "../../config/permissions.js";
import {
  ApiError,
  asyncHandler,
  objectId,
  requireAuth,
  ok,
  validate,
  idParams,
} from "../../utils/http.js";
import { authenticate } from "../../middleware/index.js";
import { audit } from "../audit-logs/audit.service.js";
import { Client } from "../clients/client.model.js";
import { Printer } from "../printers/printer.routes.js";
import { Order } from "../orders/order.model.js";
import { FINAL_STATUSES } from "../orders/order.rules.js";
import { orderScope } from "../orders/order.service.js";
import { toOrderView } from "../orders/order.routes.js";
import { Quotation } from "../quotations/quotation.routes.js";
import { Delivery } from "../deliveries/delivery.routes.js";
import { ProductionOperation } from "../production/production.routes.js";
import { Expense, Invoice, Payment } from "../invoices/invoice.model.js";
import {
  canViewFinance,
  invoiceScope,
  effectiveStatus,
} from "../invoices/invoice.routes.js";
import { money, renderPdf, toCsv } from "../../utils/pdf.js";

const oid = (v?: string) => (v ? new mongoose.Types.ObjectId(v) : undefined);
const router = Router();
router.use(authenticate);

const rangeQuery = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  clientId: objectId.optional(),
  status: z.string().max(40).optional(),
});

const sumBy = async (model: mongoose.Model<any>, match: any, field: string) =>
  (
    await model.aggregate([
      { $match: match },
      { $group: { _id: null, t: { $sum: `$${field}` } } },
    ])
  )[0]?.t ?? 0;
const dateMatch = (field: string, from?: Date, to?: Date) =>
  from || to
    ? { [field]: { ...(from && { $gte: from }), ...(to && { $lte: to }) } }
    : {};

async function ordersByStatus(match: any) {
  const rows = await Order.aggregate([
    { $match: match },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.count]));
}

const IN_PROGRESS = [
  "approved",
  "plate_processing",
  "in_production",
  "packed",
  "in_transit",
  "partially_delivered",
];

async function monthlyOrders(match: any) {
  const rows = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 24 },
  ]);
  return rows.map((r) => ({ month: r._id, count: r.count }));
}

router.get(
  "/dashboard",
  validate({ query: rangeQuery }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const q = req.validated!.query;
    const created = dateMatch("createdAt", q.dateFrom, q.dateTo);

    if (a.role === "client") {
      const clientId = oid(a.clientId);
      if (!clientId) throw ApiError.forbidden();
      const match = { clientId, ...created };
      const [byStatus, monthly, inv, deliveries] = await Promise.all([
        ordersByStatus(match),
        monthlyOrders(match),
        Invoice.aggregate([
          {
            $match: {
              clientId,
              type: "client",
              status: { $nin: ["draft", "cancelled"] },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$grandTotalMinor" },
              paid: { $sum: "$amountPaidMinor" },
            },
          },
        ]),
        Delivery.countDocuments({
          clientId,
          status: { $in: ["planned", "in_transit"] },
        }),
      ]);
      return ok(res, {
        scope: "client",
        ordersByStatus: byStatus,
        ordersOverTime: monthly,
        scheduledDeliveries: deliveries,
        outstandingMinor: (inv[0]?.total ?? 0) - (inv[0]?.paid ?? 0),
      });
    }
    if (a.role === "printer") {
      const printerId = oid(a.printerId);
      if (!printerId) throw ApiError.forbidden();
      const match = { assignedPrinterId: printerId, ...created };
      const [byStatus, monthly, ops] = await Promise.all([
        ordersByStatus(match),
        monthlyOrders(match),
        ProductionOperation.aggregate([
          { $match: { printerId, archivedAt: null } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
      ]);
      return ok(res, {
        scope: "printer",
        ordersByStatus: byStatus,
        ordersOverTime: monthly,
        operationsByStatus: Object.fromEntries(
          ops.map((r: any) => [r._id, r.count]),
        ),
      });
    }
    if (
      !(a.role === "admin" || can(a, "reports.view") || can(a, "orders.view"))
    )
      throw ApiError.forbidden();

    const orderMatch: any = { ...created };
    if (q.clientId) orderMatch.clientId = oid(q.clientId);
    if (q.status) orderMatch.status = q.status;
    const now = new Date();
    const [
      clientsTotal,
      clientsActive,
      printersActive,
      byStatus,
      delayed,
      blockedOps,
      quotesAwaiting,
      deliveriesScheduled,
      monthly,
      myOps,
    ] = await Promise.all([
      Client.countDocuments({ archivedAt: null }),
      Client.countDocuments({ isActive: true, archivedAt: null }),
      Printer.countDocuments({ isActive: true, archivedAt: null }),
      ordersByStatus(orderMatch),
      Order.countDocuments({
        ...orderMatch,
        requestedDeliveryDate: { $lt: now },
        status: { $nin: q.status ? [] : FINAL_STATUSES },
      }),
      ProductionOperation.countDocuments({
        status: "blocked",
        archivedAt: null,
      }),
      Quotation.countDocuments({ status: "sent" }),
      Delivery.countDocuments({ status: { $in: ["planned", "in_transit"] } }),
      monthlyOrders(orderMatch),
      ProductionOperation.aggregate([
        { $match: { archivedAt: null } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);
    const data: any = {
      scope: "staff",
      clients: { total: clientsTotal, active: clientsActive },
      printersActive,
      ordersByStatus: byStatus,
      ordersInProgress: IN_PROGRESS.reduce((s, k) => s + (byStatus[k] ?? 0), 0),
      ordersAwaitingApproval: byStatus.under_approval ?? 0,
      ordersDelayed: delayed,
      blockedOperations: blockedOps,
      operationsByStatus: Object.fromEntries(
        myOps.map((r: any) => [r._id, r.count]),
      ),
      quotationsAwaitingResponse: quotesAwaiting,
      deliveriesScheduled,
      ordersOverTime: monthly,
    };

    if (canViewFinance(a)) {
      const invRange = dateMatch("invoiceDate", q.dateFrom, q.dateTo);
      const clientInv = {
        type: "client",
        status: { $nin: ["draft", "cancelled"] },
        ...(q.clientId ? { clientId: oid(q.clientId) } : {}),
      };
      const supInv = {
        type: "supplier",
        status: { $nin: ["draft", "cancelled"] },
      };
      const [
        recv,
        pay,
        revenue,
        paymentsIn,
        paymentsOut,
        expenses,
        margins,
        topClients,
        topItems,
        supplierPerf,
      ] = await Promise.all([
        Invoice.aggregate([
          { $match: clientInv },
          {
            $group: {
              _id: null,
              t: {
                $sum: { $subtract: ["$grandTotalMinor", "$amountPaidMinor"] },
              },
            },
          },
        ]),
        Invoice.aggregate([
          { $match: supInv },
          {
            $group: {
              _id: null,
              t: {
                $sum: { $subtract: ["$grandTotalMinor", "$amountPaidMinor"] },
              },
            },
          },
        ]),
        Invoice.aggregate([
          { $match: { ...clientInv, ...invRange } },
          {
            $group: {
              _id: null,
              t: {
                $sum: { $subtract: ["$grandTotalMinor", "$taxTotalMinor"] },
              },
            },
          },
        ]),
        sumBy(
          Payment,
          {
            direction: "in",
            status: "recorded",
            ...dateMatch("paymentDate", q.dateFrom, q.dateTo),
            ...(q.clientId ? { clientId: oid(q.clientId) } : {}),
          },
          "amountMinor",
        ),
        sumBy(
          Payment,
          {
            direction: "out",
            status: "recorded",
            ...dateMatch("paymentDate", q.dateFrom, q.dateTo),
          },
          "amountMinor",
        ),
        sumBy(
          Expense,
          { archivedAt: null, ...dateMatch("date", q.dateFrom, q.dateTo) },
          "amountMinor",
        ),
        Order.aggregate([
          {
            $match: {
              ...orderMatch,
              status: { $ne: "cancelled" },
              grandTotalMinor: { $gt: 0 },
            },
          },
          {
            $group: {
              _id: null,
              net: {
                $sum: { $subtract: ["$grandTotalMinor", "$taxTotalMinor"] },
              },
              estCost: { $sum: "$estimatedCostMinor" },
              actCost: { $sum: "$actualCostMinor" },
              withActual: {
                $sum: {
                  $cond: [
                    { $gt: ["$actualCostMinor", 0] },
                    { $subtract: ["$grandTotalMinor", "$taxTotalMinor"] },
                    0,
                  ],
                },
              },
            },
          },
        ]),
        Order.aggregate([
          { $match: { ...orderMatch, status: { $ne: "cancelled" } } },
          {
            $group: {
              _id: "$clientId",
              revenueMinor: {
                $sum: { $subtract: ["$grandTotalMinor", "$taxTotalMinor"] },
              },
              orders: { $sum: 1 },
            },
          },
          { $sort: { revenueMinor: -1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: "clients",
              localField: "_id",
              foreignField: "_id",
              as: "c",
            },
          },
          {
            $project: {
              revenueMinor: 1,
              orders: 1,
              name: { $arrayElemAt: ["$c.legalName", 0] },
            },
          },
        ]),
        Order.aggregate([
          { $match: { ...orderMatch, status: { $ne: "cancelled" } } },
          { $unwind: "$lineItems" },
          { $match: { "lineItems.catalogItemId": { $ne: null } } },
          {
            $group: {
              _id: "$lineItems.catalogItemId",
              revenueMinor: { $sum: "$lineItems.totalMinor" },
              quantity: { $sum: "$lineItems.quantity" },
            },
          },
          { $sort: { revenueMinor: -1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: "catalogitems",
              localField: "_id",
              foreignField: "_id",
              as: "i",
            },
          },
          {
            $project: {
              revenueMinor: 1,
              quantity: 1,
              name: { $arrayElemAt: ["$i.name", 0] },
            },
          },
        ]),
        ProductionOperation.aggregate([
          { $match: { supplierId: { $ne: null }, archivedAt: null } },
          {
            $group: {
              _id: "$supplierId",
              operations: { $sum: 1 },
              delayed: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $lt: ["$plannedEnd", now] },
                        {
                          $not: [
                            { $in: ["$status", ["completed", "cancelled"]] },
                          ],
                        },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              nonConformities: { $sum: { $size: "$nonConformities" } },
            },
          },
          { $sort: { nonConformities: -1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: "suppliers",
              localField: "_id",
              foreignField: "_id",
              as: "s",
            },
          },
          {
            $project: {
              operations: 1,
              delayed: 1,
              nonConformities: 1,
              name: { $arrayElemAt: ["$s.name", 0] },
            },
          },
        ]),
      ]);
      const m = margins[0];
      data.finance = {
        receivablesMinor: recv[0]?.t ?? 0,
        payablesMinor: pay[0]?.t ?? 0,
        revenueMinor: revenue[0]?.t ?? 0,
        paymentsReceivedMinor: paymentsIn,
        paymentsMadeMinor: paymentsOut,
        expensesMinor: expenses,
        estimatedMarginMinor: m ? m.net - m.estCost : 0,
        // Actual margin only covers orders that already have recorded actual costs.
        actualMarginMinor: m ? m.withActual - m.actCost : 0,
        topClients,
        topProducts: topItems,
        supplierPerformance: supplierPerf,
      };
    }
    ok(res, data);
  }),
);

// ---- CSV exports (always limited to the caller's authorisation scope) ----
const EXPORT_LIMIT = 10_000;
router.get(
  "/export/:resource",
  validate({
    params: z.object({
      resource: z.enum([
        "orders",
        "invoices",
        "payments",
        "expenses",
        "clients",
      ]),
    }),
    query: rangeQuery,
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const { resource } = req.params as { resource: string };
    const q = req.validated!.query;
    let headers: string[] = [];
    let rows: unknown[][] = [];
    const dr = (f: string) => dateMatch(f, q.dateFrom, q.dateTo);

    if (resource === "orders") {
      const s = orderScope(a);
      if (!s) throw ApiError.forbidden();
      const docs = await Order.find({
        ...s,
        ...dr("createdAt"),
        ...(q.clientId && a.role !== "client" ? { clientId: q.clientId } : {}),
        ...(q.status ? { status: q.status } : {}),
      })
        .populate([
          { path: "clientId", select: "legalName" },
          { path: "machineId", select: "name" },
        ])
        .sort({ createdAt: -1 })
        .limit(EXPORT_LIMIT);
      const views = docs.map((d) => toOrderView(d, a));
      const money_ = views.some((v) => v.grandTotalMinor !== undefined);
      headers = [
        "Job code",
        "Job name",
        ...(a.role !== "printer" ? ["Client"] : []),
        "Machine",
        "Status",
        "Requested delivery",
        "Created",
        ...(money_ ? ["Total (minor units)"] : []),
      ];
      rows = views.map((v) => [
        v.jobCode,
        v.jobName,
        ...(a.role !== "printer" ? [v.client?.legalName] : []),
        v.machine?.name,
        v.status,
        v.requestedDeliveryDate,
        v.createdAt,
        ...(money_ ? [v.grandTotalMinor] : []),
      ]);
    } else if (resource === "invoices") {
      const s = invoiceScope(a);
      if (!s) throw ApiError.forbidden();
      const docs = await Invoice.find({
        ...s,
        ...dr("invoiceDate"),
        archivedAt: null,
      })
        .populate("clientId supplierId", "legalName name")
        .sort({ invoiceDate: -1 })
        .limit(EXPORT_LIMIT);
      headers = [
        "Number",
        "Type",
        "Party",
        "Date",
        "Due",
        "Status",
        "Total (minor units)",
        "Paid (minor units)",
        "Outstanding (minor units)",
      ];
      rows = docs.map((d: any) => [
        d.number,
        d.type,
        d.clientId?.legalName ?? d.supplierId?.name,
        d.invoiceDate,
        d.dueDate,
        effectiveStatus(d),
        d.grandTotalMinor,
        d.amountPaidMinor,
        d.grandTotalMinor - d.amountPaidMinor,
      ]);
    } else if (resource === "payments") {
      if (!(canViewFinance(a) || (a.role === "client" && a.clientId)))
        throw ApiError.forbidden();
      const filter: any =
        a.role === "client"
          ? { clientId: a.clientId, direction: "in", status: "recorded" }
          : {};
      const docs = await Payment.find({ ...filter, ...dr("paymentDate") })
        .sort({ paymentDate: -1 })
        .limit(EXPORT_LIMIT);
      headers = [
        "Number",
        "Direction",
        "Date",
        "Method",
        "Reference",
        "Amount (minor units)",
        "Classification",
        "Status",
      ];
      rows = docs.map((d) => [
        d.number,
        d.direction,
        d.paymentDate,
        d.method,
        d.reference,
        d.amountMinor,
        d.classification,
        d.status,
      ]);
    } else if (resource === "expenses") {
      if (!canViewFinance(a)) throw ApiError.forbidden();
      const docs = await Expense.find({ archivedAt: null, ...dr("date") })
        .sort({ date: -1 })
        .limit(EXPORT_LIMIT);
      headers = [
        "Number",
        "Date",
        "Category",
        "Payee",
        "Amount (minor units)",
        "Order",
      ];
      rows = docs.map((d) => [
        d.number,
        d.date,
        d.category,
        d.payee,
        d.amountMinor,
        d.orderId,
      ]);
    } else {
      if (!(a.role === "admin" || can(a, "clients.manage")))
        throw ApiError.forbidden();
      const docs = await Client.find({ archivedAt: null })
        .sort({ legalName: 1 })
        .limit(EXPORT_LIMIT);
      headers = ["Code", "Legal name", "Email", "Phone", "Active"];
      rows = docs.map((d) => [
        d.code,
        d.legalName,
        d.email,
        d.phone,
        d.isActive,
      ]);
    }
    await audit(
      a,
      "export.created",
      resource,
      undefined,
      { rows: rows.length },
      req,
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${resource}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(toCsv(headers, rows));
  }),
);

// ---- PDF documents ----
const documents = Router();
const send = (res: any, name: string, buf: Buffer) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.pdf"`);
  res.send(buf);
};
const addr = (x?: any) =>
  [
    x?.line1,
    x?.line2,
    [x?.postalCode, x?.city].filter(Boolean).join(" "),
    x?.country,
  ].filter(Boolean) as string[];
const d10 = (d?: Date | null) =>
  d ? new Date(d).toISOString().slice(0, 10) : "-";

documents.get(
  "/invoice/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const s = invoiceScope(a);
    if (!s) throw ApiError.forbidden();
    const inv: any = await Invoice.findOne({
      ...s,
      _id: req.params.id,
    }).populate("clientId supplierId");
    if (!inv) throw ApiError.notFound("Invoice not found");
    const party = inv.clientId ?? inv.supplierId;
    const buf = await renderPdf(
      {
        title: inv.type === "client" ? "Invoice" : "Supplier invoice",
        number: inv.number,
        meta: [
          ["Date", d10(inv.invoiceDate)],
          ["Due date", d10(inv.dueDate)],
          ["Status", effectiveStatus(inv)],
        ],
        party: [party?.legalName ?? party?.name, ...addr(party?.address)],
        lines: inv.lines.map((l: any) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPriceMinor: l.unitPriceMinor,
          totalMinor: l.totalMinor,
        })),
        totals: [
          ["Subtotal", money(inv.subtotalMinor, inv.currency)],
          ["Discounts", money(inv.discountTotalMinor, inv.currency)],
          ["Tax", money(inv.taxTotalMinor, inv.currency)],
          ["Total", money(inv.grandTotalMinor, inv.currency)],
          ["Paid", money(inv.amountPaidMinor, inv.currency)],
          [
            "Outstanding",
            money(inv.grandTotalMinor - inv.amountPaidMinor, inv.currency),
          ],
        ],
        notes: inv.notes,
      },
      inv.currency,
    );
    await audit(a, "export.pdf", "Invoice", inv._id, {}, req);
    send(res, inv.number ?? "invoice-draft", buf);
  }),
);

documents.get(
  "/quotation/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const filter: any = can(a, "quotations.manage")
      ? {}
      : a.role === "client" && a.clientId
        ? { clientId: a.clientId, status: { $ne: "draft" } }
        : null;
    if (!filter) throw ApiError.forbidden();
    const q: any = await Quotation.findOne({
      ...filter,
      _id: req.params.id,
    }).populate("clientId");
    if (!q) throw ApiError.notFound("Quotation not found");
    const buf = await renderPdf(
      {
        title: "Quotation",
        number: q.number,
        meta: [
          ["Date", d10(q.issueDate)],
          ["Valid until", d10(q.validUntil)],
        ],
        party: [q.clientId?.legalName, ...addr(q.clientId?.address)],
        lines: q.lines.map((l: any) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPriceMinor: l.unitPriceMinor,
          totalMinor: l.totalMinor,
        })),
        totals: [
          ["Subtotal", money(q.subtotalMinor, q.currency)],
          ["Discounts", money(q.discountTotalMinor, q.currency)],
          ["Tax", money(q.taxTotalMinor, q.currency)],
          ["Total", money(q.grandTotalMinor, q.currency)],
        ],
        notes: q.notes,
      },
      q.currency,
    );
    send(res, q.number, buf);
  }),
);

documents.get(
  "/delivery/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const filter: any = can(a, "deliveries.manage")
      ? {}
      : a.role === "client" && a.clientId
        ? { clientId: a.clientId }
        : null;
    if (!filter) throw ApiError.forbidden();
    const d: any = await Delivery.findOne({
      ...filter,
      _id: req.params.id,
    }).populate("clientId orderId", "legalName jobCode");
    if (!d) throw ApiError.notFound("Delivery not found");
    const buf = await renderPdf({
      title: "Delivery note",
      number: d.reference,
      meta: [
        ["Order", d.orderId?.jobCode ?? ""],
        ["Planned", d10(d.plannedDate)],
        ["Delivered", d10(d.actualDate)],
        ["Carrier", d.carrier ?? "-"],
      ],
      party: [d.clientId?.legalName, ...addr(d.address)],
      lines: d.lines.map((l: any) => ({
        description: l.description ?? "",
        quantity: l.quantity,
      })),
      notes: d.notes,
    });
    send(res, d.reference, buf);
  }),
);

documents.get(
  "/statement/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const clientId = req.params.id;
    if (!(a.role === "client" ? a.clientId === clientId : canViewFinance(a)))
      throw ApiError.forbidden();
    const client = await Client.findById(clientId);
    if (!client) throw ApiError.notFound("Client not found");
    const invs = await Invoice.find({
      clientId,
      type: "client",
      status: { $nin: ["draft", "cancelled"] },
    }).sort({ invoiceDate: 1 });
    const total = invs.reduce((s, i) => s + i.grandTotalMinor, 0);
    const paid = invs.reduce((s, i) => s + i.amountPaidMinor, 0);
    const buf = await renderPdf({
      title: "Client statement",
      meta: [["Generated", d10(new Date())]],
      party: [client.legalName, ...addr(client.address)],
      lines: invs.map((i) => ({
        description: `${i.number} (${d10(i.invoiceDate)}) - paid ${money(i.amountPaidMinor)}`,
        totalMinor: i.grandTotalMinor,
      })),
      totals: [
        ["Invoiced", money(total)],
        ["Paid", money(paid)],
        ["Balance due", money(total - paid)],
      ],
    });
    send(res, `statement-${client.code}`, buf);
  }),
);
router.use("/documents", documents);

export default router;
