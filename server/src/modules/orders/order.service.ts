import type { FilterQuery, HydratedDocument } from "mongoose";
import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { can, isStaff, type AuthContext } from "../../config/permissions.js";
import { ApiError } from "../../utils/http.js";
import { computeTotals, computeMargin } from "../../utils/money.js";
import { nextSequence } from "../../database/index.js";
import { audit } from "../audit-logs/audit.service.js";
import { Client } from "../clients/client.model.js";
import { Machine } from "../machines/machine.routes.js";
import { Printer } from "../printers/printer.routes.js";
import { CatalogItem } from "../catalog/catalog.routes.js";
import { PantoneColor } from "../settings/technical.routes.js";
import { FileAsset } from "../files/file.model.js";
import { User } from "../users/user.model.js";
import {
  notifyClient,
  notifyPrinter,
  notifyStaff,
} from "../notifications/notification.service.js";
import { Order } from "./order.model.js";
import {
  CLIENT_EDITABLE_STATUSES,
  FINAL_STATUSES,
  checkTransition,
  computeColorCounts,
  isAssignedTo,
  isOwnerClient,
  type OrderStatus,
} from "./order.rules.js";
import type { CreateOrderInput, UpdateOrderInput } from "./order.schemas.js";

export type OrderDoc = HydratedDocument<any>;

export function orderScope(a: AuthContext): FilterQuery<any> | null {
  switch (a.role) {
    case "admin":
      return {};
    case "manager":
      return can(a, "orders.view") ? {} : null;
    case "client":
      return a.clientId ? { clientId: a.clientId } : null;
    case "printer":
      return a.printerId ? { assignedPrinterId: a.printerId } : null;
  }
}

export async function loadOrder(a: AuthContext, id: string): Promise<OrderDoc> {
  const scope = orderScope(a);
  if (!scope) throw ApiError.forbidden();
  const order = await Order.findOne({ ...scope, _id: id });
  // Same response for "missing" and "not yours" so IDs cannot be probed.
  if (!order) throw ApiError.notFound("Order not found");
  return order;
}

async function nextJobCode() {
  const yy = String(new Date().getFullYear()).slice(-2);
  const n = await nextSequence(`job-${yy}`);
  return `${yy}${String(n).padStart(7, "0")}`;
}

export const canPrice = (a: AuthContext) =>
  can(a, "finance.manage") || can(a, "quotations.manage");

const logActivity = (
  order: OrderDoc,
  a: AuthContext | "system",
  action: string,
  details?: unknown,
  visibility: "public" | "internal" = "public",
) => {
  order.activityHistory.push({
    action,
    by: a === "system" ? undefined : a.userId,
    byName: a === "system" ? "System" : a.name,
    at: new Date(),
    visibility,
    details,
  });
};

export async function buildTechnicalSpecs(
  input: CreateOrderInput["technicalSpecifications"],
  machine: any,
) {
  const base = [...new Set(input.colors.base)];
  const codes = [...new Set(input.colors.pantone)];
  const pantoneDocs = codes.length
    ? await PantoneColor.find({ code: { $in: codes }, isActive: true }).lean<any>()
    : [];
  const missing = codes.filter((c) => !pantoneDocs.some((p: any) => p.code === c));
  if (missing.length)
    throw ApiError.unprocessable(
      `Unknown Pantone colors: ${missing.join(", ")}`,
      "INVALID_PANTONE",
      [
        {
          field: "technicalSpecifications.colors.pantone",
          message: "Unknown Pantone code",
        },
      ],
    );
  const counts = computeColorCounts(
    base,
    codes,
    env.COLOR_COUNT_INCLUDES_PANTONE,
  );
  if (
    machine?.maxColors &&
    counts.baseCount + counts.pantoneCount > machine.maxColors
  ) {
    throw ApiError.unprocessable(
      `The selected machine supports at most ${machine.maxColors} colors`,
      "COLOR_LIMIT_EXCEEDED",
      [
        {
          field: "technicalSpecifications.colors",
          message: `Machine supports ${machine.maxColors} colors`,
        },
      ],
    );
  }
  return {
    ...input,
    colors: {
      base,
      pantone: pantoneDocs.map((p: any) => ({
        code: p.code,
        name: p.name,
        hex: p.hex,
      })),
      ...counts,
    },
    machineSpecifications: input.machineSpecifications ?? {
      printWidthMm: machine?.printWidthMm,
      maxColors: machine?.maxColors,
      distortion: machine?.distortionFactor,
      lpi: machine?.defaultLpi,
    },
  };
}

async function buildLines(
  lines: NonNullable<CreateOrderInput["lineItems"]>,
  priced: boolean,
) {
  for (const l of lines) {
    if (
      l.catalogItemId &&
      !(await CatalogItem.exists({ _id: l.catalogItemId, isActive: true }))
    ) {
      throw ApiError.unprocessable(
        "Catalogue item does not exist or is inactive",
        "INVALID_REFERENCE",
      );
    }
  }
  // Prices and discounts are only accepted from users allowed to price; everyone else gets zero-priced lines.
  const clean = lines.map((l) => ({
    ...l,
    unit: l.unit ?? "unit",
    unitPriceMinor: priced ? (l.unitPriceMinor ?? 0) : 0,
    discountPercent: priced ? (l.discountPercent ?? 0) : 0,
    taxPercent: priced ? (l.taxPercent ?? 0) : 0,
  }));
  const t = computeTotals(clean);
  return {
    lineItems: clean.map((l, i) => ({
      ...l,
      totalMinor: t.lines[i].totalMinor,
    })),
    subtotalMinor: t.subtotalMinor,
    discountTotalMinor: t.discountTotalMinor,
    taxTotalMinor: t.taxTotalMinor,
    grandTotalMinor: t.grandTotalMinor,
  };
}

function normalizeLinks(
  links: NonNullable<CreateOrderInput["designLinks"]>,
  a: AuthContext,
) {
  return links.map((l) => {
    const raw = typeof l === "string" ? l : l.url;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw ApiError.unprocessable(
        "Design link is not a valid URL",
        "INVALID_LINK",
        [{ field: "designLinks", message: "Invalid URL" }],
      );
    }
    if (u.protocol !== "https:" || u.username || u.password) {
      throw ApiError.unprocessable(
        "Only https:// design links without credentials are accepted",
        "INVALID_LINK",
        [{ field: "designLinks", message: "Only https links are allowed" }],
      );
    }
    return {
      url: u.toString(),
      label: typeof l === "string" ? undefined : l.label,
      host: u.hostname,
      addedBy: a.userId,
      addedAt: new Date(),
    };
  });
}

async function validateFiles(ids: string[], clientId: string, a: AuthContext) {
  if (!ids.length) return [];
  const files = await FileAsset.find({ _id: { $in: ids } });
  if (files.length !== new Set(ids).size)
    throw ApiError.unprocessable(
      "One or more files do not exist",
      "INVALID_FILE",
    );
  for (const f of files) {
    const mine = String(f.uploadedBy) === a.userId;
    if (f.uploadState !== "ready")
      throw ApiError.unprocessable(
        `File "${f.originalName}" has not finished uploading`,
        "FILE_NOT_READY",
      );
    if (String(f.clientId ?? "") !== clientId)
      throw ApiError.forbidden("File belongs to another client");
    if (!mine && !isStaff(a))
      throw ApiError.forbidden("You can only attach your own files");
    if (a.role === "client" && f.accessClass === "internal")
      throw ApiError.forbidden();
  }
  return files;
}

export async function createOrder(
  a: AuthContext,
  input: CreateOrderInput,
  idempotencyKey?: string,
  extra: { quotationId?: string; estimatedCostMinor?: number } = {},
) {
  if (idempotencyKey) {
    const existing = await Order.findOne({
      createdBy: a.userId,
      idempotencyKey,
    });
    if (existing) return { order: existing, replayed: true };
  }
  let clientId: string;
  if (a.role === "client") {
    if (!a.clientId) throw ApiError.forbidden();
    clientId = a.clientId; // never trust a client-supplied clientId
  } else if (a.role === "admin" || can(a, "orders.create")) {
    if (!input.clientId)
      throw ApiError.unprocessable(
        "Please select a client from the search list",
        "CLIENT_REQUIRED",
        [{ field: "clientId", message: "Client is required" }],
      );
    clientId = input.clientId;
  } else throw ApiError.forbidden();

  if (!(await Client.exists({ _id: clientId, isActive: true }))) {
    throw ApiError.unprocessable(
      "Selected client does not exist or is inactive",
      "INVALID_REFERENCE",
      [{ field: "clientId", message: "Invalid client" }],
    );
  }
  const machine = await Machine.findOne({
    _id: input.machineId,
    isActive: true,
  }).lean<any>();
  if (!machine)
    throw ApiError.unprocessable(
      "Selected machine does not exist or is inactive",
      "INVALID_REFERENCE",
      [{ field: "machineId", message: "Invalid machine" }],
    );
  if (
    a.role === "client" &&
    machine.clientId &&
    String(machine.clientId) !== clientId
  ) {
    throw ApiError.unprocessable(
      "Selected machine is not available",
      "INVALID_REFERENCE",
      [{ field: "machineId", message: "Invalid machine" }],
    );
  }

  const staff = isStaff(a);
  const technicalSpecifications = await buildTechnicalSpecs(
    input.technicalSpecifications,
    machine,
  );
  const lines = await buildLines(input.lineItems ?? [], canPrice(a));
  await validateFiles(input.fileAssetIds ?? [], clientId, a);
  const submit = input.submit ?? true;
  const initial: OrderStatus = submit ? "under_approval" : "file_preparation";

  let order: OrderDoc | undefined;
  for (let attempt = 0; attempt < 3 && !order; attempt++) {
    try {
      order = await Order.create({
        jobCode: await nextJobCode(),
        jobName: input.jobName,
        clientId,
        machineId: input.machineId,
        subCustomer: input.subCustomer,
        priority: staff ? (input.priority ?? "normal") : "normal",
        requestedDeliveryDate: input.requestedDeliveryDate,
        customerNotes: input.customerNotes,
        // Internal/printer notes can only be set by staff.
        internalNotes: staff ? input.internalNotes : undefined,
        printerNotes: staff ? input.printerNotes : undefined,
        technicalSpecifications,
        designLinks: normalizeLinks(input.designLinks ?? [], a),
        fileAssetIds: input.fileAssetIds ?? [],
        ...lines,
        currency: env.DEFAULT_CURRENCY,
        status: initial,
        approval: { status: submit ? "pending" : "none" },
        statusHistory: [
          {
            from: null,
            to: initial,
            by: a.userId,
            byRole: a.role,
            at: new Date(),
            note: "Order created",
          },
        ],
        activityHistory: [
          {
            action: "order.created",
            by: a.userId,
            byName: a.name,
            at: new Date(),
            visibility: "public",
          },
        ],
        idempotencyKey,
        quotationId: extra.quotationId,
        estimatedCostMinor: extra.estimatedCostMinor ?? 0,
        createdBy: a.userId,
        updatedBy: a.userId,
      });
    } catch (e: any) {
      if (e?.code === 11000 && idempotencyKey && e.keyPattern?.idempotencyKey) {
        const existing = await Order.findOne({
          createdBy: a.userId,
          idempotencyKey,
        });
        if (existing) return { order: existing, replayed: true };
      }
      if (e?.code === 11000 && e.keyPattern?.jobCode) continue;
      throw e;
    }
  }
  if (!order)
    throw new ApiError(500, "JOB_CODE_FAILED", "Could not allocate a job code");

  if (input.fileAssetIds?.length) {
    await FileAsset.updateMany(
      { _id: { $in: input.fileAssetIds }, orderId: null },
      { orderId: order._id },
    );
  }
  await audit(
    a,
    "order.created",
    "Order",
    order._id,
    { jobCode: order.jobCode, status: initial },
    undefined,
  );
  if (submit) {
    await notifyStaff(
      "orders.approve",
      {
        type: "approval_pending",
        title: `Order ${order.jobCode} needs approval`,
        body: order.jobName,
        link: `/orders/${order._id}`,
      },
      a.userId,
    );
  }
  return { order, replayed: false };
}

const CLIENT_FIELDS = [
  "machineId",
  "jobName",
  "subCustomer",
  "requestedDeliveryDate",
  "customerNotes",
  "technicalSpecifications",
  "designLinks",
  "fileAssetIds",
  "lineItems",
];

export async function updateOrder(
  a: AuthContext,
  order: OrderDoc,
  input: UpdateOrderInput,
) {
  const keys = Object.keys(input);
  let allowed: string[];
  if (isOwnerClient(a, order)) {
    if (!CLIENT_EDITABLE_STATUSES.includes(order.status))
      throw ApiError.forbidden(
        "This order can no longer be edited by the client",
      );
    allowed = CLIENT_FIELDS;
  } else if (isAssignedTo(a, order)) {
    if (FINAL_STATUSES.includes(order.status))
      throw ApiError.forbidden("This order is closed");
    allowed = ["printerNotes"];
  } else if (can(a, "orders.edit")) {
    allowed = [
      "machineId",
      "jobName",
      "subCustomer",
      "priority",
      "requestedDeliveryDate",
      "confirmedDeliveryDate",
      "customerNotes",
      "internalNotes",
      "printerNotes",
      "technicalSpecifications",
      "designLinks",
      "fileAssetIds",
    ];
    if (canPrice(a)) allowed.push("lineItems");
    if (can(a, "finance.manage")) allowed.push("estimatedCostMinor");
  } else throw ApiError.forbidden();
  if (FINAL_STATUSES.includes(order.status) && a.role !== "admin")
    throw ApiError.forbidden("This order is closed");

  const denied = keys.filter((k) => !allowed.includes(k));
  if (denied.length)
    throw ApiError.forbidden(
      `You are not allowed to modify: ${denied.join(", ")}`,
    );

  const changes: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    changes[k] = true;
    order.set(k, v);
  };

  if (input.machineId) {
    const m = await Machine.exists({ _id: input.machineId, isActive: true });
    if (!m)
      throw ApiError.unprocessable(
        "Selected machine does not exist or is inactive",
        "INVALID_REFERENCE",
        [{ field: "machineId", message: "Invalid machine" }],
      );
    set("machineId", input.machineId);
  }
  if (input.technicalSpecifications) {
    const machine = await Machine.findById(
      input.machineId ?? order.machineId,
    ).lean<any>();
    set(
      "technicalSpecifications",
      await buildTechnicalSpecs(input.technicalSpecifications, machine),
    );
  }
  if (input.lineItems) {
    const before = { grandTotalMinor: order.grandTotalMinor };
    const l = await buildLines(input.lineItems, canPrice(a));
    Object.entries(l).forEach(([k, v]) => order.set(k, v));
    changes.lineItems = {
      before,
      after: { grandTotalMinor: l.grandTotalMinor },
    };
  }
  if (input.estimatedCostMinor !== undefined) {
    changes.estimatedCostMinor = {
      before: order.estimatedCostMinor,
      after: input.estimatedCostMinor,
    };
    order.estimatedCostMinor = input.estimatedCostMinor;
  }
  if (input.designLinks)
    set("designLinks", normalizeLinks(input.designLinks, a));
  if (input.fileAssetIds) {
    await validateFiles(input.fileAssetIds, String(order.clientId), a);
    set("fileAssetIds", input.fileAssetIds);
    await FileAsset.updateMany(
      { _id: { $in: input.fileAssetIds }, orderId: null },
      { orderId: order._id },
    );
  }
  for (const k of [
    "jobName",
    "subCustomer",
    "priority",
    "requestedDeliveryDate",
    "confirmedDeliveryDate",
    "customerNotes",
    "internalNotes",
    "printerNotes",
  ] as const) {
    if (k in input) set(k, (input as any)[k]);
  }
  order.updatedBy = a.userId;
  const priceChange = "lineItems" in changes || "estimatedCostMinor" in changes;
  logActivity(
    order,
    a,
    "order.updated",
    changes,
    priceChange || "internalNotes" in changes ? "internal" : "public",
  );
  await order.save();
  await audit(
    a,
    priceChange ? "order.price_changed" : "order.updated",
    "Order",
    order._id,
    { fields: keys, status: order.status },
  );
  return order;
}

export async function transitionOrder(
  order: OrderDoc,
  to: OrderStatus,
  actor: AuthContext | "system",
  opts: { note?: string; fileAssetId?: string } = {},
) {
  const check = checkTransition(order.status, to, actor, opts.note);
  if (!check.ok) {
    throw new ApiError(
      check.reason === "FORBIDDEN" ? 403 : 422,
      check.reason === "FORBIDDEN" ? "FORBIDDEN" : `TRANSITION_${check.reason}`,
      check.message,
    );
  }
  if (
    to === "delivered" &&
    actor !== "system" &&
    order.lineItems.length &&
    order.lineItems.some((l: any) => l.deliveredQuantity < l.quantity)
  ) {
    throw ApiError.unprocessable(
      "Not all ordered quantities have been delivered",
      "OUTSTANDING_QUANTITIES",
    );
  }
  if (
    actor !== "system" &&
    actor.role === "client" &&
    order.status === "file_preparation" &&
    to === "under_approval" &&
    !order.fileAssetIds.length &&
    !order.designLinks.length
  ) {
    throw ApiError.unprocessable(
      "Attach a design file or link before submitting for approval",
      "DESIGN_REQUIRED",
    );
  }

  const from = order.status as OrderStatus;
  order.status = to;
  if (to === "under_approval") order.approval = { status: "pending" };
  if (to === "approved" || to === "rejected") {
    order.approval = {
      status: to,
      decidedBy: (actor as AuthContext).userId,
      decidedAt: new Date(),
      comment: opts.note,
    };
  }
  if (to === "file_preparation") order.approval = { status: "none" };
  const by = actor === "system" ? undefined : actor.userId;
  order.statusHistory.push({
    from,
    to,
    by,
    byRole: actor === "system" ? "system" : actor.role,
    at: new Date(),
    note: opts.note,
    fileAssetId: opts.fileAssetId,
  });
  logActivity(order, actor, "order.status_changed", { from, to });
  if (by) order.updatedBy = by;
  await order.save();
  await audit(
    actor === "system" ? undefined : actor,
    "order.status_changed",
    "Order",
    order._id,
    { from, to, note: opts.note },
  );

  const link = `/orders/${order._id}`;
  const title = `Order ${order.jobCode}: ${to.replace(/_/g, " ")}`;
  const exceptClient = actor !== "system" && actor.role === "client";
  if (!exceptClient)
    await notifyClient(order.clientId, {
      type: "order_status",
      title,
      body: opts.note,
      link,
    });
  if (
    order.assignedPrinterId &&
    !(actor !== "system" && actor.role === "printer")
  ) {
    await notifyPrinter(order.assignedPrinterId, {
      type: "order_status",
      title,
      link,
    });
  }
  if (to === "under_approval")
    await notifyStaff("orders.approve", {
      type: "approval_pending",
      title: `Order ${order.jobCode} needs approval`,
      link,
    });
  if (actor !== "system" && actor.role !== "admin" && actor.role !== "manager")
    await notifyStaff(
      "orders.view",
      { type: "order_status", title, link },
      actor.userId,
    );
  return order;
}

export async function assignOrder(
  a: AuthContext,
  order: OrderDoc,
  input: { printerId?: string | null; managerId?: string | null },
) {
  if (!can(a, "orders.assign")) throw ApiError.forbidden();
  if (FINAL_STATUSES.includes(order.status))
    throw ApiError.unprocessable(
      "Closed orders cannot be reassigned",
      "ORDER_CLOSED",
    );
  const details: Record<string, unknown> = {};
  if (input.printerId !== undefined) {
    if (
      input.printerId &&
      !(await Printer.exists({ _id: input.printerId, isActive: true }))
    ) {
      throw ApiError.unprocessable(
        "Printer does not exist or is inactive",
        "INVALID_REFERENCE",
        [{ field: "printerId", message: "Invalid printer" }],
      );
    }
    details.printer = {
      from: order.assignedPrinterId ?? null,
      to: input.printerId,
    };
    order.assignedPrinterId = input.printerId ?? undefined;
  }
  if (input.managerId !== undefined) {
    if (
      input.managerId &&
      !(await User.exists({
        _id: input.managerId,
        role: { $in: ["manager", "admin"] },
        isActive: true,
      }))
    ) {
      throw ApiError.unprocessable(
        "Manager does not exist or is inactive",
        "INVALID_REFERENCE",
        [{ field: "managerId", message: "Invalid manager" }],
      );
    }
    details.manager = {
      from: order.assignedManagerId ?? null,
      to: input.managerId,
    };
    order.assignedManagerId = input.managerId ?? undefined;
  }
  order.updatedBy = a.userId;
  logActivity(order, a, "order.assigned", details, "internal");
  await order.save();
  await audit(a, "order.assigned", "Order", order._id, details);
  if (input.printerId)
    await notifyPrinter(input.printerId, {
      type: "order_assigned",
      title: `New order assigned: ${order.jobCode}`,
      body: order.jobName,
      link: `/orders/${order._id}`,
    });
  return order;
}

export async function reorder(
  a: AuthContext,
  source: OrderDoc,
  idempotencyKey?: string,
) {
  if (idempotencyKey) {
    const existing = await Order.findOne({
      createdBy: a.userId,
      idempotencyKey,
    });
    if (existing) return { order: existing, replayed: true };
  }
  if (!(isOwnerClient(a, source) || can(a, "orders.create")))
    throw ApiError.forbidden();
  const staff = isStaff(a);
  const src = source.toObject();
  const files = src.fileAssetIds?.length
    ? await FileAsset.find({
        _id: { $in: src.fileAssetIds },
        uploadState: "ready",
        ...(staff ? {} : { accessClass: "shared" }),
      }).select("_id")
    : [];
  const priced = canPrice(a);
  const lines = await buildLines(
    (src.lineItems ?? []).map((l: any) => ({
      catalogItemId: l.catalogItemId ? String(l.catalogItemId) : undefined,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceMinor: l.unitPriceMinor,
      discountPercent: l.discountPercent,
      taxPercent: l.taxPercent,
    })),
    priced,
  );
  // Only technical definition is copied: no invoices, deliveries, payments, history, approval or assignment.
  const order = await Order.create({
    jobCode: await nextJobCode(),
    jobName: src.jobName,
    clientId: src.clientId,
    machineId: src.machineId,
    subCustomer: src.subCustomer,
    priority: "normal",
    customerNotes: src.customerNotes,
    technicalSpecifications: src.technicalSpecifications,
    designLinks: src.designLinks,
    fileAssetIds: files.map((f) => f._id),
    ...lines,
    currency: src.currency,
    reorderOfId: src._id,
    status: "file_preparation",
    approval: { status: "none" },
    statusHistory: [
      {
        from: null,
        to: "file_preparation",
        by: a.userId,
        byRole: a.role,
        at: new Date(),
        note: `Reorder of ${src.jobCode}`,
      },
    ],
    activityHistory: [
      {
        action: "order.reordered",
        by: a.userId,
        byName: a.name,
        at: new Date(),
        visibility: "public",
        details: { sourceJobCode: src.jobCode },
      },
    ],
    idempotencyKey,
    createdBy: a.userId,
    updatedBy: a.userId,
  });
  await audit(a, "order.reordered", "Order", order._id, {
    sourceOrderId: String(src._id),
  });
  return { order, replayed: false };
}

export async function reportIssue(
  a: AuthContext,
  order: OrderDoc,
  kind: string,
  description: string,
) {
  if (!(isAssignedTo(a, order) || can(a, "orders.edit")))
    throw ApiError.forbidden();
  order.issues.push({
    kind,
    description,
    reportedBy: a.userId,
    reportedAt: new Date(),
  });
  logActivity(
    order,
    a,
    "order.issue_reported",
    { kind, description },
    "internal",
  );
  await order.save();
  await audit(a, "order.issue_reported", "Order", order._id, { kind });
  await notifyStaff(
    "orders.view",
    {
      type: "non_conformity",
      title: `Issue reported on ${order.jobCode} (${kind})`,
      body: description,
      link: `/orders/${order._id}`,
    },
    a.userId,
  );
  return order;
}

export async function resolveIssue(
  a: AuthContext,
  order: OrderDoc,
  issueId: string,
) {
  if (!can(a, "orders.edit")) throw ApiError.forbidden();
  const issue = order.issues.id(issueId);
  if (!issue) throw ApiError.notFound("Issue not found");
  issue.resolvedAt = new Date();
  issue.resolvedBy = a.userId;
  logActivity(order, a, "order.issue_resolved", { issueId }, "internal");
  await order.save();
  return order;
}

/** actual cost = production operations' actual costs + expenses that are not tied to an operation. */
export async function recomputeOrderCosts(orderId: unknown) {
  const Op = mongoose.model<any>("ProductionOperation");
  const Expense = mongoose.model<any>("Expense");
  const [ops, exp] = await Promise.all([
    Op.aggregate([
      {
        $match: {
          orderId: new mongoose.Types.ObjectId(String(orderId)),
          archivedAt: null,
        },
      },
      {
        $group: {
          _id: null,
          t: { $sum: { $add: ["$actualCostMinor", "$additionalCostMinor"] } },
        },
      },
    ]),
    Expense.aggregate([
      {
        $match: {
          orderId: new mongoose.Types.ObjectId(String(orderId)),
          productionOperationId: null,
          archivedAt: null,
        },
      },
      { $group: { _id: null, t: { $sum: "$amountMinor" } } },
    ]),
  ]);
  const actualCostMinor = (ops[0]?.t ?? 0) + (exp[0]?.t ?? 0);
  await Order.updateOne({ _id: orderId }, { actualCostMinor });
  return actualCostMinor;
}

export function orderMargins(o: {
  grandTotalMinor: number;
  taxTotalMinor: number;
  estimatedCostMinor: number;
  actualCostMinor: number;
}) {
  const net = o.grandTotalMinor - o.taxTotalMinor; // taxes are not revenue
  return {
    estimated: computeMargin(net, o.estimatedCostMinor),
    // Actual margin is only meaningful once actual costs have been recorded.
    actual:
      o.actualCostMinor > 0 ? computeMargin(net, o.actualCostMinor) : null,
  };
}
