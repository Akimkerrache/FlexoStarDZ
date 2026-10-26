import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Copy,
  Download,
  Pencil,
  Plus,
  UserCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DL,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
  errorText,
} from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import OrderForm from "@/features/OrderForm";
import { FileList } from "@/features/FileList";
import { Uploader } from "@/features/Uploader";
import {
  LineItemsEditor,
  linesFromDocs,
  linesToPayload,
  linesValid,
  type LineDraft,
} from "@/features/LineItems";
import { deliveries, managers, orders, reports, res } from "@/services/api";
import { fmtDate, money, newKey, fromMinor, toMinor } from "@/lib/utils";
import { isStaff, useAuth, useCan, useUi } from "@/stores";
import { ORDER_STATUSES, type FileAsset, type Order } from "@/types";

export function OrdersPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const user = useAuth((s) => s.user)!;
  const can = useCan();
  const toast = useUi((s) => s.toast);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const staff = isStaff(user);
  const cols: Column<Order>[] = [
    {
      key: "jobCode",
      header: t("f.jobCode"),
      sortKey: "jobCode",
      render: (o) => (
        <span className="ltr-text font-semibold text-teal-800">
          {o.jobCode}
        </span>
      ),
    },
    {
      key: "jobName",
      header: t("f.jobName"),
      sortKey: "jobName",
      render: (o) => <span className="font-medium">{o.jobName}</span>,
    },
    ...(user.role !== "client" && user.role !== "printer"
      ? [
          {
            key: "client",
            header: t("nav.clients"),
            render: (o: Order) => o.client?.legalName ?? "—",
          } as Column<Order>,
        ]
      : []),
    {
      key: "machine",
      header: t("orderForm.machine"),
      render: (o) => o.machine?.name ?? "—",
    },
    {
      key: "status",
      header: t("common.status"),
      sortKey: "status",
      render: (o) => <StatusBadge status={o.status} />,
    },
    {
      key: "priority",
      header: t("f.priority"),
      sortKey: "priority",
      render: (o) =>
        o.priority === "normal" ? (
          <span className="text-slate-400">{t("priority.normal")}</span>
        ) : (
          <Badge
            tone={
              o.priority === "urgent"
                ? "bg-red-100 text-red-700"
                : o.priority === "high"
                  ? "bg-amber-100 text-amber-800"
                  : undefined
            }
          >
            {t(`priority.${o.priority}`)}
          </Badge>
        ),
    },
    {
      key: "due",
      header: t("orderForm.requestedDelivery"),
      sortKey: "requestedDeliveryDate",
      render: (o) => fmtDate(o.requestedDeliveryDate),
    },
    {
      key: "created",
      header: t("f.created"),
      sortKey: "createdAt",
      render: (o) => fmtDate(o.createdAt),
    },
  ];
  return (
    <>
      <PageHeader
        title={t(user.role === "client" ? "nav.myOrders" : "nav.orders")}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                reports
                  .exportCsv("orders", { status: f.status })
                  .catch((e) => toast("error", errorText(e, t)))
              }
            >
              <Download className="size-4" /> {t("common.exportCsv")}
            </Button>
            {(user.role === "client" || can("orders.create")) && (
              <Button onClick={() => nav("/orders/new")}>
                <Plus className="size-4" /> {t("nav.newOrder")}
              </Button>
            )}
          </>
        }
      />
      <DataTable<Order>
        queryKey={["orders"]}
        fetcher={(q) => orders.list(q)}
        columns={cols}
        defaultSort="-createdAt"
        filters={f}
        onRowClick={(o) => nav(`/orders/${o.id}`)}
        empty={
          <EmptyState
            title={t("orders.empty")}
            action={
              user.role === "client" || can("orders.create") ? (
                <Button onClick={() => nav("/orders/new")}>
                  {t("nav.newOrder")}
                </Button>
              ) : undefined
            }
          />
        }
        toolbar={
          <>
            <Select
              aria-label={t("common.status")}
              className="w-auto"
              value={f.status ?? ""}
              onChange={(e) => set("status", e.target.value)}
            >
              <option value="">{t("common.allStatuses")}</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("f.priority")}
              className="w-auto"
              value={f.priority ?? ""}
              onChange={(e) => set("priority", e.target.value)}
            >
              <option value="">{t("f.priority")}</option>
              {["low", "normal", "high", "urgent"].map((s) => (
                <option key={s} value={s}>
                  {t(`priority.${s}`)}
                </option>
              ))}
            </Select>
            <Input
              aria-label={t("common.from")}
              type="date"
              className="w-auto"
              value={f.dateFrom ?? ""}
              onChange={(e) =>
                set(
                  "dateFrom",
                  e.target.value ? new Date(e.target.value).toISOString() : "",
                )
              }
            />
            <Input
              aria-label={t("common.to")}
              type="date"
              className="w-auto"
              value={f.dateTo?.slice(0, 10) ?? ""}
              onChange={(e) =>
                set(
                  "dateTo",
                  e.target.value
                    ? new Date(`${e.target.value}T23:59:59.999Z`).toISOString()
                    : "",
                )
              }
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={f.overdue === "true"}
                onChange={(e) => set("overdue", e.target.checked ? "true" : "")}
              />{" "}
              {t("orders.overdue")}
            </label>
            {staff && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={f.mine === "true"}
                  onChange={(e) => set("mine", e.target.checked ? "true" : "")}
                />{" "}
                {t("orders.mine")}
              </label>
            )}
          </>
        }
      />
    </>
  );
}

export function NewOrderPage() {
  return <OrderForm />;
}

export function EditOrderPage() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["orders", id],
    queryFn: () => orders.get(id!),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <OrderForm order={q.data!} />;
}

function AssignModal({
  order,
  onClose,
}: {
  order: Order;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const user = useAuth((s) => s.user)!;
  const [printerId, setPrinterId] = useState(order.assignedPrinterId ?? "");
  const [managerId, setManagerId] = useState(order.assignedManagerId ?? "");
  const printers = useQuery({
    queryKey: ["printers", "assign"],
    queryFn: () => res.printers.list({ limit: 100, isActive: "true" }),
  });
  const mgrs = useQuery({
    queryKey: ["managers", "assign"],
    queryFn: () => managers.list({ limit: 100, isActive: "true" }),
    enabled: user.role === "admin",
  });
  const m = useMutation({
    mutationFn: () =>
      orders.assign(order.id, {
        printerId: printerId || null,
        ...(user.role === "admin" ? { managerId: managerId || null } : {}),
      }),
    onSuccess: () => {
      toast("success", t("orders.assigned"));
      void qc.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("orders.assign")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("f.printerShop")}>
          <Select
            value={printerId}
            onChange={(e) => setPrinterId(e.target.value)}
          >
            <option value="">{t("orders.unassigned")}</option>
            {printers.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </Select>
        </Field>
        {user.role === "admin" && (
          <Field label={t("f.responsibleManager")}>
            <Select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
            >
              <option value="">{t("orders.unassigned")}</option>
              {mgrs.data?.items.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function Spec({ o }: { o: Order }) {
  const { t } = useTranslation();
  const s = o.technicalSpecifications ?? {};
  const yes = (b?: boolean) => (b ? t("common.yes") : t("common.no"));
  const d = s.dimensions ?? {};
  return (
    <div className="space-y-5">
      <DL
        items={[
          [
            t("orderForm.printDirection"),
            s.printDirection && t(`orderForm.dir.${s.printDirection}`),
          ],
          [
            t("orderForm.printOptions"),
            `${t("orderForm.linesGuides")}: ${yes(s.printOptions?.linesGuides)} · ${t("orderForm.logo")}: ${yes(s.printOptions?.logo)}`,
          ],
          [
            t("orderForm.printMaterial"),
            s.printMaterial && t(`material.${s.printMaterial}`),
          ],
          [
            t("orderForm.laminationMaterial"),
            s.laminationMaterial && t(`material.${s.laminationMaterial}`),
          ],
          [t("orderForm.baseColors"), s.colors?.base?.join(", ")],
          [
            t("orderForm.pantone"),
            s.colors?.pantone?.map((p: any) => p.code).join(", "),
          ],
          [
            t("orderForm.colorsCount"),
            s.colors &&
              `${s.colors.baseCount} + ${s.colors.pantoneCount} Pantone (${t("orderForm.total")}: ${s.colors.totalCount})`,
          ],
        ]}
      />
      <details className="rounded-md border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t("orderForm.sectionAdvanced")}
        </summary>
        <div className="mt-3">
          <DL
            items={[
              [
                t("orderForm.photocells"),
                `${t("orderForm.leftMark")}: ${s.photocells?.left?.mark ?? "—"} / ${s.photocells?.left?.path ?? "—"} · ${t("orderForm.rightMark")}: ${s.photocells?.right?.mark ?? "—"} / ${s.photocells?.right?.path ?? "—"}`,
              ],
              [
                t("orderForm.barcode"),
                s.barcode?.enabled
                  ? `${yes(true)} (${s.barcode.number ?? "—"})`
                  : yes(false),
              ],
              [t("orderForm.printMaterialSize"), d.printMaterialSizeMm],
              [t("orderForm.lineRepeat"), d.lineRepeat],
              [t("orderForm.cylinder"), d.cylinder],
              [t("orderForm.cylinderRepeat"), d.cylinderRepeat],
              [t("orderForm.lineWidth"), d.lineWidthMm],
              [t("orderForm.rowHeight"), d.rowHeightMm],
              [t("orderForm.printWidth"), d.printWidthMm],
              [t("orderForm.plateHeight"), d.plateHeightMm],
              [t("orderForm.totalCm"), d.totalCm],
              [t("orderForm.displacementType"), s.displacementType],
              [t("f.plateType"), s.plate?.type],
              [t("orderForm.plateThickness"), s.plate?.thicknessMm],
              [t("orderForm.machWidth"), s.machineSpecifications?.printWidthMm],
              [
                t("orderForm.machMaxColors"),
                s.machineSpecifications?.maxColors,
              ],
              [t("orderForm.distortion"), s.machineSpecifications?.distortion],
              [t("orderForm.lpi"), s.machineSpecifications?.lpi],
            ]}
          />
        </div>
      </details>
    </div>
  );
}

function Pricing({ o }: { o: Order }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const can = useCan();
  const user = useAuth((s) => s.user)!;
  const editable =
    o.permissions.canEdit &&
    (can("finance.manage") || can("quotations.manage"));
  const [lines, setLines] = useState<LineDraft[]>(linesFromDocs(o.lineItems));
  const [cost, setCost] = useState(fromMinor(o.estimatedCostMinor));
  const m = useMutation({
    mutationFn: () =>
      orders.update(o.id, {
        lineItems: linesToPayload(lines),
        ...(can("finance.manage") ? { estimatedCostMinor: toMinor(cost) } : {}),
      }),
    onSuccess: () => {
      toast("success", t("common.saved"));
      void qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const seesCost = o.estimatedCostMinor !== undefined;
  return (
    <div className="space-y-4">
      <LineItemsEditor lines={lines} onChange={setLines} disabled={!editable} />
      {o.grandTotalMinor !== undefined && (
        <p className="text-sm">
          {t("f.total")}: <strong>{money(o.grandTotalMinor)}</strong>
        </p>
      )}
      {seesCost && (
        <div className="grid gap-4 rounded-md bg-slate-50 p-3 sm:grid-cols-4">
          <Field label={t("f.estimatedCost")}>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={cost}
              disabled={!editable || !can("finance.manage")}
              onChange={(e) => setCost(e.target.value)}
            />
          </Field>
          <div>
            <p className="text-xs text-slate-500">{t("f.actualCost")}</p>
            <p className="mt-2 font-medium">{money(o.actualCostMinor)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{t("f.estimatedMargin")}</p>
            <p className="mt-2 font-medium">
              {money(o.margins?.estimated.marginMinor)} (
              {o.margins?.estimated.marginPercent}%)
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{t("f.actualMargin")}</p>
            <p className="mt-2 font-medium">
              {o.margins?.actual
                ? `${money(o.margins.actual.marginMinor)} (${o.margins.actual.marginPercent}%)`
                : t("f.notAvailable")}
            </p>
          </div>
        </div>
      )}
      {editable && (
        <div className="flex justify-end">
          <Button
            loading={m.isPending}
            disabled={!!lines.length && !linesValid(lines)}
            onClick={() => m.mutate()}
          >
            {t("common.save")}
          </Button>
        </div>
      )}
      {!editable && user.role !== "client" && (
        <p className="text-xs text-slate-500">{t("orders.pricingReadOnly")}</p>
      )}
    </div>
  );
}

function Issues({ o }: { o: Order }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("technical");
  const [text, setText] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["orders"] });
  const add = useMutation({
    mutationFn: () => orders.reportIssue(o.id, kind, text),
    onSuccess: () => {
      toast("success", t("orders.issueReported"));
      setOpen(false);
      setText("");
      void refresh();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => orders.resolveIssue(o.id, id),
    onSuccess: () => void refresh(),
    onError: (e) => toast("error", errorText(e, t)),
  });
  const canResolve = useCan()("orders.edit");
  return (
    <div className="space-y-3">
      {o.permissions.canReportIssue && (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <AlertTriangle className="size-4" /> {t("orders.reportIssue")}
        </Button>
      )}
      {!o.issues?.length ? (
        <EmptyState title={t("orders.noIssues")} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {o.issues.map((i: any) => (
            <li
              key={i.id}
              className="flex items-start justify-between gap-3 py-3 text-sm"
            >
              <div>
                <Badge
                  tone={
                    i.resolvedAt
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-800"
                  }
                >
                  {t(`issueKind.${i.kind}`)}
                </Badge>
                <p className="mt-1">{i.description}</p>
                <p className="text-xs text-slate-500">
                  {fmtDate(i.reportedAt, true)}
                </p>
              </div>
              {!i.resolvedAt && canResolve && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resolve.mutate(i.id)}
                >
                  {t("orders.resolve")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("orders.reportIssue")}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={add.isPending}
              disabled={text.trim().length < 3}
              onClick={() => add.mutate()}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("f.type")}>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {["technical", "delay", "non_conformity"].map((k) => (
                <option key={k} value={k}>
                  {t(`issueKind.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("f.description")}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function History({ o }: { o: Order }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-sm font-semibold">
          {t("orders.statusHistory")}
        </h3>
        <ol className="space-y-3 border-s-2 border-slate-200 ps-4">
          {o.statusHistory?.map((h: any, i: number) => (
            <li key={i} className="relative text-sm">
              <span className="absolute -start-[1.4rem] top-1.5 size-2.5 rounded-full bg-teal-600" />
              <p>
                {h.from ? (
                  <>
                    <StatusBadge status={h.from} /> →{" "}
                  </>
                ) : null}
                <StatusBadge status={h.to} />
              </p>
              <p className="text-xs text-slate-500">
                {fmtDate(h.at, true)} ·{" "}
                {t(`roles.${h.byRole}`, { defaultValue: h.byRole })}
              </p>
              {h.note && <p className="mt-0.5 text-slate-700">“{h.note}”</p>}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h3 className="mb-3 text-sm font-semibold">{t("orders.activity")}</h3>
        <ul className="space-y-2 text-sm">
          {[...(o.activityHistory ?? [])].reverse().map((a: any, i: number) => (
            <li key={i} className="rounded-md bg-slate-50 p-2">
              <span className="font-medium">
                {t(`activity.${String(a.action).replace('.', '_')}`, { defaultValue: a.action })}
              </span>{" "}
              <span className="text-xs text-slate-500">
                — {a.byName ?? "System"} · {fmtDate(a.at, true)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Related({ o }: { o: Order }) {
  const { t } = useTranslation();
  const can = useCan();
  const user = useAuth((s) => s.user)!;
  const show = user.role === "client" || can("deliveries.manage");
  const q = useQuery({
    queryKey: ["deliveries", "order", o.id],
    queryFn: () => deliveries.list({ orderId: o.id, limit: 50 }),
    enabled: show,
  });
  if (!show) return <EmptyState title={t("common.empty")} />;
  if (q.isLoading) return <Loading />;
  if (!q.data?.items.length)
    return <EmptyState title={t("orders.noDeliveries")} />;
  return (
    <ul className="divide-y divide-slate-100">
      {q.data.items.map((d) => (
        <li
          key={d.id}
          className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
        >
          <span className="ltr-text font-medium">{d.reference}</span>
          <StatusBadge status={d.status} />
          <span>{fmtDate(d.actualDate ?? d.plannedDate)}</span>
          <span className="text-slate-500">
            {d.lines
              ?.map((l: any) => `${l.description ?? ""} × ${l.quantity}`)
              .join(", ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OrderDetailsPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const user = useAuth((s) => s.user)!;
  const [tab, setTab] = useState("overview");
  const [transition, setTransition] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [assign, setAssign] = useState(false);
  const [newVersionOf, setNewVersionOf] = useState<FileAsset | null>(null);
  const [printerNotes, setPrinterNotes] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["orders", id],
    queryFn: () => orders.get(id!),
  });
  const filesQ = useQuery({
    queryKey: ["order-files", id],
    queryFn: () => orders.files(id!),
    enabled: !!q.data,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["order-files"] });
  };

  const status = useMutation({
    mutationFn: ({ to, n }: { to: string; n: string }) =>
      orders.status(id!, to, n),
    onSuccess: () => {
      toast("success", t("orders.statusUpdated"));
      setTransition(null);
      setNote("");
      refresh();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const reorder = useMutation({
    mutationFn: () => orders.reorder(id!, newKey()),
    onSuccess: (r) => {
      toast("success", t("orderForm.reordered"));
      nav(`/orders/${r.id}`);
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const saveNotes = useMutation({
    mutationFn: () => orders.update(id!, { printerNotes }),
    onSuccess: () => {
      toast("success", t("common.saved"));
      setPrinterNotes(null);
      refresh();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });

  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data!;
  const needsNote = transition
    ? transition === "rejected" ||
      (o.status === "under_approval" && transition === "file_preparation")
    : false;

  const tabs = [
    { id: "overview", label: t("orders.tabOverview") },
    { id: "files", label: t("nav.files") },
    { id: "history", label: t("orders.tabHistory") },
    ...(o.grandTotalMinor !== undefined || o.lineItems?.length
      ? [{ id: "pricing", label: t("orders.tabPricing") }]
      : []),
    ...(o.issues || o.permissions.canReportIssue
      ? [
          {
            id: "issues",
            label: `${t("orders.tabIssues")}${o.issues?.filter((i: any) => !i.resolvedAt).length ? ` (${o.issues.filter((i: any) => !i.resolvedAt).length})` : ""}`,
          },
        ]
      : []),
    { id: "related", label: t("nav.deliveries") },
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="ltr-text">{o.jobCode}</span>{" "}
            <StatusBadge status={o.status} />
          </span>
        }
        subtitle={
          <>
            {o.jobName}
            {o.client && <> · {o.client.legalName}</>}
            {o.reorderOfId && (
              <>
                {" "}
                ·{" "}
                <Link
                  className="text-teal-700 hover:underline"
                  to={`/orders/${o.reorderOfId}`}
                >
                  {t("orders.reorderOf")}
                </Link>
              </>
            )}
          </>
        }
        actions={
          <>
            {o.allowedTransitions.map((s) => (
              <Button
                key={s}
                variant={
                  s === "rejected" || s === "cancelled" ? "danger" : "primary"
                }
                size="sm"
                onClick={() => {
                  setTransition(s);
                  setNote("");
                }}
              >
                {t(`orders.action.${s}`, { defaultValue: t(`status.${s}`) })}
              </Button>
            ))}
            {o.permissions.canAssign && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAssign(true)}
              >
                <UserCheck className="size-4" /> {t("orders.assign")}
              </Button>
            )}
            {o.permissions.canEdit && user.role !== "printer" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => nav(`/orders/${o.id}/edit`)}
              >
                <Pencil className="size-4" /> {t("common.edit")}
              </Button>
            )}
            {o.permissions.canReorder && (
              <Button
                size="sm"
                variant="outline"
                loading={reorder.isPending}
                onClick={() => reorder.mutate()}
              >
                <Copy className="size-4" /> {t("orderForm.reorder")}
              </Button>
            )}
          </>
        }
      />
      {o.approval?.status === "rejected" && o.approval.comment && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800"
        >
          <strong>{t("orders.rejectedReason")}:</strong> {o.approval.comment}
        </p>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title={t("orders.technical")} />
            <div className="p-4">
              <Spec o={o} />
            </div>
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title={t("orders.details")} />
              <div className="p-4">
                <DL
                  items={[
                    [t("orderForm.machine"), o.machine?.name],
                    [t("f.priority"), t(`priority.${o.priority}`)],
                    [
                      t("orderForm.requestedDelivery"),
                      fmtDate(o.requestedDeliveryDate),
                    ],
                    ...(o.assignedPrinter
                      ? [
                          [t("f.printerShop"), o.assignedPrinter.name] as [
                            string,
                            string,
                          ],
                        ]
                      : []),
                    ...(o.assignedManager
                      ? [
                          [
                            t("f.responsibleManager"),
                            o.assignedManager.name,
                          ] as [string, string],
                        ]
                      : []),
                    [t("f.created"), fmtDate(o.createdAt, true)],
                  ]}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title={t("orders.notes")} />
              <div className="space-y-3 p-4 text-sm">
                <div>
                  <p className="text-xs font-medium uppercase text-slate-500">
                    {t("orderForm.customerNotes")}
                  </p>
                  <p className="whitespace-pre-wrap">
                    {o.customerNotes || "—"}
                  </p>
                </div>
                {o.internalNotes !== undefined && (
                  <div>
                    <p className="text-xs font-medium uppercase text-amber-700">
                      {t("f.internalNotes")}
                    </p>
                    <p className="whitespace-pre-wrap">
                      {o.internalNotes || "—"}
                    </p>
                  </div>
                )}
                {o.printerNotes !== undefined && (
                  <div>
                    <p className="text-xs font-medium uppercase text-slate-500">
                      {t("f.printerNotes")}
                    </p>
                    {user.role === "printer" && o.permissions.canEdit ? (
                      <div className="space-y-2">
                        <Textarea
                          value={printerNotes ?? o.printerNotes ?? ""}
                          onChange={(e) => setPrinterNotes(e.target.value)}
                        />
                        {printerNotes !== null && (
                          <Button
                            size="sm"
                            loading={saveNotes.isPending}
                            onClick={() => saveNotes.mutate()}
                          >
                            {t("common.save")}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">
                        {o.printerNotes || "—"}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
      {tab === "files" && (
        <Card>
          <CardHeader title={t("nav.files")} />
          <div className="space-y-4 p-4">
            {user.role !== "printer" &&
              (o.permissions.canEdit || user.role === "client") && (
                <div className="rounded-md bg-slate-50 p-3">
                  {newVersionOf && (
                    <p className="mb-2 text-sm">
                      {t("files.uploadingVersionOf", {
                        name: newVersionOf.originalName,
                      })}{" "}
                      <button
                        className="text-teal-700 underline"
                        onClick={() => setNewVersionOf(null)}
                      >
                        {t("common.cancel")}
                      </button>
                    </p>
                  )}
                  <Uploader
                    target={{
                      orderId: o.id,
                      clientId: o.clientId,
                      previousVersionId: newVersionOf?.id,
                      category: "design",
                    }}
                    onUploaded={() => {
                      setNewVersionOf(null);
                      refresh();
                    }}
                    multiple={!newVersionOf}
                    label={newVersionOf ? t("files.newVersion") : undefined}
                  />
                </div>
              )}
            {filesQ.isLoading ? (
              <Loading />
            ) : (
              <FileList
                files={filesQ.data ?? []}
                links={o.designLinks}
                onNewVersion={
                  user.role !== "printer" &&
                  (o.permissions.canEdit || user.role === "client")
                    ? setNewVersionOf
                    : undefined
                }
                onChanged={refresh}
              />
            )}
          </div>
        </Card>
      )}
      {tab === "history" && (
        <Card>
          <div className="p-4">
            <History o={o} />
          </div>
        </Card>
      )}
      {tab === "pricing" && (
        <Card>
          <div className="p-4">
            <Pricing o={o} />
          </div>
        </Card>
      )}
      {tab === "issues" && (
        <Card>
          <div className="p-4">
            <Issues o={o} />
          </div>
        </Card>
      )}
      {tab === "related" && (
        <Card>
          <div className="p-4">
            <Related o={o} />
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!transition}
        title={
          transition
            ? t(`orders.action.${transition}`, {
                defaultValue: t(`status.${transition}`),
              })
            : ""
        }
        danger={transition === "rejected" || transition === "cancelled"}
        loading={status.isPending}
        confirmDisabled={needsNote && !note.trim()}
        onClose={() => setTransition(null)}
        onConfirm={() => status.mutate({ to: transition!, n: note })}
      >
        <Field label={needsNote ? `${t("orders.note")} *` : t("orders.note")}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {needsNote && !note.trim() && (
          <p className="mt-1 text-xs text-amber-700">
            {t("orders.noteRequired")}
          </p>
        )}
      </ConfirmDialog>
      {assign && <AssignModal order={o} onClose={() => setAssign(false)} />}
    </>
  );
}
