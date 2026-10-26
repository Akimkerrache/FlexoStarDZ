import mongoose from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { can, isStaff } from "../../config/permissions.js";
import {
  makeSchema,
  archiveFields,
  auditFields,
  ObjectId,
} from "../../database/index.js";
import { createCrudRouter, assertRef } from "../shared/crud.js";
import { objectId } from "../../utils/http.js";

const categorySchema = makeSchema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  name: { type: String, required: true, trim: true },
  nameAr: String,
  description: String,
  sortOrder: { type: Number, default: 0 },
  ...archiveFields,
  ...auditFields,
});
export const ProductCategory = mongoose.model<any>(
  "ProductCategory",
  categorySchema,
);

const itemSchema = makeSchema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  name: { type: String, required: true, trim: true, index: true },
  nameAr: String,
  categoryId: {
    type: ObjectId,
    ref: "ProductCategory",
    required: true,
    index: true,
  },
  description: String,
  unit: { type: String, required: true, default: "unit" },
  attributes: [
    new mongoose.Schema({ key: String, value: String }, { _id: false }),
  ],
  purchaseCostMinor: { type: Number, min: 0, default: 0 },
  sellingPriceMinor: { type: Number, min: 0, default: 0 },
  currency: { type: String, default: "DZD" },
  supplierIds: [{ type: ObjectId, ref: "Supplier" }],
  /** Configurable pricing rules; concrete commercial values are entered by authorised users. */
  pricingRules: [
    new mongoose.Schema(
      {
        name: String,
        kind: {
          type: String,
          enum: [
            "per_unit",
            "per_cm2",
            "minimum_charge",
            "percent_discount",
            "fixed_fee",
          ],
        },
        value: Number,
        notes: String,
      },
      { _id: false },
    ),
  ],
  ...archiveFields,
  ...auditFields,
});
export const CatalogItem = mongoose.model<any>("CatalogItem", itemSchema);

export const categoryRouter = createCrudRouter({
  model: ProductCategory,
  name: "ProductCategory",
  create: z.object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9_-]+$/i),
    name: z.string().trim().min(1).max(120),
    nameAr: z.string().trim().max(120).optional(),
    description: z.string().max(1000).optional(),
    sortOrder: z.number().int().optional(),
  }),
  searchFields: ["name", "code"],
  sortFields: ["name", "code", "sortOrder"],
  read: (a) => isStaff(a) || a.role === "client",
  write: (a) => can(a, "catalog.manage"),
});

const itemInput = z.object({
  code: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().max(200).optional(),
  categoryId: objectId,
  description: z.string().max(3000).optional(),
  unit: z.string().trim().min(1).max(30).optional(),
  attributes: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        value: z.string().max(200),
      }),
    )
    .max(50)
    .optional(),
  purchaseCostMinor: z.number().int().min(0).optional(),
  sellingPriceMinor: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  supplierIds: z.array(objectId).max(50).optional(),
  pricingRules: z
    .array(
      z.object({
        name: z.string().max(100),
        kind: z.enum([
          "per_unit",
          "per_cm2",
          "minimum_charge",
          "percent_discount",
          "fixed_fee",
        ]),
        value: z.number().min(0),
        notes: z.string().max(300).optional(),
      }),
    )
    .max(50)
    .optional(),
});

export const itemRouter = createCrudRouter({
  model: CatalogItem,
  name: "CatalogItem",
  create: itemInput,
  searchFields: ["name", "code", "description"],
  filterFields: ["categoryId"],
  read: (a) => isStaff(a) || a.role === "client",
  write: (a) => can(a, "catalog.manage"),
  scope: (a) => (a.role === "client" ? { isActive: true } : {}),
  codePrefix: "ITM",
  populate: { path: "categoryId", select: "name nameAr code" },
  // Purchase costs and suppliers are internal; clients only see selling information.
  serialize: (d, a) => {
    if (a.role !== "client") return d;
    const {
      purchaseCostMinor: _p,
      supplierIds: _s,
      pricingRules: _r,
      createdBy: _c,
      updatedBy: _u,
      ...rest
    } = d;
    return rest;
  },
  beforeSave: async (d) => {
    await assertRef(ProductCategory, d.categoryId, "category");
    for (const id of d.supplierIds ?? [])
      await assertRef(mongoose.model<any>("Supplier"), id, "supplier");
    return d;
  },
});

export const DEFAULT_CATEGORIES = [
  {
    code: "graphic-design",
    name: "Graphic design and artwork services",
    nameAr: "خدمات التصميم الجرافيكي",
    sortOrder: 1,
  },
  {
    code: "photopolymer-plates",
    name: "Photopolymer plates",
    nameAr: "كليشيهات فوتوبوليمر",
    sortOrder: 2,
  },
  {
    code: "neutral-rolls",
    name: "Neutral packaging rolls",
    nameAr: "بكرات تغليف عادية",
    sortOrder: 3,
  },
  {
    code: "printed-rolls",
    name: "Printed packaging rolls",
    nameAr: "بكرات تغليف مطبوعة",
    sortOrder: 4,
  },
  {
    code: "neutral-bags",
    name: "Neutral bags",
    nameAr: "أكياس عادية",
    sortOrder: 5,
  },
  {
    code: "printed-bags",
    name: "Printed bags",
    nameAr: "أكياس مطبوعة",
    sortOrder: 6,
  },
  {
    code: "printing-subcontracting",
    name: "Printing and subcontracted services",
    nameAr: "خدمات الطباعة والمناولة",
    sortOrder: 7,
  },
];

export const catalogRouter = Router();
catalogRouter.use("/categories", categoryRouter);
catalogRouter.use("/items", itemRouter);
