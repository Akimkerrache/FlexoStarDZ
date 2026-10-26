import mongoose from "mongoose";
import { z } from "zod";
import { can } from "../../config/permissions.js";
import {
  makeSchema,
  archiveFields,
  auditFields,
  ObjectId,
} from "../../database/index.js";
import { createCrudRouter } from "../shared/crud.js";
import {
  addressDef,
  addressSchema,
  contactSchema,
  contactDef,
} from "../clients/client.model.js";
import { objectId } from "../../utils/http.js";

const supplierSchema = makeSchema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  type: {
    type: String,
    enum: ["supplier", "subcontractor"],
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true, index: true },
  email: { type: String, lowercase: true, trim: true },
  phone: String,
  address: addressDef,
  contacts: [new mongoose.Schema(contactDef, { _id: false })],
  administrative: { registrationNumber: String, taxIdentifier: String },
  services: [String],
  negotiatedPrices: [
    new mongoose.Schema(
      {
        catalogItemId: { type: ObjectId, ref: "CatalogItem" },
        description: String,
        unitPriceMinor: { type: Number, min: 0 },
        currency: String,
      },
      { _id: false },
    ),
  ],
  leadTimeDays: { type: Number, min: 0 },
  notes: String,
  ...archiveFields,
  ...auditFields,
});
export const Supplier = mongoose.model<any>("Supplier", supplierSchema);

const supplierInput = z.object({
  code: z.string().trim().min(2).max(30).optional(),
  type: z.enum(["supplier", "subcontractor"]),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  address: addressSchema.optional(),
  contacts: z.array(contactSchema).max(20).optional(),
  administrative: z
    .object({
      registrationNumber: z.string().max(60).optional(),
      taxIdentifier: z.string().max(60).optional(),
    })
    .optional(),
  services: z.array(z.string().trim().max(100)).max(50).optional(),
  negotiatedPrices: z
    .array(
      z.object({
        catalogItemId: objectId.optional(),
        description: z.string().max(200).optional(),
        unitPriceMinor: z.number().int().min(0),
        currency: z.string().length(3).optional(),
      }),
    )
    .max(200)
    .optional(),
  leadTimeDays: z.number().int().min(0).max(1000).optional(),
  notes: z.string().max(5000).optional(),
});

// Supplier data (including confidential pricing) is staff-only; clients and printers have no access at all.
export default createCrudRouter({
  model: Supplier,
  name: "Supplier",
  create: supplierInput,
  searchFields: ["name", "code", "email", "services"],
  filterFields: ["type"],
  read: (a) => can(a, "suppliers.view") || can(a, "suppliers.manage"),
  write: (a) => can(a, "suppliers.manage"),
  codePrefix: "SUP",
});
