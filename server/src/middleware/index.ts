import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { ZodError } from "zod";
import mongoose from "mongoose";
import { env, isProd } from "../config/env.js";
import { logger } from "../config/logger.js";
import { can, type Permission, type Role } from "../config/permissions.js";
import { ApiError } from "../utils/http.js";
import { User } from "../modules/users/user.model.js";

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw ApiError.unauthorized();
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, {
        algorithms: ["HS256"],
      }) as jwt.JwtPayload;
    } catch {
      throw new ApiError(
        401,
        "TOKEN_INVALID",
        "Invalid or expired access token",
      );
    }
    // Loaded on every request so deactivation and permission changes apply immediately.
    const user = await User.findById(payload.sub).lean<any>();
    if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
      throw new ApiError(
        401,
        "TOKEN_INVALID",
        "Invalid or expired access token",
      );
    }
    req.auth = {
      userId: String(user._id),
      name: user.name,
      role: user.role as Role,
      clientId: user.clientId ? String(user.clientId) : undefined,
      printerId: user.printerId ? String(user.printerId) : undefined,
      permissions: (user.permissions ?? []) as Permission[],
    };
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(ApiError.unauthorized());
    if (!roles.includes(req.auth.role)) return next(ApiError.forbidden());
    next();
  };

export const requirePermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(ApiError.unauthorized());
    if (!perms.some((p) => can(req.auth!, p)))
      return next(ApiError.forbidden());
    next();
  };

/** Cookie-authenticated endpoints must carry a custom header; browsers will not send it cross-site without CORS preflight. */
export function requireCsrfHeader(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (req.get("x-requested-with") !== "XMLHttpRequest")
    return next(ApiError.forbidden("Missing CSRF protection header"));
  next();
}

export function notFoundHandler(
  _req: Request,
  _res: Response,
  next: NextFunction,
) {
  next(ApiError.notFound("Route not found"));
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "Internal server error";
  let details: unknown;

  if (err instanceof ApiError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Validation failed";
    details = err.issues.map((i) => ({
      field: i.path.join("."),
      message: i.message,
    }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Validation failed";
    details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = "BAD_REQUEST";
    message = `Invalid value for ${err.path}`;
  } else if ((err as any)?.code === 11000) {
    status = 409;
    code = "DUPLICATE";
    message = `Duplicate value for ${Object.keys((err as any).keyPattern ?? {}).join(", ") || "unique field"}`;
  } else if ((err as any)?.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "Request body too large";
  } else if ((err as any)?.type === "entity.parse.failed") {
    status = 400;
    code = "BAD_REQUEST";
    message = "Malformed JSON body";
  }

  if (status >= 500) logger.error({ err, path: req.path }, "unhandled error");
  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      ...(!isProd && status >= 500 ? { stack: (err as Error)?.stack } : {}),
    },
  });
}
