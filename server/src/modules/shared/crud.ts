import { Router, type Request } from "express";
import type { FilterQuery, Model } from "mongoose";
import { z, type ZodObject, type ZodRawShape } from "zod";
import { type AuthContext } from "../../config/permissions.js";
import {
  ApiError,
  asyncHandler,
  created,
  escapeRegex,
  idParams,
  ok,
  requireAuth,
  validate,
} from "../../utils/http.js";
import { paginate, paginationQuery } from "../../utils/pagination.js";
import { authenticate } from "../../middleware/index.js";
import { audit } from "../audit-logs/audit.service.js";
import { nextCode } from "../../database/index.js";

export interface CrudOptions {
  model: Model<any>;
  /** Used for audit target type and error messages, e.g. "Client". */
  name: string;
  create: ZodObject<ZodRawShape>;
  update?: ZodObject<ZodRawShape>;
  searchFields: string[];
  /** Query params that may be used as exact-match filters. */
  filterFields?: string[];
  sortFields?: string[];
  read: (a: AuthContext) => boolean;
  write: (a: AuthContext) => boolean;
  /** Extra read filter. Return null to deny all access. */
  scope?: (a: AuthContext) => FilterQuery<any> | null;
  codePrefix?: string;
  serialize?: (doc: any, a: AuthContext) => any;
  beforeSave?: (
    data: any,
    a: AuthContext,
    existing?: any,
  ) => Promise<any | void>;
  afterCreate?: (
    doc: any,
    a: AuthContext,
    input: any,
    req: Request,
  ) => Promise<void>;
  afterUpdate?: (doc: any, a: AuthContext, before: any) => Promise<void>;
  populate?: any;
  /** Extra filter applied to the list for non-staff users (e.g. only active records). */
  clientVisibleFilter?: FilterQuery<any>;
}

export function createCrudRouter(o: CrudOptions) {
  const router = Router();
  router.use(authenticate);
  const serialize = (d: any, a: AuthContext) =>
    o.serialize ? o.serialize(d.toJSON ? d.toJSON() : d, a) : d;
  const updateSchema = (o.update ?? o.create.partial()).strict();

  const readFilter = (a: AuthContext): FilterQuery<any> => {
    if (!o.read(a)) throw ApiError.forbidden();
    const s = o.scope ? o.scope(a) : {};
    if (s === null) throw ApiError.forbidden();
    return s;
  };
  const mustWrite = (a: AuthContext) => {
    if (!o.write(a)) throw ApiError.forbidden();
  };

  const listQuery = paginationQuery.extend({
    isActive: z.enum(["true", "false"]).optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
    ...Object.fromEntries(
      (o.filterFields ?? []).map((f) => [f, z.string().max(100).optional()]),
    ),
  });

  router.get(
    "/",
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const a = requireAuth(req);
      const q = req.validated!.query;
      const filter: FilterQuery<any> = { ...readFilter(a) };
      const and: FilterQuery<any>[] = [];
      if (q.includeArchived !== "true" && o.model.schema.path("archivedAt"))
        filter.archivedAt = null;
      if (q.isActive) filter.isActive = q.isActive === "true";
      for (const f of o.filterFields ?? []) if (q[f]) filter[f] = q[f];
      if (q.search) {
        const rx = new RegExp(escapeRegex(q.search), "i");
        and.push({ $or: o.searchFields.map((f) => ({ [f]: rx })) });
      }
      if (and.length) filter.$and = and;
      const { items, meta } = await paginate(o.model, filter, q, {
        allowedSort: o.sortFields ?? [
          ...o.searchFields,
          "createdAt",
          "updatedAt",
        ],
        populate: o.populate,
      });
      ok(
        res,
        items.map((d) => serialize(d, a)),
        "OK",
        meta,
      );
    }),
  );

  router.get(
    "/:id",
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const a = requireAuth(req);
      let q = o.model.findOne({ $and: [readFilter(a), { _id: req.params.id }] });
      if (o.populate) q = q.populate(o.populate);
      const doc = await q;
      if (!doc) throw ApiError.notFound(`${o.name} not found`);
      ok(res, serialize(doc, a));
    }),
  );

  router.post(
    "/",
    validate({ body: o.create }),
    asyncHandler(async (req, res) => {
      const a = requireAuth(req);
      mustWrite(a);
      let data = { ...req.validated!.body };
      if (o.beforeSave) data = (await o.beforeSave(data, a)) ?? data;
      if (o.codePrefix && !data.code) data.code = await nextCode(o.codePrefix);
      const doc = await o.model.create({
        ...data,
        createdBy: a.userId,
        updatedBy: a.userId,
      });
      if (o.afterCreate) await o.afterCreate(doc, a, req.validated!.body, req);
      await audit(
        a,
        `${o.name.toLowerCase()}.created`,
        o.name,
        doc._id,
        { code: doc.code },
        req,
      );
      created(res, serialize(doc, a));
    }),
  );

  router.patch(
    "/:id",
    validate({ params: idParams, body: updateSchema }),
    asyncHandler(async (req, res) => {
      const a = requireAuth(req);
      mustWrite(a);
      const doc = await o.model.findById(req.params.id);
      if (!doc) throw ApiError.notFound(`${o.name} not found`);
      const before = doc.toObject();
      let data = { ...req.validated!.body };
      if (o.beforeSave) data = (await o.beforeSave(data, a, doc)) ?? data;
      doc.set({ ...data, updatedBy: a.userId });
      await doc.save();
      if (o.afterUpdate) await o.afterUpdate(doc, a, before);
      await audit(
        a,
        `${o.name.toLowerCase()}.updated`,
        o.name,
        doc._id,
        { fields: Object.keys(data) },
        req,
      );
      ok(res, serialize(doc, a), "Updated");
    }),
  );

  const setArchived = (archived: boolean) =>
    asyncHandler(async (req, res) => {
      const a = requireAuth(req);
      mustWrite(a);
      const doc = await o.model.findById(req.params.id);
      if (!doc) throw ApiError.notFound(`${o.name} not found`);
      doc.set({
        isActive: !archived,
        archivedAt: archived ? new Date() : null,
        updatedBy: a.userId,
      });
      await doc.save();
      if (o.afterUpdate) await o.afterUpdate(doc, a, {});
      await audit(
        a,
        `${o.name.toLowerCase()}.${archived ? "archived" : "restored"}`,
        o.name,
        doc._id,
        {},
        req,
      );
      ok(res, serialize(doc, a), archived ? "Archived" : "Restored");
    });
  router.post(
    "/:id/archive",
    validate({ params: idParams }),
    setArchived(true),
  );
  router.post(
    "/:id/restore",
    validate({ params: idParams }),
    setArchived(false),
  );

  return router;
}

/** Verifies that referenced documents exist (and are active) before saving. */
export async function assertRef(
  model: Model<any>,
  id: unknown,
  label: string,
  opts: { activeOnly?: boolean } = {},
) {
  if (!id) return;
  const filter: FilterQuery<any> = { _id: id };
  if (opts.activeOnly !== false && model.schema.path("isActive"))
    filter.isActive = true;
  if (!(await model.exists(filter)))
    throw ApiError.unprocessable(
      `${label} does not exist or is inactive`,
      "INVALID_REFERENCE",
      [{ field: label, message: "Invalid reference" }],
    );
}
