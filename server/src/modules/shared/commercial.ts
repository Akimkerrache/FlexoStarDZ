import mongoose from "mongoose";
import { z } from "zod";
import { ObjectId } from "../../database/index.js";
import { computeMargin, computeTotals } from "../../utils/money.js";
import { objectId } from "../../utils/http.js";

export const commercialLineSchema = new mongoose.Schema(
  {
    catalogItemId: { type: ObjectId, ref: "CatalogItem" },
    orderId: { type: ObjectId, ref: "Order" },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, default: "unit" },
    unitPriceMinor: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    // Applied only when explicitly supplied: no tax rule is assumed (open decision #8).
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    unitCostMinor: { type: Number, default: 0, min: 0 },
    attributes: [
      new mongoose.Schema({ key: String, value: String }, { _id: false }),
    ],
    totalMinor: { type: Number, default: 0 },
  },
  { _id: true },
);

export const commercialLineInput = z.object({
  catalogItemId: objectId.optional(),
  orderId: objectId.optional(),
  description: z.string().trim().min(1).max(300),
  quantity: z.number().finite().positive().max(1e9),
  unit: z.string().trim().max(30).optional(),
  unitPriceMinor: z.number().int().min(0),
  discountPercent: z.number().min(0).max(100).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  unitCostMinor: z.number().int().min(0).optional(),
  attributes: z
    .array(z.object({ key: z.string().max(60), value: z.string().max(200) }))
    .max(30)
    .optional(),
});
export type CommercialLineInput = z.infer<typeof commercialLineInput>;

export const totalsDef = {
  subtotalMinor: { type: Number, default: 0 },
  discountTotalMinor: { type: Number, default: 0 },
  taxTotalMinor: { type: Number, default: 0 },
  grandTotalMinor: { type: Number, default: 0 },
};

/** Server-side recalculation: totals sent by the browser are never trusted. */
export function priceCommercialLines(lines: CommercialLineInput[]) {
  const t = computeTotals(lines);
  const estimatedCostMinor = lines.reduce(
    (s, l) => s + Math.round(l.quantity * (l.unitCostMinor ?? 0)),
    0,
  );
  const net = t.grandTotalMinor - t.taxTotalMinor;
  return {
    lines: lines.map((l, i) => ({
      ...l,
      unit: l.unit ?? "unit",
      discountPercent: l.discountPercent ?? 0,
      taxPercent: l.taxPercent ?? 0,
      unitCostMinor: l.unitCostMinor ?? 0,
      totalMinor: t.lines[i].totalMinor,
    })),
    subtotalMinor: t.subtotalMinor,
    discountTotalMinor: t.discountTotalMinor,
    taxTotalMinor: t.taxTotalMinor,
    grandTotalMinor: t.grandTotalMinor,
    estimatedCostMinor,
    ...computeMargin(net, estimatedCostMinor),
  };
}
