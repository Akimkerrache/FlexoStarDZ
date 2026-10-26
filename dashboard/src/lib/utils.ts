import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { BASE_COLORS, type BaseColor } from "@/types";

export const cn = (...i: ClassValue[]) => twMerge(clsx(i));

export const fromMinor = (m?: number | null) =>
  m == null ? "" : (m / 100).toFixed(2);
export const toMinor = (v: string | number) => Math.round(Number(v || 0) * 100);

export function money(minor?: number | null, currency = "DZD", locale = "en") {
  if (minor == null) return "—";
  return `${(minor / 100).toLocaleString(locale === "ar" ? "ar-DZ-u-nu-latn" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function fmtDate(d?: string | Date | null, withTime = false) {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const iso = date.toISOString();
  return withTime
    ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
    : iso.slice(0, 10);
}
export const toDateInput = (d?: string | null) =>
  d ? new Date(d).toISOString().slice(0, 10) : "";

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
}

/** The "All" control: selects all base colours, or clears them if all are already selected. */
export const toggleAllBaseColors = (cur: BaseColor[]): BaseColor[] =>
  cur.length === BASE_COLORS.length ? [] : [...BASE_COLORS];

export const ARABIC_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export const newKey = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const STATUS_TONE: Record<string, string> = {
  file_preparation: "bg-slate-100 text-slate-700",
  under_approval: "bg-amber-100 text-amber-800",
  rejected: "bg-red-100 text-red-700",
  approved: "bg-sky-100 text-sky-800",
  plate_processing: "bg-violet-100 text-violet-700",
  in_production: "bg-blue-100 text-blue-700",
  packed: "bg-indigo-100 text-indigo-700",
  in_transit: "bg-cyan-100 text-cyan-800",
  partially_delivered: "bg-lime-100 text-lime-800",
  delivered: "bg-emerald-100 text-emerald-700",
  invoiced: "bg-teal-100 text-teal-800",
  cancelled: "bg-zinc-200 text-zinc-600",
  // generic
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-sky-100 text-sky-800",
  accepted: "bg-emerald-100 text-emerald-700",
  expired: "bg-zinc-200 text-zinc-600",
  converted: "bg-teal-100 text-teal-800",
  issued: "bg-sky-100 text-sky-800",
  partially_paid: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-700",
  overdue: "bg-red-100 text-red-700",
  planned: "bg-slate-100 text-slate-700",
  awaiting_approval: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-700",
  blocked: "bg-red-100 text-red-700",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  recorded: "bg-emerald-100 text-emerald-700",
  voided: "bg-zinc-200 text-zinc-600",
  file_received: "bg-slate-100 text-slate-700",
  technical_verification: "bg-sky-100 text-sky-800",
  client_validation: "bg-amber-100 text-amber-800",
  supplier_order: "bg-violet-100 text-violet-700",
  engraving: "bg-blue-100 text-blue-700",
  quality_control: "bg-indigo-100 text-indigo-700",
  shipment: "bg-cyan-100 text-cyan-800",
};
