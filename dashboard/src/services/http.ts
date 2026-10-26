import type { Meta, Paged } from "@/types";

const BASE = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000/api/v1"
).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let onAuthLost: (() => void) | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const getAccessToken = () => accessToken;
export const setAuthLostHandler = (fn: () => void) => {
  onAuthLost = fn;
};

type Query = Record<string, string | number | boolean | undefined | null>;
interface Options {
  method?: string;
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
  skipAuthRetry?: boolean;
}

const qs = (q?: Query) => {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q))
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

let refreshing: Promise<boolean> | null = null;
export async function refreshSession(): Promise<{
  accessToken: string;
  user: any;
} | null> {
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (!res.ok) return null;
  const json = await res.json();
  accessToken = json.data.accessToken;
  return json.data;
}
const refreshOnce = () =>
  (refreshing ??= refreshSession()
    .then((r) => !!r)
    .finally(() => (refreshing = null)));

async function raw(path: string, o: Options): Promise<Response> {
  const headers: Record<string, string> = { ...o.headers };
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${BASE}${path}${qs(o.query)}`, {
    method: o.method ?? "GET",
    headers,
    credentials: "include",
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
  if (res.status === 401 && !o.skipAuthRetry && !path.startsWith("/auth/")) {
    if (await refreshOnce()) return raw(path, { ...o, skipAuthRetry: true });
    onAuthLost?.();
  }
  return res;
}

async function toError(res: Response): Promise<ApiError> {
  const j = await res.json().catch(() => null);
  return new ApiError(
    res.status,
    j?.error?.code ?? "ERROR",
    j?.error?.message ?? res.statusText,
    j?.error?.details,
  );
}

export async function request<T = any>(
  path: string,
  o: Options = {},
): Promise<{ data: T; meta?: Meta }> {
  const res = await raw(path, o);
  if (!res.ok) throw await toError(res);
  const j = await res.json();
  return { data: j.data as T, meta: j.meta };
}

/** Authenticated download of a binary response (CSV/PDF). */
export async function download(path: string, query?: Query) {
  const res = await raw(path, { query });
  if (!res.ok) throw await toError(res);
  const blob = await res.blob();
  const name =
    /filename="?([^";]+)"?/.exec(
      res.headers.get("content-disposition") ?? "",
    )?.[1] ?? "download";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const http = {
  get: <T>(path: string, query?: Query) =>
    request<T>(path, { query }).then((r) => r.data),
  list: <T>(path: string, query?: Query): Promise<Paged<T>> =>
    request<T[]>(path, { query }).then((r) => ({
      items: r.data,
      meta: r.meta!,
    })),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: "POST", body: body ?? {}, headers }).then(
      (r) => r.data,
    ),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body }).then((r) => r.data),
};
