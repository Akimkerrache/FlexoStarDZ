import { FINAL_STATUSES } from "../orders/order.rules.js";
import { Order } from "../orders/order.model.js";
import { Invoice } from "../invoices/invoice.model.js";
import { Delivery } from "../deliveries/delivery.routes.js";
import { ProductionOperation } from "../production/production.routes.js";
import { expireQuotations } from "../quotations/quotation.routes.js";
import { notifyStaff, notifyClient } from "./notification.service.js";
import { logger } from "../../config/logger.js";

const day = () => new Date().toISOString().slice(0, 10);

/**
 * In-app alerts only (email/mobile push channels are an open decision). Each alert is de-duplicated per day
 * through `dedupeKey`, so the scan can safely run repeatedly.
 */
export async function runAlertScan() {
  const now = new Date();
  const soon = new Date(now.getTime() + 2 * 86400000);
  const counts = {
    overdueOrders: 0,
    overdueInvoices: 0,
    deliveries: 0,
    pendingApprovals: 0,
    supplierDeadlines: 0,
    expiredQuotations: 0,
  };

  counts.expiredQuotations = await expireQuotations();

  for (const o of await Order.find({
    requestedDeliveryDate: { $lt: now },
    status: { $nin: FINAL_STATUSES },
  }).select("jobCode")) {
    counts.overdueOrders++;
    await notifyStaff("orders.view", {
      type: "order_overdue",
      title: `Order ${o.jobCode} is overdue`,
      link: `/orders/${o._id}`,
      dedupeKey: `overdue-${o._id}-${day()}`,
    });
  }
  for (const o of await Order.find({
    status: "under_approval",
    updatedAt: { $lt: new Date(now.getTime() - 86400000) },
  }).select("jobCode")) {
    counts.pendingApprovals++;
    await notifyStaff("orders.approve", {
      type: "approval_pending",
      title: `Order ${o.jobCode} awaits approval for over 24h`,
      link: `/orders/${o._id}`,
      dedupeKey: `approval-${o._id}-${day()}`,
    });
  }
  await Invoice.updateMany(
    { status: { $in: ["issued", "partially_paid"] }, dueDate: { $lt: now } },
    { status: "overdue" },
  );
  for (const i of await Invoice.find({ status: "overdue" }).select(
    "number type clientId",
  )) {
    counts.overdueInvoices++;
    const payload = {
      type: "invoice_unpaid",
      title: `Invoice ${i.number} is overdue`,
      link: "/invoices",
      dedupeKey: `invoice-${i._id}-${day()}`,
    };
    await notifyStaff("finance.view", payload);
    if (i.type === "client") await notifyClient(i.clientId, payload);
  }
  for (const d of await Delivery.find({
    status: { $in: ["planned", "in_transit"] },
    plannedDate: { $lte: soon },
  }).select("reference clientId")) {
    counts.deliveries++;
    await notifyStaff("deliveries.manage", {
      type: "delivery_expected",
      title: `Delivery ${d.reference} is due soon`,
      link: "/deliveries",
      dedupeKey: `delivery-${d._id}-${day()}`,
    });
  }
  for (const op of await ProductionOperation.find({
    status: { $nin: ["completed", "cancelled"] },
    plannedEnd: { $lt: now },
    archivedAt: null,
    executorType: { $in: ["supplier", "subcontractor"] },
  }).select("reference")) {
    counts.supplierDeadlines++;
    await notifyStaff("production.manage", {
      type: "supplier_deadline",
      title: `Operation ${op.reference} missed its planned end date`,
      link: "/production",
      dedupeKey: `op-${op._id}-${day()}`,
    });
  }
  logger.info(counts, "alert scan finished");
  return counts;
}
