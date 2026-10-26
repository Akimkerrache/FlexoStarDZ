import { z } from "zod";
import type { Types } from "mongoose";
import { ApiError } from "../../utils/http.js";
import { hashPassword, revokeAllSessions } from "../auth/auth.service.js";
import { User } from "./user.model.js";
import {
  PERMISSIONS,
  type Permission,
  type Role,
} from "../../config/permissions.js";

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128);
export const emailSchema = z.string().trim().toLowerCase().email().max(200);
export const permissionsSchema = z
  .array(z.enum(PERMISSIONS))
  .max(PERMISSIONS.length);

export const accountInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
});
export type AccountInput = z.infer<typeof accountInput>;

export async function createUser(
  input: AccountInput & {
    role: Role;
    clientId?: unknown;
    printerId?: unknown;
    managerProfileId?: unknown;
    permissions?: Permission[];
    createdBy?: string;
  },
) {
  if (await User.exists({ email: input.email }))
    throw ApiError.conflict(
      "A user with this email already exists",
      "EMAIL_TAKEN",
    );
  return User.create({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    clientId: input.clientId,
    printerId: input.printerId,
    managerProfileId: input.managerProfileId,
    permissions: input.role === "manager" ? (input.permissions ?? []) : [],
    createdBy: input.createdBy,
    mustChangePassword: true,
  });
}

export async function setUsersActive(
  filter: Record<string, unknown>,
  active: boolean,
) {
  const users = await User.find(filter).select("_id");
  await User.updateMany(filter, { isActive: active });
  if (!active) await Promise.all(users.map((u) => revokeAllSessions(u._id)));
}

export const publicUser = (u: any) => ({
  id: String(u._id ?? u.id),
  name: u.name,
  email: u.email,
  role: u.role,
  isActive: u.isActive,
  lastLoginAt: u.lastLoginAt,
  clientId: u.clientId ? String(u.clientId) : null,
  printerId: u.printerId ? String(u.printerId) : null,
  managerProfileId: u.managerProfileId ? String(u.managerProfileId) : null,
  permissions: u.permissions ?? [],
  mustChangePassword: !!u.mustChangePassword,
  language: u.language ?? "en",
  createdAt: u.createdAt,
});

export type ObjectIdLike = Types.ObjectId | string;
