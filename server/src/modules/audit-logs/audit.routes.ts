import { Router } from "express";
import { z } from "zod";
import {
  asyncHandler,
  escapeRegex,
  ok,
  validate,
  objectId,
} from "../../utils/http.js";
import { paginate, paginationQuery } from "../../utils/pagination.js";
import { authenticate, requireRole } from "../../middleware/index.js";
import { AuditLog } from "./audit.service.js";

const router = Router();
router.use(authenticate, requireRole("admin"));

router.get(
  "/",
  validate({
    query: paginationQuery.extend({
      action: z.string().max(100).optional(),
      targetType: z.string().max(60).optional(),
      targetId: z.string().max(60).optional(),
      actorId: objectId.optional(),
      dateFrom: z.coerce.date().optional(),
      dateTo: z.coerce.date().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.validated!.query;
    const filter: any = {};
    if (q.action) filter.action = new RegExp(`^${escapeRegex(q.action)}`);
    for (const k of ["targetType", "targetId", "actorId"] as const)
      if (q[k]) filter[k] = q[k];
    if (q.dateFrom || q.dateTo)
      filter.createdAt = {
        ...(q.dateFrom && { $gte: q.dateFrom }),
        ...(q.dateTo && { $lte: q.dateTo }),
      };
    if (q.search) filter.action = new RegExp(escapeRegex(q.search), "i");
    const { items, meta } = await paginate(AuditLog, filter, q, {
      allowedSort: ["createdAt", "action"],
      populate: { path: "actorId", select: "name email role" },
    });
    ok(res, items, "OK", meta);
  }),
);

export default router;
