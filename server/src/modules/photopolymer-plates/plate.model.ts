import mongoose from "mongoose";
import { z } from "zod";
import { ApiError } from "../../utils/http.js";
import {
  makeSchema,
  archiveFields,
  auditFields,
  ObjectId,
} from "../../database/index.js";

export const PLATE_STATUSES = [
  "file_received",
  "technical_verification",
  "client_validation",
  "supplier_order",
  "engraving",
  "quality_control",
  "shipment",
  "delivered",
  "rejected",
  "cancelled",
] as const;
export type PlateStatus = (typeof PLATE_STATUSES)[number];

/** Default plate workflow derived from spec §5.3; see open decision #1/#5 for approval by Flexostar. */
export const PLATE_TRANSITIONS: Record<PlateStatus, PlateStatus[]> = {
  file_received: ["technical_verification", "cancelled"],
  technical_verification: [
    "client_validation",
    "supplier_order",
    "rejected",
    "cancelled",
  ],
  client_validation: [
    "technical_verification",
    "supplier_order",
    "rejected",
    "cancelled",
  ],
  supplier_order: ["engraving", "rejected", "cancelled"],
  engraving: ["quality_control", "rejected", "cancelled"],
  quality_control: ["shipment", "engraving", "rejected"],
  shipment: ["delivered", "rejected"],
  rejected: ["technical_verification", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function assertPlateTransition(from: PlateStatus, to: PlateStatus) {
  if (!PLATE_TRANSITIONS[from]?.includes(to))
    throw ApiError.unprocessable(
      `Plate transition ${from} -> ${to} is not allowed`,
      "TRANSITION_NOT_ALLOWED",
    );
}

/** surface (cm²) = width(mm) × height(mm) / 100, rounded to 2 decimals. */
export function computeSurfaceCm2(widthMm: unknown, heightMm: unknown): number {
  const w = Number(widthMm);
  const h = Number(heightMm);
  if (![w, h].every((n) => Number.isFinite(n) && n > 0))
    throw ApiError.unprocessable(
      "Width and height must be positive numbers (mm)",
      "INVALID_DIMENSIONS",
    );
  if (w > 100_000 || h > 100_000)
    throw ApiError.unprocessable(
      "Dimensions are unrealistically large",
      "INVALID_DIMENSIONS",
    );
  return Math.round(((w * h) / 100) * 100) / 100;
}

export interface PricingRuleLike {
  pricePerCm2Minor?: number | null;
  minimumChargeMinor?: number | null;
  discountPercent?: number | null;
  extraFeesMinor?: number | null;
}

/** Returns null when no per-cm² rate has been configured: prices must then be entered manually. */
export function computePlatePrice(
  surfaceCm2: number,
  rule?: PricingRuleLike | null,
) {
  if (!rule || rule.pricePerCm2Minor == null) return null;
  const base = Math.round(surfaceCm2 * rule.pricePerCm2Minor);
  const afterMinimum = Math.max(base, rule.minimumChargeMinor ?? 0);
  const discount = Math.round(
    (afterMinimum * (rule.discountPercent ?? 0)) / 100,
  );
  const extra = rule.extraFeesMinor ?? 0;
  return {
    baseMinor: base,
    minimumApplied: afterMinimum > base,
    discountMinor: discount,
    extraFeesMinor: extra,
    totalMinor: afterMinimum - discount + extra,
  };
}

const plateSchema = makeSchema({
  reference: { type: String, required: true, unique: true, uppercase: true },
  clientId: { type: ObjectId, ref: "Client", required: true, index: true },
  orderId: { type: ObjectId, ref: "Order", index: true },
  receivedAt: { type: Date, default: Date.now },
  originalFileId: { type: ObjectId, ref: "FileAsset" },
  widthMm: { type: Number, required: true, min: 0 },
  heightMm: { type: Number, required: true, min: 0 },
  surfaceCm2: { type: Number, required: true },
  thicknessMm: Number,
  plateType: String,
  colorsCount: Number,
  printSpecs: String,
  supplierId: { type: ObjectId, ref: "Supplier" },
  purchasePriceMinor: { type: Number, default: 0, min: 0 },
  sellingPriceMinor: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: "DZD" },
  pricing: { ruleId: ObjectId, ruleVersion: Number, breakdown: Object },
  priceHistory: [
    new mongoose.Schema(
      {
        purchasePriceMinor: Number,
        sellingPriceMinor: Number,
        by: ObjectId,
        at: Date,
        reason: String,
      },
      { _id: false },
    ),
  ],
  status: {
    type: String,
    enum: PLATE_STATUSES,
    default: "file_received",
    index: true,
  },
  plannedDate: Date,
  actualDate: Date,
  responsibleUserId: { type: ObjectId, ref: "User" },
  reusedFromId: { type: ObjectId, ref: "PhotopolymerPlate" },
  invoiceId: { type: ObjectId, ref: "Invoice" },
  productionOperationId: { type: ObjectId, ref: "ProductionOperation" },
  history: [
    new mongoose.Schema(
      { from: String, to: String, by: ObjectId, at: Date, note: String },
      { _id: false },
    ),
  ],
  operations: [
    new mongoose.Schema(
      {
        type: { type: String },
        text: String,
        by: ObjectId,
        byName: String,
        at: Date,
        internal: { type: Boolean, default: true },
      },
      { _id: true },
    ),
  ],
  ...archiveFields,
  ...auditFields,
});
plateSchema.index({ widthMm: 1, heightMm: 1 });
export const PhotopolymerPlate = mongoose.model<any>(
  "PhotopolymerPlate",
  plateSchema,
);

const pricingRuleSchema = makeSchema({
  clientId: { type: ObjectId, ref: "Client", index: true },
  version: { type: Number, required: true },
  pricePerCm2Minor: Number,
  minimumChargeMinor: Number,
  discountPercent: Number,
  extraFeesMinor: Number,
  currency: { type: String, default: "DZD" },
  note: String,
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: ObjectId, ref: "User" },
});
export const PlatePricingRule = mongoose.model<any>(
  "PlatePricingRule",
  pricingRuleSchema,
);

export const pricingRuleInput = z.object({
  clientId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
  pricePerCm2Minor: z.number().min(0).optional(),
  minimumChargeMinor: z.number().int().min(0).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  extraFeesMinor: z.number().int().min(0).optional(),
  note: z.string().max(500).optional(),
});
