import { Router } from "express";
import { z } from "zod";
import {
  ApiError,
  asyncHandler,
  idParams,
  ok,
  requireAuth,
  validate,
} from "../../utils/http.js";
import { paginate, paginationQuery } from "../../utils/pagination.js";
import { authenticate, requireRole } from "../../middleware/index.js";
import { Notification } from "./notification.model.js";
import { runAlertScan } from "./alerts.js";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  validate({
    query: paginationQuery.extend({ unread: z.enum(["true"]).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const q = req.validated!.query;
    const filter: any = { userId: a.userId };
    if (q.unread) filter.readAt = null;
    const { items, meta } = await paginate(Notification, filter, q, {
      allowedSort: ["createdAt"],
    });
    ok(res, items, "OK", {
      ...meta,
      unread: await Notification.countDocuments({
        userId: a.userId,
        readAt: null,
      }),
    });
  }),
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    await Notification.updateMany(
      { userId: requireAuth(req).userId, readAt: null },
      { readAt: new Date() },
    );
    ok(res, null, "All notifications marked as read");
  }),
);

router.post(
  "/:id/read",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: requireAuth(req).userId },
      { readAt: new Date() },
      { new: true },
    );
    if (!n) throw ApiError.notFound("Notification not found");
    ok(res, n);
  }),
);

router.post(
  "/scan",
  requireRole("admin"),
  asyncHandler(async (_req, res) =>
    ok(res, await runAlertScan(), "Alert scan completed"),
  ),
);

export default router;
