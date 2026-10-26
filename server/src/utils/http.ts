import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import type { AuthContext } from "../config/permissions.js";

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthContext;
    validated?: { body?: any; query?: any; params?: any };
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }
  static unauthorized(message = "Authentication required") {
    return new ApiError(401, "UNAUTHORIZED", message);
  }
  static forbidden(message = "You do not have access to this resource") {
    return new ApiError(403, "FORBIDDEN", message);
  }
  static notFound(message = "Resource not found") {
    return new ApiError(404, "NOT_FOUND", message);
  }
  static conflict(message: string, code = "CONFLICT") {
    return new ApiError(409, code, message);
  }
  static unprocessable(
    message: string,
    code = "UNPROCESSABLE",
    details?: unknown,
  ) {
    return new ApiError(422, code, message, details);
  }
}

export const asyncHandler =
  (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const ok = (
  res: Response,
  data: unknown,
  message = "OK",
  meta?: unknown,
  status = 200,
) =>
  res
    .status(status)
    .json({ success: true, data, message, ...(meta ? { meta } : {}) });

export const created = (res: Response, data: unknown, message = "Created") =>
  ok(res, data, message, undefined, 201);

export const validate =
  (parts: {
    body?: ZodTypeAny;
    query?: ZodTypeAny;
    params?: ZodTypeAny;
  }): RequestHandler =>
  (req, _res, next) => {
    const out: Request["validated"] = {};
    for (const key of ["params", "query", "body"] as const) {
      const s = parts[key];
      if (!s) continue;
      const r = s.safeParse(req[key]);
      if (!r.success) {
        return next(
          new ApiError(
            400,
            "VALIDATION_ERROR",
            "Validation failed",
            r.error.issues.map((i) => ({
              field: [key === "body" ? "" : key, ...i.path]
                .filter(Boolean)
                .join("."),
              message: i.message,
            })),
          ),
        );
      }
      out[key] = r.data;
    }
    req.validated = { ...req.validated, ...out };
    next();
  };

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
export const idParams = z.object({ id: objectId });

export const requireAuth = (req: Request): AuthContext => {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth;
};

/** Escapes user input for safe use inside a RegExp (prevents ReDoS / injection via search). */
export const escapeRegex = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
