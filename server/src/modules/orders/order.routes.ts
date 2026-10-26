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
import { paginate } from "../../utils/pagination.js";
import { authenticate } from "../../middleware/index.js";
import { FileAsset } from "../files/file.model.js";
import { Order } from "./order.model.js";
import {
  FINAL_STATUSES,
  ORDER_STATUSES,
  allowedNextStatuses,
  isAssignedTo,
  isOwnerClient,
} from "./order.rules.js";
import {
  createOrderInput,
  listOrdersQuery,
  updateOrderInput,
} from "./order.schemas.js";
import {
  assignOrder,
  canPrice,
  createOrder,
  loadOrder,
  orderMargins,
  orderScope,
  reorder,
  reportIssue,
  resolveIssue,
  transitionOrder,
  updateOrder,
} from "./order.service.js";

const MONEY_KEYS = [
  "subtotalMinor",
  "discountTotalMinor",
  "taxTotalMinor",
  "grandTotalMinor",
];
const COST_KEYS = ["estimatedCostMinor", "actualCostMinor"];
const POPULATE = [
  { path: "clientId", select: "legalName code" },
  { path: "machineId", select: "name code" },
  { path: "assignedPrinterId", select: "name code" },
  { path: "assignedManagerId", select: "name" },
];

const ref = (v: any) =>
  v && typeof v === "object" && v.id
    ? {
        id: v.id,
        ...Object.fromEntries(Object.entries(v).filter(([k]) => k !== "id")),
      }
    : null;
const refId = (v: any) =>
  v && typeof v === "object" && v.id ? v.id : v ? String(v) : null;

/** Role-based projection of an order. Every API response about an order goes through here. */
export function toOrderView(doc: any, a: AuthContext) {
  const o = doc.toJSON();
  const out: any = { ...o };
  out.client = ref(o.clientId);
  out.machine = ref(o.machineId);
  out.assignedPrinter = ref(o.assignedPrinterId);
  out.assignedManager = ref(o.assignedManagerId);
  out.clientId = refId(o.clientId);
  out.machineId = refId(o.machineId);
  out.assignedPrinterId = refId(o.assignedPrinterId);
  out.assignedManagerId = refId(o.assignedManagerId);
  delete out.idempotencyKey;

  const seesCost =
    a.role === "admin" || can(a, "finance.view") || can(a, "finance.manage");
  const seesMoney = a.role === "client" || seesCost || canPrice(a);
  if (!seesMoney) {
    for (const k of MONEY_KEYS) delete out[k];
    out.lineItems = out.lineItems?.map((l: any) => {
      const {
        unitPriceMinor: _u,
        discountPercent: _d,
        taxPercent: _t,
        totalMinor: _m,
        ...rest
      } = l;
      return rest;
    });
  }
  if (!seesCost) for (const k of COST_KEYS) delete out[k];
  else out.margins = orderMargins(o);

  if (a.role === "client") {
    for (const k of [
      "internalNotes",
      "printerNotes",
      "assignedPrinterId",
      "assignedPrinter",
      "assignedManagerId",
      "assignedManager",
      "issues",
      "createdBy",
      "updatedBy",
    ])
      delete out[k];
    out.activityHistory = (o.activityHistory ?? [])
      .filter((x: any) => x.visibility !== "internal")
      .map(({ details: _d, ...x }: any) => x);
  }
  if (a.role === "printer") {
    for (const k of [
      "internalNotes",
      "client",
      "clientId",
      "invoiceIds",
      "createdBy",
      "updatedBy",
      "assignedManager",
      "assignedManagerId",
      "subCustomer",
    ])
      delete out[k];
    out.activityHistory = (o.activityHistory ?? []).filter(
      (x: any) => x.visibility !== "internal",
    );
  }
  out.allowedTransitions = allowedNextStatuses(o.status, a);
  out.permissions = {
    canEdit:
      (isOwnerClient(a, o) &&
        ["file_preparation", "rejected"].includes(o.status)) ||
      (isAssignedTo(a, o) && !FINAL_STATUSES.includes(o.status)) ||
      can(a, "orders.edit"),
    canAssign: can(a, "orders.assign") && !FINAL_STATUSES.includes(o.status),
    canReorder: isOwnerClient(a, o) || can(a, "orders.create"),
    canReportIssue: isAssignedTo(a, o) || can(a, "orders.edit"),
  };
  return out;
}

const router = Router();
router.use(authenticate);

router.get(
  "/",
  validate({ query: listOrdersQuery }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const q = req.validated!.query;
    const scope = orderScope(a);
    if (!scope) throw ApiError.forbidden();
    const filter: any = { ...scope };
    for (const k of ["status", "machineId", "priority"] as const)
      if (q[k]) filter[k] = q[k];
    if (q.clientId && a.role !== "client") filter.clientId = q.clientId;
    if (q.assignedPrinterId && (a.role === "admin" || a.role === "manager"))
      filter.assignedPrinterId = q.assignedPrinterId;
    if (q.mine === "true") filter.assignedManagerId = a.userId;
    if (q.overdue === "true") {
      filter.requestedDeliveryDate = { $lt: new Date() };
      filter.status = { $nin: FINAL_STATUSES };
    }
    if (q.dateFrom || q.dateTo)
      filter.createdAt = {
        ...(q.dateFrom && { $gte: q.dateFrom }),
        ...(q.dateTo && { $lte: q.dateTo }),
      };
    if (q.search) {
      const rx = new RegExp(escapeRegex(q.search), "i");
      filter.$and = [{ $or: [{ jobCode: rx }, { jobName: rx }] }];
    }
    const { items, meta } = await paginate(Order, filter, q, {
      allowedSort: [
        "jobCode",
        "jobName",
        "status",
        "createdAt",
        "requestedDeliveryDate",
        "priority",
      ],
      populate: POPULATE,
      select: "-activityHistory -statusHistory",
    });
    ok(
      res,
      items.map((d) => toOrderView(d, a)),
      "OK",
      meta,
    );
  }),
);

const idemKey = (req: any) => {
  const k = req.get("idempotency-key");
  return k && /^[A-Za-z0-9_-]{8,100}$/.test(k) ? k : undefined;
};

router.post(
  "/",
  validate({ body: createOrderInput }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const { order, replayed } = await createOrder(
      a,
      req.validated!.body,
      idemKey(req),
    );
    await order.populate(POPULATE);
    (replayed ? ok : created)(
      res,
      toOrderView(order, a),
      replayed ? "Order already created" : "Order created",
    );
  }),
);

router.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const order = await loadOrder(a, req.params.id);
    await order.populate(POPULATE);
    ok(res, toOrderView(order, a));
  }),
);

router.patch(
  "/:id",
  validate({ params: idParams, body: updateOrderInput }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const order = await updateOrder(
      a,
      await loadOrder(a, req.params.id),
      req.validated!.body,
    );
    await order.populate(POPULATE);
    ok(res, toOrderView(order, a), "Order updated");
  }),
);

const statusBody = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(2000).optional(),
  fileAssetId: objectId.optional(),
});
router.post(
  "/:id/status",
  validate({ params: idParams, body: statusBody }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const { status, note, fileAssetId } = req.validated!.body;
    const order = await transitionOrder(
      await loadOrder(a, req.params.id),
      status,
      a,
      { note, fileAssetId },
    );
    await order.populate(POPULATE);
    ok(res, toOrderView(order, a), "Status updated");
  }),
);

const decision = (to: "approved" | "rejected") =>
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const order = await transitionOrder(
      await loadOrder(a, req.params.id),
      to,
      a,
      { note: req.validated!.body.note },
    );
    await order.populate(POPULATE);
    ok(
      res,
      toOrderView(order, a),
      to === "approved" ? "Order approved" : "Order rejected",
    );
  });
const noteBody = z.object({ note: z.string().trim().max(2000).optional() });
router.post(
  "/:id/approve",
  validate({ params: idParams, body: noteBody }),
  decision("approved"),
);
router.post(
  "/:id/reject",
  validate({ params: idParams, body: noteBody }),
  decision("rejected"),
);

router.post(
  "/:id/assign",
  validate({
    params: idParams,
    body: z
      .object({
        printerId: objectId.nullable().optional(),
        managerId: objectId.nullable().optional(),
      })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const order = await assignOrder(
      a,
      await loadOrder(a, req.params.id),
      req.validated!.body,
    );
    await order.populate(POPULATE);
    ok(res, toOrderView(order, a), "Order assigned");
  }),
);

router.post(
  "/:id/reorder",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const { order, replayed } = await reorder(
      a,
      await loadOrder(a, req.params.id),
      idemKey(req),
    );
    await order.populate(POPULATE);
    (replayed ? ok : created)(res, toOrderView(order, a), "Reorder created");
  }),
);

router.post(
  "/:id/issues",
  validate({
    params: idParams,
    body: z.object({
      kind: z.enum(["technical", "delay", "non_conformity"]),
      description: z.string().trim().min(3).max(2000),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const order = await reportIssue(
      a,
      await loadOrder(a, req.params.id),
      req.validated!.body.kind,
      req.validated!.body.description,
    );
    await order.populate(POPULATE);
    created(res, toOrderView(order, a), "Issue reported");
  }),
);

router.post(
  "/:id/issues/:issueId/resolve",
  validate({ params: idParams.extend({ issueId: objectId }) }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const order = await resolveIssue(
      a,
      await loadOrder(a, req.params.id),
      req.params.issueId,
    );
    await order.populate(POPULATE);
    ok(res, toOrderView(order, a));
  }),
);

router.get(
  "/:id/history",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const order = await loadOrder(a, req.params.id);
    const v = toOrderView(order, a);
    ok(res, {
      statusHistory: v.statusHistory,
      activityHistory: v.activityHistory,
    });
  }),
);

router.get(
  "/:id/files",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const order = await loadOrder(a, req.params.id);
    const filter: any = {
      _id: { $in: order.fileAssetIds },
      uploadState: "ready",
      archivedAt: null,
    };
    if (a.role === "client" || a.role === "printer")
      filter.accessClass = "shared";
    ok(
      res,
      await FileAsset.find(filter).sort({ versionGroupId: 1, version: 1 }),
    );
  }),
);

router.post(
  "/:id/files",
  validate({
    params: idParams,
    body: z.object({ fileAssetIds: z.array(objectId).min(1).max(50) }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const order = await loadOrder(a, req.params.id);
    const merged = [
      ...new Set([
        ...order.fileAssetIds.map(String),
        ...req.validated!.body.fileAssetIds,
      ]),
    ];
    const updated = await updateOrder(a, order, { fileAssetIds: merged });
    ok(res, { fileAssetIds: updated.fileAssetIds }, "Files linked");
  }),
);

export default router;
