import { z } from "zod";
import { env } from "../../config/env.js";
import { objectId } from "../../utils/http.js";
import {
  BASE_COLORS,
  MATERIALS,
  PRIORITIES,
  PRINT_DIRECTIONS,
  containsArabic,
  ORDER_STATUSES,
} from "./order.rules.js";

const dim = z.number().finite().min(0).max(1_000_000);
const text = (n = 200) => z.string().trim().max(n);

export const jobNameSchema = text(200)
  .min(1, "Job name is required")
  .refine((v) => !(env.JOB_NAME_REJECT_ARABIC && containsArabic(v)), {
    message:
      "Job name must not contain Arabic letters. Please use Latin characters.",
  });

export const technicalSpecsInput = z.object({
  printDirection: z.enum(PRINT_DIRECTIONS, {
    errorMap: () => ({ message: "Select a print direction" }),
  }),
  printOptions: z
    .object({
      linesGuides: z.boolean().default(false),
      logo: z.boolean().default(false),
    })
    .default({}),
  printMaterial: z.enum(MATERIALS, {
    errorMap: () => ({ message: "Select a print material" }),
  }),
  laminationMaterial: z.enum(MATERIALS).optional(),
  colors: z
    .object({
      base: z.array(z.enum(BASE_COLORS)).max(BASE_COLORS.length).default([]),
      pantone: z.array(text(40).min(1)).max(20).default([]),
    })
    .default({}),
  photocells: z
    .object({
      left: z
        .object({ mark: text(60).optional(), path: text(200).optional() })
        .optional(),
      right: z
        .object({ mark: text(60).optional(), path: text(200).optional() })
        .optional(),
    })
    .optional(),
  barcode: z
    .object({
      enabled: z.boolean().default(false),
      number: text(40).optional(),
    })
    .refine((b) => !b.enabled || !!b.number, {
      message: "Barcode number is required when barcode is enabled",
      path: ["number"],
    })
    .optional(),
  dimensions: z
    .object({
      printMaterialSizeMm: dim.optional(),
      lineRepeat: dim.optional(),
      cylinder: dim.optional(),
      cylinderRepeat: dim.optional(),
      lineWidthMm: dim.optional(),
      rowHeightMm: dim.optional(),
      printWidthMm: dim.optional(),
      plateHeightMm: dim.optional(),
      totalCm: dim.optional(),
    })
    .optional(),
  displacementType: text(60).optional(),
  plate: z
    .object({ type: text(60).optional(), thicknessMm: dim.optional() })
    .optional(),
  machineSpecifications: z
    .object({
      printWidthMm: dim.optional(),
      maxColors: dim.optional(),
      distortion: dim.optional(),
      lpi: dim.optional(),
    })
    .optional(),
});

export const lineItemInput = z.object({
  catalogItemId: objectId.optional(),
  description: text(300).min(1),
  quantity: z.number().finite().positive().max(1e9),
  unit: text(30).optional(),
  unitPriceMinor: z.number().int().min(0).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
});

const designLink = z.union([
  z.string(),
  z.object({ url: z.string(), label: text(100).optional() }),
]);

export const createOrderInput = z.object({
  clientId: objectId.optional(),
  machineId: objectId,
  jobName: jobNameSchema,
  subCustomer: text(200).optional(),
  priority: z.enum(PRIORITIES).optional(),
  requestedDeliveryDate: z.coerce.date().optional(),
  customerNotes: text(5000).optional(),
  internalNotes: text(5000).optional(),
  printerNotes: text(5000).optional(),
  lineItems: z.array(lineItemInput).max(100).optional(),
  technicalSpecifications: technicalSpecsInput,
  designLinks: z.array(designLink).max(10).optional(),
  fileAssetIds: z.array(objectId).max(50).optional(),
  /** true = send straight to approval (default); false = keep as file preparation. */
  submit: z.boolean().optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderInput>;

export const updateOrderInput = z
  .object({
    machineId: objectId,
    jobName: jobNameSchema,
    subCustomer: text(200),
    priority: z.enum(PRIORITIES),
    requestedDeliveryDate: z.coerce.date().nullable(),
    confirmedDeliveryDate: z.coerce.date().nullable(),
    customerNotes: text(5000),
    internalNotes: text(5000),
    printerNotes: text(5000),
    lineItems: z.array(lineItemInput).max(100),
    technicalSpecifications: technicalSpecsInput,
    designLinks: z.array(designLink).max(10),
    fileAssetIds: z.array(objectId).max(50),
    estimatedCostMinor: z.number().int().min(0),
  })
  .partial()
  .strict();
export type UpdateOrderInput = z.infer<typeof updateOrderInput>;

export const listOrdersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z0-9_.]+$/)
    .optional(),
  search: z.string().trim().max(100).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  clientId: objectId.optional(),
  assignedPrinterId: objectId.optional(),
  machineId: objectId.optional(),
  priority: z.enum(PRIORITIES).optional(),
  mine: z.enum(["true", "false"]).optional(),
  overdue: z.enum(["true", "false"]).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
