export const ROLES = ["admin", "manager", "client", "printer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "clients.view",
  "clients.manage",
  "printers.view",
  "suppliers.view",
  "suppliers.manage",
  "catalog.manage",
  "machines.manage",
  "orders.view",
  "orders.create",
  "orders.edit",
  "orders.assign",
  "orders.status",
  "orders.approve",
  "quotations.manage",
  "plates.manage",
  "production.manage",
  "deliveries.manage",
  "finance.view",
  "finance.manage",
  "reports.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Safe server-side defaults for a new manager; Admin grants anything more explicitly. */
export const DEFAULT_MANAGER_PERMISSIONS: Permission[] = [
  "orders.view",
  "orders.create",
  "clients.view",
  "printers.view",
];

export interface AuthContext {
  userId: string;
  name: string;
  role: Role;
  clientId?: string;
  printerId?: string;
  permissions: Permission[];
}

export function can(auth: AuthContext, permission: Permission): boolean {
  if (auth.role === "admin") return true;
  if (auth.role !== "manager") return false;
  return auth.permissions.includes(permission);
}

export const isStaff = (auth: AuthContext) =>
  auth.role === "admin" || auth.role === "manager";
