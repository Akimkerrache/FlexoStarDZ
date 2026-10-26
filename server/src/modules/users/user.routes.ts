import { Router } from "express";
import { z } from "zod";
import {
  ApiError,
  asyncHandler,
  created,
  idParams,
  ok,
  requireAuth,
  validate,
} from "../../utils/http.js";
import { paginate, paginationQuery } from "../../utils/pagination.js";
import { authenticate, requireRole } from "../../middleware/index.js";
import { User } from "./user.model.js";
import {
  accountInput,
  createUser,
  passwordSchema,
  publicUser,
  setUsersActive,
} from "./account.service.js";
import { hashPassword, revokeAllSessions } from "../auth/auth.service.js";
import { audit } from "../audit-logs/audit.service.js";
import { ROLES } from "../../config/permissions.js";

const router = Router();
router.use(authenticate, requireRole("admin"));

router.get(
  "/",
  validate({
    query: paginationQuery.extend({
      role: z.enum(ROLES).optional(),
      isActive: z.enum(["true", "false"]).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.validated!.query;
    const filter: any = {};
    if (q.role) filter.role = q.role;
    if (q.isActive) filter.isActive = q.isActive === "true";
    if (q.search) {
      const rx = new RegExp(
        q.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      filter.$or = [{ name: rx }, { email: rx }];
    }
    const { items, meta } = await paginate(User, filter, q, {
      allowedSort: ["name", "email", "role", "createdAt", "lastLoginAt"],
    });
    ok(res, items.map(publicUser), "OK", meta);
  }),
);

router.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const u = await User.findById(req.params.id);
    if (!u) throw ApiError.notFound("User not found");
    ok(res, publicUser(u));
  }),
);

// Only an existing administrator can create another administrator (initial admin comes from the bootstrap script).
router.post(
  "/admins",
  validate({ body: accountInput }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const u = await createUser({
      ...req.validated!.body,
      role: "admin",
      createdBy: a.userId,
    });
    await audit(a, "user.created", "User", u._id, { role: "admin" }, req);
    created(res, publicUser(u));
  }),
);

router.patch(
  "/:id",
  validate({
    params: idParams,
    body: z.object({ name: z.string().trim().min(1).max(120) }).strict(),
  }),
  asyncHandler(async (req, res) => {
    const u = await User.findByIdAndUpdate(req.params.id, req.validated!.body, {
      new: true,
    });
    if (!u) throw ApiError.notFound("User not found");
    await audit(requireAuth(req), "user.updated", "User", u._id, {}, req);
    ok(res, publicUser(u));
  }),
);

const setActive = (active: boolean) =>
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    if (!active && a.userId === req.params.id)
      throw ApiError.unprocessable(
        "You cannot deactivate your own account",
        "SELF_DEACTIVATION",
      );
    const u = await User.findById(req.params.id);
    if (!u) throw ApiError.notFound("User not found");
    if (
      !active &&
      u.role === "admin" &&
      (await User.countDocuments({
        role: "admin",
        isActive: true,
        _id: { $ne: u._id },
      })) === 0
    ) {
      throw ApiError.unprocessable(
        "Cannot deactivate the last active administrator",
        "LAST_ADMIN",
      );
    }
    await setUsersActive({ _id: u._id }, active);
    await audit(
      a,
      active ? "user.activated" : "user.deactivated",
      "User",
      u._id,
      { role: u.role },
      req,
    );
    ok(res, publicUser(await User.findById(u._id)));
  });
router.post("/:id/activate", validate({ params: idParams }), setActive(true));
router.post(
  "/:id/deactivate",
  validate({ params: idParams }),
  setActive(false),
);

router.post(
  "/:id/reset-password",
  validate({
    params: idParams,
    body: z.object({ newPassword: passwordSchema }),
  }),
  asyncHandler(async (req, res) => {
    const u = await User.findByIdAndUpdate(req.params.id, {
      passwordHash: await hashPassword(req.validated!.body.newPassword),
      mustChangePassword: true,
    });
    if (!u) throw ApiError.notFound("User not found");
    await revokeAllSessions(u._id);
    await audit(
      requireAuth(req),
      "user.password_reset",
      "User",
      u._id,
      {},
      req,
    );
    ok(res, null, "Password reset");
  }),
);

export default router;
