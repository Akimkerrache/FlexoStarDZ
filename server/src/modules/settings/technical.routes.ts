import mongoose from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { can } from "../../config/permissions.js";
import {
  makeSchema,
  archiveFields,
  auditFields,
} from "../../database/index.js";
import { createCrudRouter } from "../shared/crud.js";
import {
  asyncHandler,
  created,
  validate,
  requireAuth,
  ApiError,
} from "../../utils/http.js";
import { authenticate } from "../../middleware/index.js";
import { audit } from "../audit-logs/audit.service.js";

const optionSchema = makeSchema({
  group: {
    type: String,
    required: true,
    enum: [
      "plateType",
      "displacementType",
      "material",
      "nonConformityType",
      "expenseCategory",
    ],
    index: true,
  },
  code: { type: String, required: true, trim: true },
  label: { type: String, required: true },
  labelAr: String,
  sortOrder: { type: Number, default: 0 },
  ...archiveFields,
  ...auditFields,
});
optionSchema.index({ group: 1, code: 1 }, { unique: true });
export const TechnicalOption = mongoose.model<any>("TechnicalOption", optionSchema);

export const optionsRouter = createCrudRouter({
  model: TechnicalOption,
  name: "TechnicalOption",
  create: z.object({
    group: z.enum([
      "plateType",
      "displacementType",
      "material",
      "nonConformityType",
      "expenseCategory",
    ]),
    code: z.string().trim().min(1).max(60),
    label: z.string().trim().min(1).max(120),
    labelAr: z.string().trim().max(120).optional(),
    sortOrder: z.number().int().optional(),
  }),
  searchFields: ["label", "code"],
  filterFields: ["group"],
  read: () => true,
  write: (a) => can(a, "machines.manage") || can(a, "catalog.manage"),
});

const pantoneSchema = makeSchema({
  code: { type: String, required: true, unique: true, trim: true },
  name: String,
  hex: { type: String, match: /^#[0-9a-fA-F]{6}$/ },
  ...archiveFields,
  ...auditFields,
});
export const PantoneColor = mongoose.model<any>("PantoneColor", pantoneSchema);

const pantoneInput = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().max(100).optional(),
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

const pantoneCrud = createCrudRouter({
  model: PantoneColor,
  name: "PantoneColor",
  create: pantoneInput,
  searchFields: ["code", "name"],
  read: () => true,
  write: (a) => can(a, "catalog.manage"),
});

export const pantoneRouter = Router();
pantoneRouter.post(
  "/bulk",
  authenticate,
  validate({
    body: z.object({ colors: z.array(pantoneInput).min(1).max(2000) }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!can(a, "catalog.manage")) throw ApiError.forbidden();
    const colors = req.validated!.body.colors as z.infer<typeof pantoneInput>[];
    const r = await PantoneColor.bulkWrite(
      colors.map((c) => ({
        updateOne: {
          filter: { code: c.code },
          update: {
            $set: { ...c, updatedBy: a.userId },
            $setOnInsert: { createdBy: a.userId },
          },
          upsert: true,
        },
      })),
    );
    await audit(
      a,
      "pantone.bulk_import",
      "PantoneColor",
      undefined,
      { count: colors.length },
      req,
    );
    created(res, { upserted: r.upsertedCount, modified: r.modifiedCount });
  }),
);
pantoneRouter.use(pantoneCrud);
