import { Router } from "express";
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
} from "../../utils/http.js";
import { createCrudRouter } from "../shared/crud.js";
import { authenticate } from "../../middleware/index.js";
import { Client, clientInput } from "./client.model.js";
import {
  accountInput,
  createUser,
  publicUser,
  setUsersActive,
} from "../users/account.service.js";
import { User } from "../users/user.model.js";
import { audit } from "../audit-logs/audit.service.js";
import { Order } from "../orders/order.model.js";
import { Invoice } from "../invoices/invoice.model.js";
import { Types } from "mongoose";

const input = clientInput.extend({ account: accountInput.optional() });

const crud = createCrudRouter({
  model: Client,
  name: "Client",
  create: input,
  update: clientInput.partial(),
  searchFields: ["legalName", "code", "email", "phone"],
  read: (a) => (isStaff(a) ? can(a, "clients.view") : a.role === "client"),
  write: (a) => can(a, "clients.manage"),
  scope: (a) =>
    a.role === "client" ? (a.clientId ? { _id: a.clientId } : null) : {},
  codePrefix: "CLI",
  // Clients may read their own company profile, never internal observations or negotiated pricing of others.
  serialize: (d, a) => {
    if (a.role === "admin" || can(a, "clients.manage")) return d;
    const { internalNotes: _n, ...rest } = d;
    return rest;
  },
  beforeSave: async (data) => {
    const { account, ...rest } = data;
    if (account && (await User.exists({ email: account.email })))
      throw ApiError.conflict(
        "A user with this email already exists",
        "EMAIL_TAKEN",
      );
    return rest;
  },
  afterCreate: async (doc, a, inputBody, req) => {
    if (inputBody.account) {
      const u = await createUser({
        ...inputBody.account,
        role: "client",
        clientId: doc._id,
        createdBy: a.userId,
      });
      await audit(
        a,
        "user.created",
        "User",
        u._id,
        { role: "client", clientId: String(doc._id) },
        req,
      );
    }
  },
  afterUpdate: async (doc) => {
    if (!doc.isActive) await setUsersActive({ clientId: doc._id }, false);
  },
});

const router = Router();
router.use(crud);

// Account management and financial snapshot (declared after CRUD so they share the same base path)
const extra = Router();
extra.use(authenticate);

extra.get(
  "/:id/users",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (a.role !== "admin") throw ApiError.forbidden();
    ok(res, (await User.find({ clientId: req.params.id })).map(publicUser));
  }),
);

extra.post(
  "/:id/users",
  validate({ params: idParams, body: accountInput }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (a.role !== "admin")
      throw ApiError.forbidden(
        "Only an administrator can create client accounts",
      );
    if (!(await Client.exists({ _id: req.params.id, isActive: true })))
      throw ApiError.notFound("Client not found");
    const u = await createUser({
      ...req.validated!.body,
      role: "client",
      clientId: req.params.id,
      createdBy: a.userId,
    });
    await audit(
      a,
      "user.created",
      "User",
      u._id,
      { role: "client", clientId: req.params.id },
      req,
    );
    created(res, publicUser(u));
  }),
);

extra.get(
  "/:id/summary",
  validate({ params: idParams, query: z.object({}).passthrough() }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const id = req.params.id;
    const allowed =
      a.role === "client" ? a.clientId === id : can(a, "clients.view");
    if (!allowed) throw ApiError.forbidden();
    const oid = new Types.ObjectId(id);
    const showMoney = a.role === "client" || can(a, "finance.view");
    const [orders, inv] = await Promise.all([
      Order.aggregate([
        { $match: { clientId: oid } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      showMoney
        ? Invoice.aggregate([
            {
              $match: {
                type: "client",
                clientId: oid,
                status: { $nin: ["draft", "cancelled"] },
              },
            },
            {
              $group: {
                _id: null,
                invoiced: { $sum: "$grandTotalMinor" },
                paid: { $sum: "$amountPaidMinor" },
              },
            },
          ])
        : Promise.resolve([]),
    ]);
    ok(res, {
      ordersByStatus: Object.fromEntries(
        orders.map((o: any) => [o._id, o.count]),
      ),
      ...(showMoney
        ? {
            invoicedMinor: inv[0]?.invoiced ?? 0,
            paidMinor: inv[0]?.paid ?? 0,
            outstandingMinor: (inv[0]?.invoiced ?? 0) - (inv[0]?.paid ?? 0),
          }
        : {}),
    });
  }),
);
router.use(extra);

export default router;
