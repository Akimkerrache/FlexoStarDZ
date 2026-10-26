import mongoose from "mongoose";
import {
  makeSchema,
  archiveFields,
  auditFields,
  ObjectId,
} from "../../database/index.js";
import { commercialLineSchema, totalsDef } from "../shared/commercial.js";

export const INVOICE_TYPES = ["client", "supplier"] as const;
export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
] as const;

const invoiceSchema = makeSchema({
  number: { type: String, unique: true, sparse: true },
  type: { type: String, enum: INVOICE_TYPES, required: true, index: true },
  clientId: { type: ObjectId, ref: "Client", index: true },
  supplierId: { type: ObjectId, ref: "Supplier", index: true },
  supplierInvoiceNumber: String,
  orderIds: [{ type: ObjectId, ref: "Order" }],
  invoiceDate: { type: Date, default: Date.now },
  dueDate: Date,
  lines: [commercialLineSchema],
  ...totalsDef,
  currency: { type: String, default: "DZD" },
  amountPaidMinor: { type: Number, default: 0, min: 0 },
  status: {
    type: String,
    enum: INVOICE_STATUSES,
    default: "draft",
    index: true,
  },
  notes: String,
  documentFileId: { type: ObjectId, ref: "FileAsset" },
  history: [
    new mongoose.Schema(
      { action: String, by: ObjectId, at: Date, details: Object },
      { _id: false },
    ),
  ],
  ...archiveFields,
  ...auditFields,
});
invoiceSchema.virtual("outstandingMinor").get(function (this: any) {
  return Math.max(0, (this.grandTotalMinor ?? 0) - (this.amountPaidMinor ?? 0));
});
invoiceSchema.index({ status: 1, dueDate: 1 });
export const Invoice = mongoose.model<any>("Invoice", invoiceSchema);

const paymentSchema = makeSchema({
  number: { type: String, required: true, unique: true },
  invoiceId: { type: ObjectId, ref: "Invoice", required: true, index: true },
  direction: { type: String, enum: ["in", "out"], required: true },
  clientId: { type: ObjectId, ref: "Client", index: true },
  supplierId: { type: ObjectId, ref: "Supplier", index: true },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, default: "DZD" },
  paymentDate: { type: Date, required: true },
  method: {
    type: String,
    enum: ["cash", "bank_transfer", "cheque", "card", "other"],
    required: true,
  },
  reference: String,
  /** Derived from the invoice balance at the time of the transaction. */
  classification: { type: String, enum: ["partial", "full"], required: true },
  balanceAfterMinor: { type: Number, required: true },
  notes: String,
  proofFileId: { type: ObjectId, ref: "FileAsset" },
  status: {
    type: String,
    enum: ["recorded", "voided"],
    default: "recorded",
    index: true,
  },
  voidedAt: Date,
  voidedBy: { type: ObjectId, ref: "User" },
  voidReason: String,
  voidedReference: String,
  idempotencyKey: String,
  ...auditFields,
});
paymentSchema.index(
  { invoiceId: 1, reference: 1 },
  { unique: true, partialFilterExpression: { reference: { $type: "string" } } },
);
paymentSchema.index(
  { createdBy: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);
export const Payment = mongoose.model<any>("Payment", paymentSchema);

const expenseSchema = makeSchema({
  number: { type: String, required: true, unique: true },
  category: { type: String, required: true, index: true },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, default: "DZD" },
  date: { type: Date, required: true, index: true },
  supplierId: { type: ObjectId, ref: "Supplier", index: true },
  payee: String,
  orderId: { type: ObjectId, ref: "Order", index: true },
  productionOperationId: { type: ObjectId, ref: "ProductionOperation" },
  documentFileId: { type: ObjectId, ref: "FileAsset" },
  notes: String,
  archivedAt: Date,
  ...auditFields,
});
export const Expense = mongoose.model<any>("Expense", expenseSchema);
