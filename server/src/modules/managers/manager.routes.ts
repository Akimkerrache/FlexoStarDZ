import mongoose from "mongoose";
import { Router } from "express";
import { z } from "zod";
import {
  makeSchema,
  archiveFields,
  auditFields,
  ObjectId,
} from "../../database/index.js";
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
import {
  accountInput,
  createUser,
  passwordSchema,
  permissionsSchema,
  publicUser,
  setUsersActive,
} from "../users/account.service.js";
import { User } from "../users/user.model.js";
import {
  DEFAULT_MANAGER_PERMISSIONS,
  type Permission,
} from "../../config/permissions.js";
import { audit } from "../audit-logs/audit.service.js";
import { hashPassword, revokeAllSessions } from "../auth/auth.service.js";

const managerSchema = makeSchema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true },
  phone: String,
  userId: { type: ObjectId, ref: "User", required: true, unique: true },
  responsibilities: [String],
  ...archiveFields,
  ...auditFields,
});
export const ManagerProfile = mongoose.model<any>("ManagerProfile", managerSchema);

const withPermissions = async (profiles: any[]) => {
  const users = await User.find({
    _id: { $in: profiles.map((p) => p.userId) },
  }).lean<any>();
  const map = new Map<string, any>(users.map((u: any) => [String(u._id), u]));
  return profiles.map((p) => {
    const j = p.toJSON();
    const u = map.get(String(p.userId));
    return {
      ...j,
      permissions: u?.permissions ?? [],
      lastLoginAt: u?.lastLoginAt,
    };
  });
};

// Everything here is Admin-only: managers can never grant themselves or others permissions.
const router = Router();
router.use(authenticate, requireRole("admin"));

router.get(
  "/",
  validate({
    query: paginationQuery.extend({
      isActive: z.enum(["true", "false"]).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.validated!.query;
    const filter: any = {};
    if (q.isActive) filter.isActive = q.isActive === "true";
    if (q.search)
      filter.$or = [
        {
          name: new RegExp(
            q.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i",
          ),
        },
        {
          email: new RegExp(
            q.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i",
          ),
        },
      ];
    const { items, meta } = await paginate(ManagerProfile, filter, q, {
      allowedSort: ["name", "createdAt"],
    });
    ok(res, await withPermissions(items), "OK", meta);
  }),
);

router.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const p = await ManagerProfile.findById(req.params.id);
    if (!p) throw ApiError.notFound("Manager not found");
    ok(res, (await withPermissions([p]))[0]);
  }),
);

router.post(
  "/",
  validate({
    body: accountInput.extend({
      phone: z.string().trim().max(40).optional(),
      responsibilities: z.array(z.string().trim().max(100)).max(20).optional(),
      permissions: permissionsSchema.optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const b = req.validated!.body;
    const permissions = (b.permissions ??
      DEFAULT_MANAGER_PERMISSIONS) as Permission[];
    const profile = new ManagerProfile({
      name: b.name,
      email: b.email,
      phone: b.phone,
      responsibilities: b.responsibilities,
      createdBy: a.userId,
    });
    const user = await createUser({
      name: b.name,
      email: b.email,
      password: b.password,
      role: "manager",
      managerProfileId: profile._id,
      permissions,
      createdBy: a.userId,
    });
    profile.userId = user._id;
    await profile.save();
    await audit(
      a,
      "user.created",
      "User",
      user._id,
      { role: "manager", permissions },
      req,
    );
    created(res, (await withPermissions([profile]))[0]);
  }),
);

router.patch(
  "/:id",
  validate({
    params: idParams,
    body: z
      .object({
        name: z.string().trim().min(1).max(120),
        phone: z.string().trim().max(40),
        responsibilities: z.array(z.string().trim().max(100)).max(20),
        permissions: permissionsSchema,
      })
      .partial()
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const { permissions, ...profileFields } = req.validated!.body;
    const profile = await ManagerProfile.findById(req.params.id);
    if (!profile) throw ApiError.notFound("Manager not found");
    profile.set({ ...profileFields, updatedBy: a.userId });
    await profile.save();
    const userUpdate: any = {};
    if (profileFields.name) userUpdate.name = profileFields.name;
    if (permissions) userUpdate.permissions = permissions;
    if (Object.keys(userUpdate).length)
      await User.updateOne({ _id: profile.userId }, userUpdate);
    if (permissions)
      await audit(
        a,
        "user.permissions_changed",
        "User",
        profile.userId,
        { permissions },
        req,
      );
    await audit(
      a,
      "manager.updated",
      "ManagerProfile",
      profile._id,
      { fields: Object.keys(req.validated!.body) },
      req,
    );
    ok(res, (await withPermissions([profile]))[0], "Updated");
  }),
);

const setActive = (active: boolean) =>
  asyncHandler(async (req, res) => {
    const a = requireAuth(req);
    const profile = await ManagerProfile.findById(req.params.id);
    if (!profile) throw ApiError.notFound("Manager not found");
    profile.set({
      isActive: active,
      archivedAt: active ? null : new Date(),
      updatedBy: a.userId,
    });
    await profile.save();
    await setUsersActive({ _id: profile.userId }, active);
    await audit(
      a,
      active ? "user.activated" : "user.deactivated",
      "User",
      profile.userId,
      { role: "manager" },
      req,
    );
    ok(res, (await withPermissions([profile]))[0]);
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
    const a = requireAuth(req);
    const profile = await ManagerProfile.findById(req.params.id);
    if (!profile) throw ApiError.notFound("Manager not found");
    await User.updateOne(
      { _id: profile.userId },
      {
        passwordHash: await hashPassword(req.validated!.body.newPassword),
        mustChangePassword: true,
      },
    );
    await revokeAllSessions(profile.userId);
    await audit(a, "user.password_reset", "User", profile.userId, {}, req);
    ok(res, null, "Password reset");
  }),
);

export default router;
export { publicUser };
