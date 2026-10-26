import { Router } from "express";
import mongoose, { type Model } from "mongoose";
import { z } from "zod";
import { can, isStaff } from "../../config/permissions.js";
import {
  ApiError,
  asyncHandler,
  created,
  idParams,
  ok,
  requireAuth,
  validate,
  objectId,
} from "../../utils/http.js";
import { createCrudRouter, assertRef } from "../shared/crud.js";
import { authenticate } from "../../middleware/index.js";
import {
  makeSchema,
  archiveFields,
  auditFields,
  ObjectId,
} from "../../database/index.js";
import { addressDef, addressSchema } from "../clients/client.model.js";
import {
  accountInput,
  createUser,
  publicUser,
  setUsersActive,
} from "../users/account.service.js";
import { User } from "../users/user.model.js";
import { audit } from "../audit-logs/audit.service.js";
import { Machine } from "../machines/machine.routes.js";

const printerSchema = makeSchema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
    index: true,
  },
  contactPerson: String,
  email: { type: String, lowercase: true, trim: true },
  phone: String,
  address: addressDef,
  machineIds: [{ type: ObjectId, ref: "Machine" }],
  capabilities: [String],
  technicalSpecs: String,
  notes: String,
  ...archiveFields,
  ...auditFields,
});
export const Printer = mongoose.model<any>("Printer", printerSchema);

const printerInput = z.object({
  code: z.string().trim().min(2).max(30).optional(),
  name: z.string().trim().min(1).max(200),
  contactPerson: z.string().trim().max(120).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  address: addressSchema.optional(),
  machineIds: z.array(objectId).max(50).optional(),
  capabilities: z.array(z.string().trim().max(100)).max(50).optional(),
  technicalSpecs: z.string().max(3000).optional(),
  notes: z.string().max(5000).optional(),
});

const crud = createCrudRouter({
  model: Printer,
  name: "Printer",
  create: printerInput.extend({ account: accountInput.optional() }),
  update: printerInput.partial(),
  searchFields: ["name", "code", "contactPerson", "email"],
  read: (a) => (isStaff(a) ? can(a, "printers.view") : a.role === "printer"),
  write: (a) => a.role === "admin",
  scope: (a) =>
    a.role === "printer" ? (a.printerId ? { _id: a.printerId } : null) : {},
  codePrefix: "PRT",
  serialize: (d, a) => {
    if (a.role !== "printer") return d;
    const { notes: _n, ...rest } = d;
    return rest;
  },
  beforeSave: async (data) => {
    const { account, ...rest } = data;
    if (account && (await User.exists({ email: account.email })))
      throw ApiError.conflict(
        "A user with this email already exists",
        "EMAIL_TAKEN",
      );
    for (const id of rest.machineIds ?? [])
      await assertRef(Machine as Model<any>, id, "machine");
    return rest;
  },
  afterCreate: async (doc, a, body, req) => {
    if (body.account) {
      const u = await createUser({
        ...body.account,
        role: "printer",
        printerId: doc._id,
        createdBy: a.userId,
      });
      await audit(
        a,
        "user.created",
        "User",
        u._id,
        { role: "printer", printerId: String(doc._id) },
        req,
      );
    }
  },
  afterUpdate: async (doc) => {
    if (!doc.isActive) await setUsersActive({ printerId: doc._id }, false);
  },
});

const router = Router();
router.use(crud);
const extra = Router();
extra.use(authenticate);
extra.get(
  "/:id/users",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    if (requireAuth(req).role !== "admin") throw ApiError.forbidden();
    ok(res, (await User.find({ printerId: req.params.id })).map(publicUser));
  }),
);
extra.post(
  "/:id/users",
  validate({ params: idParams, body: accountInput }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (a.role !== "admin")
      throw ApiError.forbidden(
        "Only an administrator can create printer accounts",
      );
    if (!(await Printer.exists({ _id: req.params.id, isActive: true })))
      throw ApiError.notFound("Printer not found");
    const u = await createUser({
      ...req.validated!.body,
      role: "printer",
      printerId: req.params.id,
      createdBy: a.userId,
    });
    await audit(
      a,
      "user.created",
      "User",
      u._id,
      { role: "printer", printerId: req.params.id },
      req,
    );
    created(res, publicUser(u));
  }),
);
router.use(extra);
export default router;
