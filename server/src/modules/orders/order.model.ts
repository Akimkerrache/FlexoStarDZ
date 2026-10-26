import mongoose, { Schema, type InferSchemaType } from "mongoose";
import {
  makeSchema,
  archiveFields,
  auditFields,
  ObjectId,
} from "../../database/index.js";
import {
  ORDER_STATUSES,
  BASE_COLORS,
  PRINT_DIRECTIONS,
  MATERIALS,
  PRIORITIES,
} from "./order.rules.js";

const sub = <T extends object>(
  def: T,
  opts: { _id?: boolean } = { _id: false },
) => new Schema(def as any, opts);

const photocellDef = { mark: String, path: String };

const lineItemSchema = sub(
  {
    catalogItemId: { type: ObjectId, ref: "CatalogItem" },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, default: "unit" },
    unitPriceMinor: { type: Number, default: 0, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    totalMinor: { type: Number, default: 0 },
    deliveredQuantity: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const technicalSchema = sub({
  printDirection: { type: String, enum: PRINT_DIRECTIONS },
  printOptions: {
    linesGuides: { type: Boolean, default: true },
    logo: { type: Boolean, default: false },
  },
  printMaterial: { type: String, enum: MATERIALS },
  laminationMaterial: { type: String, enum: MATERIALS },
  colors: {
    base: [{ type: String, enum: BASE_COLORS }],
    pantone: [sub({ code: String, name: String, hex: String })],
    baseCount: { type: Number, default: 0 },
    pantoneCount: { type: Number, default: 0 },
    totalCount: { type: Number, default: 0 },
  },
  photocells: { left: photocellDef, right: photocellDef },
  barcode: { enabled: { type: Boolean, default: false }, number: String },
  dimensions: {
    printMaterialSizeMm: Number,
    lineRepeat: Number,
    cylinder: Number,
    cylinderRepeat: Number,
    lineWidthMm: Number,
    rowHeightMm: Number,
    printWidthMm: Number,
    plateHeightMm: Number,
    totalCm: Number,
  },
  displacementType: String,
  plate: { type: { type: String }, thicknessMm: Number },
  machineSpecifications: {
    printWidthMm: Number,
    maxColors: Number,
    distortion: Number,
    lpi: Number,
  },
});

const orderSchema = makeSchema({
  jobCode: { type: String, required: true, unique: true },
  jobName: { type: String, required: true, trim: true, maxlength: 200 },
  clientId: { type: ObjectId, ref: "Client", required: true, index: true },
  assignedManagerId: { type: ObjectId, ref: "User", index: true },
  assignedPrinterId: { type: ObjectId, ref: "Printer", index: true },
  machineId: { type: ObjectId, ref: "Machine" },
  quotationId: { type: ObjectId, ref: "Quotation" },
  reorderOfId: { type: ObjectId, ref: "Order" },
  subCustomer: String,
  status: { type: String, enum: ORDER_STATUSES, required: true, index: true },
  priority: { type: String, enum: PRIORITIES, default: "normal" },
  approval: {
    status: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
    },
    decidedBy: { type: ObjectId, ref: "User" },
    decidedAt: Date,
    comment: String,
  },
  requestedDeliveryDate: Date,
  confirmedDeliveryDate: Date,
  customerNotes: String,
  internalNotes: String,
  printerNotes: String,
  lineItems: [lineItemSchema],
  technicalSpecifications: technicalSchema,
  designLinks: [
    sub({
      url: String,
      label: String,
      host: String,
      addedBy: { type: ObjectId, ref: "User" },
      addedAt: Date,
    }),
  ],
  fileAssetIds: [{ type: ObjectId, ref: "FileAsset" }],
  issues: [
    sub(
      {
        kind: { type: String, enum: ["technical", "delay", "non_conformity"] },
        description: String,
        reportedBy: { type: ObjectId, ref: "User" },
        reportedAt: Date,
        resolvedAt: Date,
        resolvedBy: { type: ObjectId, ref: "User" },
      },
      { _id: true },
    ),
  ],
  statusHistory: [
    sub({
      from: String,
      to: String,
      by: { type: ObjectId, ref: "User" },
      byRole: String,
      at: Date,
      note: String,
      fileAssetId: { type: ObjectId, ref: "FileAsset" },
    }),
  ],
  activityHistory: [
    sub({
      action: String,
      by: { type: ObjectId, ref: "User" },
      byName: String,
      at: Date,
      visibility: {
        type: String,
        enum: ["public", "internal"],
        default: "public",
      },
      details: Schema.Types.Mixed,
    }),
  ],
  estimatedCostMinor: { type: Number, default: 0 },
  actualCostMinor: { type: Number, default: 0 },
  subtotalMinor: { type: Number, default: 0 },
  discountTotalMinor: { type: Number, default: 0 },
  taxTotalMinor: { type: Number, default: 0 },
  grandTotalMinor: { type: Number, default: 0 },
  currency: { type: String, default: "DZD" },
  invoiceIds: [{ type: ObjectId, ref: "Invoice" }],
  deliveryIds: [{ type: ObjectId, ref: "Delivery" }],
  idempotencyKey: String,
  ...archiveFields,
  ...auditFields,
});
orderSchema.index(
  { createdBy: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);
orderSchema.index(
  { quotationId: 1 },
  {
    unique: true,
    partialFilterExpression: { quotationId: { $type: "objectId" } },
  },
);
orderSchema.index({ status: 1, requestedDeliveryDate: 1 });
orderSchema.index({ jobName: "text", jobCode: "text" });

export type OrderAttrs = InferSchemaType<typeof orderSchema>;
export const Order = mongoose.model<any>("Order", orderSchema);
