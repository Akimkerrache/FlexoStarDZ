import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/http.js";
import { RefreshToken, User } from "../users/user.model.js";
import { audit } from "../audit-logs/audit.service.js";

export const hashPassword = (pw: string) => bcrypt.hash(pw, env.BCRYPT_ROUNDS);
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 4);

const ttlMs = (s: string) => {
  const m = /^(\d+)([smhd])$/.exec(s);
  if (!m) throw new Error(`Invalid duration: ${s}`);
  return (
    Number(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2] as "s"]!
  );
};

export function signAccess(user: { _id: unknown; tokenVersion: number }) {
  return jwt.sign({ tv: user.tokenVersion }, env.JWT_ACCESS_SECRET, {
    subject: String(user._id),
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as any,
    algorithm: "HS256",
  });
}

async function issueRefresh(userId: unknown, family: string) {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs(env.JWT_REFRESH_EXPIRES_IN));
  await RefreshToken.create({ userId, jti, family, expiresAt });
  const token = jwt.sign({ fam: family }, env.JWT_REFRESH_SECRET, {
    subject: String(userId),
    jwtid: jti,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as any,
    algorithm: "HS256",
  });
  return { token, expiresAt };
}

export async function login(email: string, password: string, ip?: string) {
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+passwordHash",
  );
  const valid = await bcrypt.compare(
    password,
    user?.passwordHash ?? DUMMY_HASH,
  );
  if (!user || !valid || !user.isActive) {
    await audit(undefined, "auth.login_failed", "User", user?._id, {
      email,
      reason: user && !user.isActive ? "inactive" : "invalid",
    });
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  user.lastLoginAt = new Date();
  await user.save();
  const refresh = await issueRefresh(user._id, crypto.randomUUID());
  await audit(
    { userId: String(user._id), role: user.role },
    "auth.login",
    "User",
    user._id,
    { ip },
  );
  return { user, accessToken: signAccess(user), refresh };
}

export async function rotateRefresh(token: string | undefined) {
  if (!token) throw new ApiError(401, "REFRESH_INVALID", "Session expired");
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;
  } catch {
    throw new ApiError(401, "REFRESH_INVALID", "Session expired");
  }
  const stored = await RefreshToken.findOne({ jti: payload.jti });
  if (!stored) throw new ApiError(401, "REFRESH_INVALID", "Session expired");
  if (stored.revokedAt) {
    // A rotated token was replayed: treat as theft and kill the whole family.
    await RefreshToken.updateMany(
      { family: stored.family, revokedAt: null },
      { revokedAt: new Date() },
    );
    await audit(
      { userId: String(stored.userId) },
      "auth.refresh_reuse_detected",
      "User",
      stored.userId,
    );
    throw new ApiError(401, "REFRESH_INVALID", "Session expired");
  }
  const user = await User.findById(stored.userId);
  if (!user || !user.isActive)
    throw new ApiError(401, "REFRESH_INVALID", "Session expired");
  const next = await issueRefresh(user._id, stored.family);
  stored.revokedAt = new Date();
  stored.replacedBy = jwt.decode(next.token, { json: true })!.jti;
  await stored.save();
  return { user, accessToken: signAccess(user), refresh: next };
}

export async function logout(token: string | undefined) {
  if (!token) return;
  const payload = jwt.decode(token, { json: true });
  if (!payload?.jti) return;
  const stored = await RefreshToken.findOne({ jti: payload.jti });
  if (stored) {
    await RefreshToken.updateMany(
      { family: stored.family, revokedAt: null },
      { revokedAt: new Date() },
    );
    await audit(
      { userId: String(stored.userId) },
      "auth.logout",
      "User",
      stored.userId,
    );
  }
}

/** Invalidates every access and refresh token of a user (deactivation, password reset). */
export async function revokeAllSessions(userId: unknown) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { revokedAt: new Date() },
  );
}
