import { download, http, request } from "./http";
import type {
  Doc,
  FileAsset,
  Order,
  Paged,
  PublicSettings,
  User,
} from "@/types";

type Q = Record<string, string | number | boolean | undefined | null>;

/** Generic REST resource client used by CRUD pages. */
export const resource = (path: string) => ({
  list: (q?: Q) => http.list<Doc>(path, q),
  get: (id: string) => http.get<Doc>(`${path}/${id}`),
  create: (body: unknown) => http.post<Doc>(path, body),
  update: (id: string, body: unknown) => http.patch<Doc>(`${path}/${id}`, body),
  archive: (id: string) => http.post<Doc>(`${path}/${id}/archive`),
  restore: (id: string) => http.post<Doc>(`${path}/${id}/restore`),
});

export const auth = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
      skipAuthRetry: true,
    }).then((r) => r.data),
  logout: () =>
    request("/auth/logout", {
      method: "POST",
      body: {},
      headers: { "X-Requested-With": "XMLHttpRequest" },
      skipAuthRetry: true,
    }),
  me: () => http.get<User>("/auth/me"),
  updateMe: (body: { name?: string; language?: string }) =>
    http.patch<User>("/auth/me", body),
  changePassword: (currentPassword: string, newPassword: string) =>
    http.post("/auth/change-password", { currentPassword, newPassword }),
};

export const settings = { get: () => http.get<PublicSettings>("/settings") };

export const orders = {
  list: (q?: Q) => http.list<Order>("/orders", q),
  get: (id: string) => http.get<Order>(`/orders/${id}`),
  create: (body: unknown, key: string) =>
    request<Order>("/orders", {
      method: "POST",
      body,
      headers: { "Idempotency-Key": key },
    }).then((r) => r.data),
  update: (id: string, body: unknown) =>
    http.patch<Order>(`/orders/${id}`, body),
  status: (id: string, status: string, note?: string) =>
    http.post<Order>(`/orders/${id}/status`, {
      status,
      note: note || undefined,
    }),
  assign: (
    id: string,
    body: { printerId?: string | null; managerId?: string | null },
  ) => http.post<Order>(`/orders/${id}/assign`, body),
  reorder: (id: string, key: string) =>
    request<Order>(`/orders/${id}/reorder`, {
      method: "POST",
      body: {},
      headers: { "Idempotency-Key": key },
    }).then((r) => r.data),
  files: (id: string) => http.get<FileAsset[]>(`/orders/${id}/files`),
  reportIssue: (id: string, kind: string, description: string) =>
    http.post<Order>(`/orders/${id}/issues`, { kind, description }),
  resolveIssue: (id: string, issueId: string) =>
    http.post<Order>(`/orders/${id}/issues/${issueId}/resolve`),
};

export const files = {
  list: (q?: Q) => http.list<FileAsset>("/files", q),
  versions: (id: string) => http.get<FileAsset[]>(`/files/${id}/versions`),
  downloadUrl: (id: string) =>
    http.get<{ url: string; fileName: string }>(`/files/${id}/download-url`),
  archive: (id: string) => http.post<FileAsset>(`/files/${id}/archive`),
  createSession: (body: unknown) =>
    http.post<{ file: FileAsset; upload: any }>("/files/uploads", body),
  partUrls: (id: string, partNumbers: number[]) =>
    http.post<{ parts: { partNumber: number; url: string }[] }>(
      `/files/${id}/parts`,
      { partNumbers },
    ),
  complete: (id: string, parts?: { partNumber: number; etag: string }[]) =>
    http.post<FileAsset>(`/files/${id}/complete`, { parts }),
  abort: (id: string) => http.post<FileAsset>(`/files/${id}/abort`),
};

export const reports = {
  dashboard: (q?: Q) => http.get<any>("/reports/dashboard", q),
  exportCsv: (resourceName: string, q?: Q) =>
    download(`/reports/export/${resourceName}`, q),
  pdf: (kind: "invoice" | "quotation" | "delivery" | "statement", id: string) =>
    download(`/reports/documents/${kind}/${id}`),
};

export const notifications = {
  list: (q?: Q) =>
    request<Doc[]>("/notifications", { query: q }).then(
      (r) => ({ items: r.data, meta: r.meta! }) as Paged<Doc>,
    ),
  read: (id: string) => http.post(`/notifications/${id}/read`),
  readAll: () => http.post("/notifications/read-all"),
  scan: () => http.post("/notifications/scan"),
};

export const res = {
  clients: resource("/clients"),
  printers: resource("/printers"),
  suppliers: resource("/suppliers"),
  categories: resource("/catalog/categories"),
  items: resource("/catalog/items"),
  machines: resource("/machines"),
  options: resource("/technical-options"),
  pantone: resource("/pantone"),
  expenses: resource("/expenses"),
};

export const managers = {
  list: (q?: Q) => http.list<Doc>("/managers", q),
  create: (b: unknown) => http.post<Doc>("/managers", b),
  update: (id: string, b: unknown) => http.patch<Doc>(`/managers/${id}`, b),
  activate: (id: string) => http.post<Doc>(`/managers/${id}/activate`),
  deactivate: (id: string) => http.post<Doc>(`/managers/${id}/deactivate`),
  resetPassword: (id: string, newPassword: string) =>
    http.post(`/managers/${id}/reset-password`, { newPassword }),
};

export const accounts = {
  create: (kind: "clients" | "printers", id: string, body: unknown) =>
    http.post<Doc>(`/${kind}/${id}/users`, body),
  list: (kind: "clients" | "printers", id: string) =>
    http.get<Doc[]>(`/${kind}/${id}/users`),
  activate: (id: string) => http.post<Doc>(`/users/${id}/activate`),
  deactivate: (id: string) => http.post<Doc>(`/users/${id}/deactivate`),
  resetPassword: (id: string, newPassword: string) =>
    http.post(`/users/${id}/reset-password`, { newPassword }),
};

export const quotations = {
  list: (q?: Q) => http.list<Doc>("/quotations", q),
  get: (id: string) => http.get<Doc>(`/quotations/${id}`),
  create: (b: unknown) => http.post<Doc>("/quotations", b),
  update: (id: string, b: unknown) => http.patch<Doc>(`/quotations/${id}`, b),
  status: (id: string, status: string, note?: string) =>
    http.post<Doc>(`/quotations/${id}/status`, { status, note }),
  convert: (id: string, b: unknown) =>
    http.post<{ orderId: string; jobCode: string }>(
      `/quotations/${id}/convert`,
      b,
    ),
};

export const plates = {
  list: (q?: Q) => http.list<Doc>("/plates", q),
  get: (id: string) => http.get<Doc>(`/plates/${id}`),
  create: (b: unknown) => http.post<Doc>("/plates", b),
  update: (id: string, b: unknown) => http.patch<Doc>(`/plates/${id}`, b),
  status: (id: string, status: string, note?: string) =>
    http.post<Doc>(`/plates/${id}/status`, { status, note }),
  note: (id: string, text: string, internal: boolean) =>
    http.post<Doc>(`/plates/${id}/notes`, { text, internal }),
  reuse: (id: string) => http.post<Doc>(`/plates/${id}/reuse`, {}),
  files: (id: string) => http.get<FileAsset[]>(`/plates/${id}/files`),
  calculate: (b: { widthMm: number; heightMm: number; clientId?: string }) =>
    http.post<{ surfaceCm2: number; price: any; pricingConfigured: boolean }>(
      "/plates/calculate",
      b,
    ),
  rules: () => http.get<Doc[]>("/plates/pricing-rules"),
  addRule: (b: unknown) => http.post<Doc>("/plates/pricing-rules", b),
};

export const production = {
  list: (q?: Q) => http.list<Doc>("/production", q),
  create: (b: unknown) => http.post<Doc>("/production", b),
  update: (id: string, b: unknown) => http.patch<Doc>(`/production/${id}`, b),
  status: (id: string, status: string, extra?: object) =>
    http.post<Doc>(`/production/${id}/status`, { status, ...extra }),
  issue: (id: string, text: string) =>
    http.post<Doc>(`/production/${id}/issues`, { text }),
  nonConformity: (id: string, b: unknown) =>
    http.post<Doc>(`/production/${id}/non-conformities`, b),
};

export const deliveries = {
  list: (q?: Q) => http.list<Doc>("/deliveries", q),
  get: (id: string) => http.get<Doc>(`/deliveries/${id}`),
  create: (b: unknown) => http.post<Doc>("/deliveries", b),
  update: (id: string, b: unknown) => http.patch<Doc>(`/deliveries/${id}`, b),
  status: (id: string, status: string, note?: string) =>
    http.post<Doc>(`/deliveries/${id}/status`, { status, note }),
  outstanding: (id: string) => http.get<any[]>(`/deliveries/${id}/outstanding`),
};

export const invoices = {
  list: (q?: Q) => http.list<Doc>("/invoices", q),
  get: (id: string) => http.get<Doc>(`/invoices/${id}`),
  create: (b: unknown) => http.post<Doc>("/invoices", b),
  update: (id: string, b: unknown) => http.patch<Doc>(`/invoices/${id}`, b),
  issue: (id: string) => http.post<Doc>(`/invoices/${id}/issue`),
  cancel: (id: string, reason: string) =>
    http.post<Doc>(`/invoices/${id}/cancel`, { reason }),
};

export const payments = {
  list: (q?: Q) => http.list<Doc>("/payments", q),
  create: (b: unknown, key: string) =>
    http.post<Doc>("/payments", b, { "Idempotency-Key": key }),
  void: (id: string, reason: string) =>
    http.post<Doc>(`/payments/${id}/void`, { reason }),
};

export const auditLogs = { list: (q?: Q) => http.list<Doc>("/audit-logs", q) };
export const dashboardSummary = (id: string) =>
  http.get<any>(`/clients/${id}/summary`);
