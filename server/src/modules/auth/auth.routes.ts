import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../../config/env.js";
import {
  asyncHandler,
  ok,
  validate,
  ApiError,
  requireAuth,
} from "../../utils/http.js";
import { authenticate, requireCsrfHeader } from "../../middleware/index.js";
import {
  login,
  logout,
  rotateRefresh,
  hashPassword,
  revokeAllSessions,
} from "./auth.service.js";
import {
  emailSchema,
  passwordSchema,
  publicUser,
} from "../users/account.service.js";
import { User } from "../users/user.model.js";
import { audit } from "../audit-logs/audit.service.js";

const router = Router();
const cookiePath = `${env.API_PREFIX}/auth`;

function setRefreshCookie(res: Response, token: string, expires: Date) {
  res.cookie(env.REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN || undefined,
    path: cookiePath,
    expires,
  });
}
const clearRefreshCookie = (res: Response) =>
  res.clearCookie(env.REFRESH_COOKIE_NAME, {
    path: cookiePath,
    domain: env.COOKIE_DOMAIN || undefined,
  });

const loginLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    `${req.ip}:${String(req.body?.email ?? "").toLowerCase()}`,
  validate: { keyGeneratorIpFallback: false },
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Too many attempts, try again later",
    },
  },
});

router.post(
  "/login",
  loginLimiter,
  validate({
    body: z.object({
      email: emailSchema,
      password: z.string().min(1).max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.validated!.body;
    const r = await login(email, password, req.ip);
    setRefreshCookie(res, r.refresh.token, r.refresh.expiresAt);
    ok(
      res,
      { accessToken: r.accessToken, user: publicUser(r.user) },
      "Logged in",
    );
  }),
);

router.post(
  "/refresh",
  requireCsrfHeader,
  asyncHandler(async (req, res) => {
    try {
      const r = await rotateRefresh(req.cookies?.[env.REFRESH_COOKIE_NAME]);
      setRefreshCookie(res, r.refresh.token, r.refresh.expiresAt);
      ok(
        res,
        { accessToken: r.accessToken, user: publicUser(r.user) },
        "Token refreshed",
      );
    } catch (e) {
      clearRefreshCookie(res);
      throw e;
    }
  }),
);

router.post(
  "/logout",
  requireCsrfHeader,
  asyncHandler(async (req, res) => {
    await logout(req.cookies?.[env.REFRESH_COOKIE_NAME]);
    clearRefreshCookie(res);
    ok(res, null, "Logged out");
  }),
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await User.findById(requireAuth(req).userId);
    ok(res, publicUser(user));
  }),
);

router.patch(
  "/me",
  authenticate,
  validate({
    body: z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        language: z.enum(["en", "ar"]).optional(),
      })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const user = await User.findByIdAndUpdate(
      requireAuth(req).userId,
      req.validated!.body,
      { new: true },
    );
    ok(res, publicUser(user), "Profile updated");
  }),
);

router.post(
  "/change-password",
  authenticate,
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.AUTH_RATE_LIMIT_MAX,
    keyGenerator: (r) => r.auth?.userId ?? "anon",
    validate: false,
  }),
  validate({
    body: z.object({
      currentPassword: z.string().min(1),
      newPassword: passwordSchema,
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { currentPassword, newPassword } = req.validated!.body;
    const user = await User.findById(auth.userId).select("+passwordHash");
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new ApiError(
        400,
        "INVALID_CURRENT_PASSWORD",
        "Current password is incorrect",
      );
    }
    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = false;
    await user.save();
    await revokeAllSessions(user._id);
    clearRefreshCookie(res);
    await audit(auth, "auth.password_changed", "User", user._id, {}, req);
    ok(res, null, "Password changed; please sign in again");
  }),
);

export default router;
