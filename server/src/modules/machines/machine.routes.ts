import mongoose from "mongoose";
import { z } from "zod";
import { can } from "../../config/permissions.js";
import {
  makeSchema,
  archiveFields,
  auditFields,
  ObjectId,
} from "../../database/index.js";
import { createCrudRouter, assertRef } from "../shared/crud.js";
import { objectId } from "../../utils/http.js";

const machineSchema = makeSchema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  name: { type: String, required: true, trim: true, index: true },
  printWidthMm: { type: Number, min: 0 },
  maxColors: { type: Number, min: 1, max: 20 },
  thicknessMm: { type: Number, min: 0 },
  distortionFactor: { type: Number, min: 0 },
  defaultLpi: { type: Number, min: 0 },
  plateType: String,
  repeatMinMm: Number,
  repeatMaxMm: Number,
  cylinderCircumferenceMm: Number,
  clientId: { type: ObjectId, ref: "Client" },
  printerId: { type: ObjectId, ref: "Printer" },
  notes: String,
  ...archiveFields,
  ...auditFields,
});
export const Machine = mongoose.model<any>("Machine", machineSchema);

const pos = z.number().positive().max(100000);
const machineInput = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  printWidthMm: pos.optional(),
  maxColors: z.number().int().min(1).max(20).optional(),
  thicknessMm: pos.optional(),
  distortionFactor: z.number().min(0).max(10).optional(),
  defaultLpi: pos.optional(),
  plateType: z.string().trim().max(60).optional(),
  repeatMinMm: pos.optional(),
  repeatMaxMm: pos.optional(),
  cylinderCircumferenceMm: pos.optional(),
  clientId: objectId.nullable().optional(),
  printerId: objectId.nullable().optional(),
  notes: z.string().max(2000).optional(),
});

export default createCrudRouter({
  model: Machine,
  name: "Machine",
  create: machineInput,
  searchFields: ["name", "code"],
  read: () => true,
  write: (a) => can(a, "machines.manage"),
  // Clients/printers only see generic machines or the ones associated with them.
  scope: (a) =>
    a.role === "client"
      ? { isActive: true, $or: [{ clientId: null }, { clientId: a.clientId }] }
      : a.role === "printer"
        ? {
            isActive: true,
            $or: [{ printerId: null }, { printerId: a.printerId }],
          }
        : {},
  beforeSave: async (d) => {
    await assertRef(mongoose.model<any>("Client"), d.clientId, "client");
    await assertRef(mongoose.model<any>("Printer"), d.printerId, "printer");
    return d;
  },
  serialize: (d, a) => {
    if (a.role === "admin" || a.role === "manager") return d;
    const { notes: _n, ...rest } = d;
    return rest;
  },
});
