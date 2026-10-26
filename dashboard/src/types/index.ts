export type Role = "admin" | "manager" | "client" | "printer";
export type Lang = "en" | "ar";

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

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  clientId: string | null;
  printerId: string | null;
  permissions: Permission[];
  mustChangePassword: boolean;
  language: Lang;
  lastLoginAt?: string;
}

export interface Meta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  unread?: number;
}
export interface Paged<T> {
  items: T[];
  meta: Meta;
}

export type Doc = {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: any;
};

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

export const BASE_COLORS = ["C", "M", "Y", "K", "W"] as const;
export type BaseColor = (typeof BASE_COLORS)[number];
export const MATERIALS = ["transparent", "white", "metalize"] as const;
export const PLATE_STATUSES = [
  "file_received",
  "technical_verification",
  "client_validation",
  "supplier_order",
  "engraving",
  "quality_control",
  "shipment",
  "delivered",
  "rejected",
  "cancelled",
] as const;

export interface Order extends Doc {
  jobCode: string;
  jobName: string;
  status: OrderStatus;
  priority: string;
  client?: { id: string; legalName: string; code: string } | null;
  machine?: { id: string; name: string; code: string } | null;
  assignedPrinter?: { id: string; name: string; code: string } | null;
  assignedManager?: { id: string; name: string } | null;
  clientId?: string;
  machineId?: string;
  assignedPrinterId?: string | null;
  customerNotes?: string;
  internalNotes?: string;
  printerNotes?: string;
  requestedDeliveryDate?: string;
  technicalSpecifications?: any;
  designLinks?: { url: string; label?: string; host?: string }[];
  fileAssetIds?: string[];
  lineItems?: any[];
  statusHistory?: any[];
  activityHistory?: any[];
  issues?: any[];
  approval?: { status: string; comment?: string };
  allowedTransitions: OrderStatus[];
  permissions: {
    canEdit: boolean;
    canAssign: boolean;
    canReorder: boolean;
    canReportIssue: boolean;
  };
  grandTotalMinor?: number;
  subtotalMinor?: number;
  discountTotalMinor?: number;
  taxTotalMinor?: number;
  estimatedCostMinor?: number;
  actualCostMinor?: number;
  margins?: {
    estimated: { marginMinor: number; marginPercent: number };
    actual: { marginMinor: number; marginPercent: number } | null;
  };
  reorderOfId?: string;
}

export interface FileAsset extends Doc {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  versionGroupId: string;
  category: string;
  accessClass: "shared" | "internal";
  uploadState: string;
}

export interface PublicSettings {
  jobNameRejectArabic: boolean;
  colorCountIncludesPantone: boolean;
  defaultCurrency: string;
  maxUploadSizeMb: number;
  maxSingleUploadSizeMb: number;
  storageConfigured: boolean;
  permissions: Permission[];
  orderStatuses: OrderStatus[];
  orderTransitions: Record<string, string[]>;
  plateStatuses: string[];
  plateTransitions: Record<string, string[]>;
  alertScanIntervalMinutes: number;
}
