import { z } from "zod";
import {
  makeSchema,
  archiveFields,
  auditFields,
  ObjectId,
} from "../../database/index.js";
import mongoose from "mongoose";

export const addressSchema = z.object({
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(100).optional(),
});
export const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  position: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
});

export const addressDef = {
  line1: String,
  line2: String,
  city: String,
  state: String,
  postalCode: String,
  country: String,
};
export const contactDef = {
  name: String,
  position: String,
  email: String,
  phone: String,
};

const clientSchema = makeSchema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
  },
  legalName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
    index: true,
  },
  email: { type: String, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true },
  contacts: [new mongoose.Schema(contactDef, { _id: false })],
  address: addressDef,
  // Free-form administrative identifiers; legal/tax field rules are pending Flexostar's accounting validation.
  administrative: {
    registrationNumber: String,
    taxIdentifier: String,
    notes: String,
  },
  commercial: {
    paymentTermsDays: { type: Number, min: 0 },
    conditions: String,
    negotiatedPricing: [
      new mongoose.Schema(
        {
          catalogItemId: { type: ObjectId, ref: "CatalogItem" },
          unitPriceMinor: { type: Number, min: 0 },
          currency: String,
        },
        { _id: false },
      ),
    ],
  },
  internalNotes: String,
  ...archiveFields,
  ...auditFields,
});
clientSchema.index({ legalName: "text", code: "text" });
export const Client = mongoose.model<any>("Client", clientSchema);

export const clientInput = z.object({
  code: z.string().trim().min(2).max(30).optional(),
  legalName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  contacts: z.array(contactSchema).max(20).optional(),
  address: addressSchema.optional(),
  administrative: z
    .object({
      registrationNumber: z.string().max(60).optional(),
      taxIdentifier: z.string().max(60).optional(),
      notes: z.string().max(1000).optional(),
    })
    .optional(),
  commercial: z
    .object({
      paymentTermsDays: z.number().int().min(0).max(365).optional(),
      conditions: z.string().max(2000).optional(),
      negotiatedPricing: z
        .array(
          z.object({
            catalogItemId: z.string().regex(/^[a-f\d]{24}$/i),
            unitPriceMinor: z.number().int().min(0),
            currency: z.string().length(3).optional(),
          }),
        )
        .max(200)
        .optional(),
    })
    .optional(),
  internalNotes: z.string().max(5000).optional(),
});
