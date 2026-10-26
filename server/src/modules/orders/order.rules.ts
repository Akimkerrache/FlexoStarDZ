import { can, type AuthContext, type Role } from "../../config/permissions.js";

export const ORDER_STATUSES = [
  "file_preparation",
  "under_approval",
  "rejected",
  "approved",
  "plate_processing",
  "in_production",
  "packed",
  "in_transit",
  "partially_delivered",
  "delivered",
  "invoiced",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FINAL_STATUSES: OrderStatus[] = [
  "delivered",
  "invoiced",
  "cancelled",
];
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const PRINT_DIRECTIONS = ["surface", "reverse"] as const;
export const MATERIALS = ["transparent", "white", "metalize"] as const;
export const BASE_COLORS = ["C", "M", "Y", "K", "W"] as const;
export type BaseColor = (typeof BASE_COLORS)[number];

type Gate = (a: AuthContext) => boolean;
const admin: Gate = (a) => a.role === "admin";
const staff =
  (perm: Parameters<typeof can>[1]): Gate =>
  (a) =>
    can(a, perm);
const client: Gate = (a) => a.role === "client";
const printer: Gate = (a) => a.role === "printer";
const any =
  (...g: Gate[]): Gate =>
  (a) =>
    g.some((x) => x(a));

const operate = any(staff("orders.status"), printer);

interface Edge {
  to: OrderStatus;
  allow: Gate;
  /** Reason/comment is mandatory (e.g. rejection). */
  noteRequired?: boolean;
  /** Can also be performed automatically by the system (deliveries, invoicing). */
  system?: boolean;
}

/** Order state machine. Reconciled with the Flexostar spec; see docs/open-business-decisions.md #1. */
export const TRANSITIONS: Record<OrderStatus, Edge[]> = {
  file_preparation: [
    { to: "under_approval", allow: any(client, staff("orders.status")) },
    { to: "cancelled", allow: any(client, staff("orders.status")) },
  ],
  under_approval: [
    { to: "approved", allow: staff("orders.approve") },
    { to: "rejected", allow: staff("orders.approve"), noteRequired: true },
    {
      to: "file_preparation",
      allow: staff("orders.status"),
      noteRequired: true,
    },
    { to: "cancelled", allow: staff("orders.status") },
  ],
  rejected: [
    { to: "file_preparation", allow: any(client, staff("orders.status")) },
    { to: "cancelled", allow: any(client, staff("orders.status")) },
  ],
  approved: [
    { to: "plate_processing", allow: operate },
    { to: "in_production", allow: operate },
    { to: "cancelled", allow: staff("orders.status") },
  ],
  plate_processing: [
    { to: "in_production", allow: operate },
    { to: "cancelled", allow: staff("orders.status") },
  ],
  in_production: [
    { to: "packed", allow: operate },
    { to: "partially_delivered", allow: admin, system: true },
    { to: "cancelled", allow: staff("orders.status") },
  ],
  packed: [
    { to: "in_transit", allow: operate },
    { to: "partially_delivered", allow: admin, system: true },
    {
      to: "delivered",
      allow: any(staff("deliveries.manage"), staff("orders.status")),
      system: true,
    },
  ],
  in_transit: [
    {
      to: "partially_delivered",
      allow: any(staff("deliveries.manage"), staff("orders.status")),
      system: true,
    },
    {
      to: "delivered",
      allow: any(staff("deliveries.manage"), staff("orders.status")),
      system: true,
    },
  ],
  partially_delivered: [
    { to: "in_transit", allow: operate },
    {
      to: "delivered",
      allow: any(staff("deliveries.manage"), staff("orders.status")),
      system: true,
    },
  ],
  delivered: [{ to: "invoiced", allow: staff("finance.manage"), system: true }],
  invoiced: [],
  cancelled: [],
};

export type TransitionCheck =
  | { ok: true; edge: Edge }
  | {
      ok: false;
      reason: "NOT_ALLOWED" | "FORBIDDEN" | "NOTE_REQUIRED";
      message: string;
    };

export function checkTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: AuthContext | "system",
  note?: string,
): TransitionCheck {
  const edge = TRANSITIONS[from]?.find((e) => e.to === to);
  if (!edge)
    return {
      ok: false,
      reason: "NOT_ALLOWED",
      message: `Transition ${from} -> ${to} is not allowed`,
    };
  if (actor === "system") {
    return edge.system
      ? { ok: true, edge }
      : {
          ok: false,
          reason: "NOT_ALLOWED",
          message: "Not an automatic transition",
        };
  }
  if (!edge.allow(actor))
    return {
      ok: false,
      reason: "FORBIDDEN",
      message: `Your role cannot move an order from ${from} to ${to}`,
    };
  if (edge.noteRequired && !note?.trim())
    return {
      ok: false,
      reason: "NOTE_REQUIRED",
      message: "A comment is required for this transition",
    };
  return { ok: true, edge };
}

export const allowedNextStatuses = (
  from: OrderStatus,
  actor: AuthContext,
): OrderStatus[] =>
  (TRANSITIONS[from] ?? []).filter((e) => e.allow(actor)).map((e) => e.to);

export const CLIENT_EDITABLE_STATUSES: OrderStatus[] = [
  "file_preparation",
  "rejected",
];

// ---- Colors -------------------------------------------------------------

/** The "All" control: selects every base colour, or clears them when all are already selected. */
export function toggleAllBaseColors(current: BaseColor[]): BaseColor[] {
  return current.length === BASE_COLORS.length ? [] : [...BASE_COLORS];
}

export function computeColorCounts(
  base: string[],
  pantone: string[],
  includePantoneInCount: boolean,
) {
  const baseCount = new Set(base).size;
  const pantoneCount = new Set(pantone).size;
  return {
    baseCount,
    pantoneCount,
    totalCount: baseCount + (includePantoneInCount ? pantoneCount : 0),
  };
}

// ---- Job name -----------------------------------------------------------

const ARABIC_SCRIPT =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
export const containsArabic = (s: string) => ARABIC_SCRIPT.test(s);

// ---- Visibility ---------------------------------------------------------

export const isAssignedTo = (
  a: AuthContext,
  order: { assignedPrinterId?: unknown },
) =>
  a.role === "printer" &&
  !!a.printerId &&
  String(order.assignedPrinterId ?? "") === a.printerId;

export const isOwnerClient = (a: AuthContext, order: { clientId?: unknown }) =>
  a.role === "client" &&
  !!a.clientId &&
  String(order.clientId ?? "") === a.clientId;

export type { Role };
