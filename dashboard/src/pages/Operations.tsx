import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  ConfirmDialog,
  DL,
  EmptyState,
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
import { DataTable, useDebounced, type Column } from "@/components/DataTable";
import { FileList } from "@/features/FileList";
import { Uploader } from "@/features/Uploader";
import {
  deliveries,
  orders,
  plates,
  production,
  reports,
  res,
} from "@/services/api";
import { fmtDate, money, toDateInput, toMinor, fromMinor } from "@/lib/utils";
import { useAuth, useCan, useUi } from "@/stores";
import { PLATE_STATUSES, type Doc, type FileAsset } from "@/types";

const ltr = (v?: string | number) => (
  <span className="ltr-text">{v ?? "—"}</span>
);

// ---------------- Photopolymer plates ----------------
function PlateForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const can = useCan();
  const qc = useQueryClient();
  const clients = useQuery({
    queryKey: ["clients", "select"],
    queryFn: () => res.clients.list({ limit: 100, isActive: "true" }),
  });
  const suppliers = useQuery({
    queryKey: ["suppliers", "select"],
    queryFn: () => res.suppliers.list({ limit: 100, isActive: "true" }),
  });
  const [v, setV] = useState<Record<string, string>>({
    clientId: "",
    widthMm: "",
    heightMm: "",
    thicknessMm: "",
    plateType: "",
    colorsCount: "",
    printSpecs: "",
    supplierId: "",
    purchase: "",
    selling: "",
    plannedDate: "",
  });
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));
  const w = useDebounced(v.widthMm),
    h = useDebounced(v.heightMm),
    c = useDebounced(v.clientId);
  const calc = useQuery({
    queryKey: ["plate-calc", w, h, c],
    queryFn: () =>
      plates.calculate({
        widthMm: Number(w),
        heightMm: Number(h),
        clientId: c || undefined,
      }),
    enabled: Number(w) > 0 && Number(h) > 0,
    retry: false,
  });
  const m = useMutation({
    mutationFn: () =>
      plates.create({
        clientId: v.clientId,
        widthMm: Number(v.widthMm),
        heightMm: Number(v.heightMm),
        thicknessMm: v.thicknessMm ? Number(v.thicknessMm) : undefined,
        plateType: v.plateType || undefined,
        colorsCount: v.colorsCount ? Number(v.colorsCount) : undefined,
        printSpecs: v.printSpecs || undefined,
        supplierId: v.supplierId || undefined,
        ...(can("finance.manage")
          ? {
              purchasePriceMinor: v.purchase ? toMinor(v.purchase) : undefined,
              sellingPriceMinor: v.selling ? toMinor(v.selling) : undefined,
            }
          : {}),
        plannedDate: v.plannedDate
          ? new Date(v.plannedDate).toISOString()
          : undefined,
      }),
    onSuccess: () => {
      toast("success", t("common.saved"));
      void qc.invalidateQueries({ queryKey: ["plates"] });
      onClose();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const input = (
    k: string,
    label: string,
    type = "text",
    extra: object = {},
  ) => (
    <Field label={t(label)}>
      <Input
        type={type}
        value={v[k]}
        onChange={(e) => set(k, e.target.value)}
        {...extra}
      />
    </Field>
  );
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={t("plates.new")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={m.isPending}
            disabled={
              !v.clientId ||
              !(Number(v.widthMm) > 0) ||
              !(Number(v.heightMm) > 0)
            }
            onClick={() => m.mutate()}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("nav.clients")} required>
          <Select
            value={v.clientId}
            onChange={(e) => set("clientId", e.target.value)}
          >
            <option value="">{t("common.select")}</option>
            {clients.data?.items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.legalName}
              </option>
            ))}
          </Select>
        </Field>
        {input("widthMm", "plates.widthMm", "number", { min: 0, step: "any" })}
        {input("heightMm", "plates.heightMm", "number", {
          min: 0,
          step: "any",
        })}
        <div
          className="rounded-md bg-teal-50 p-3 text-sm sm:col-span-3"
          aria-live="polite"
        >
          <p>
            <strong>{t("plates.surface")}:</strong>{" "}
            {calc.data ? `${calc.data.surfaceCm2} cm²` : "—"}
          </p>
          {calc.data &&
            (calc.data.price ? (
              <p>
                <strong>{t("plates.calculatedPrice")}:</strong>{" "}
                {money(calc.data.price.totalMinor)}
                {calc.data.price.minimumApplied &&
                  ` (${t("plates.minimumApplied")})`}
              </p>
            ) : (
              <p className="text-amber-700">{t("plates.noPricingRule")}</p>
            ))}
        </div>
        {input("thicknessMm", "f.thicknessMm", "number", { step: "any" })}
        {input("plateType", "f.plateType")}
        {input("colorsCount", "plates.colorsCount", "number")}
        <Field label={t("plates.supplier")}>
          <Select
            value={v.supplierId}
            onChange={(e) => set("supplierId", e.target.value)}
          >
            <option value="">{t("common.select")}</option>
            {suppliers.data?.items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        {can("finance.manage") && (
          <>
            {input("purchase", "plates.purchasePrice", "number", {
              step: "0.01",
              min: 0,
            })}
            {input("selling", "plates.sellingPrice", "number", {
              step: "0.01",
              min: 0,
              placeholder: calc.data?.price
                ? fromMinor(calc.data.price.totalMinor)
                : "",
            })}
          </>
        )}
        {input("plannedDate", "plates.plannedDate", "date")}
        <Field label={t("plates.printSpecs")} className="sm:col-span-3">
          <Textarea
            value={v.printSpecs}
            onChange={(e) => set("printSpecs", e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

function PlateDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const can = useCan();
  const manage = can("plates.manage");
  const [tab, setTab] = useState("info");
  const [to, setTo] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [prev, setPrev] = useState<FileAsset | null>(null);
  const q = useQuery({
    queryKey: ["plates", id],
    queryFn: () => plates.get(id),
  });
  const fq = useQuery({
    queryKey: ["plate-files", id],
    queryFn: () => plates.files(id),
  });
  const refresh = () => {
    void q.refetch();
    void fq.refetch();
    void qc.invalidateQueries({ queryKey: ["plates"] });
  };
  const status = useMutation({
    mutationFn: () => plates.status(id, to!, note),
    onSuccess: () => {
      toast("success", t("common.saved"));
      setTo(null);
      setNote("");
      refresh();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const addNote = useMutation({
    mutationFn: () => plates.note(id, text, true),
    onSuccess: () => {
      setText("");
      refresh();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const reuse = useMutation({
    mutationFn: () => plates.reuse(id),
    onSuccess: () => {
      toast("success", t("plates.reused"));
      refresh();
      onClose();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const p = q.data;
  return (
    <Modal open onClose={onClose} wide title={p ? `${p.reference}` : "…"}>
      {!p ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} />
            {p.allowedTransitions?.map((s: string) => (
              <Button
                key={s}
                size="sm"
                variant={
                  s === "rejected" || s === "cancelled" ? "danger" : "outline"
                }
                onClick={() => setTo(s)}
              >
                {t(`status.${s}`)}
              </Button>
            ))}
            {manage && (
              <Button
                size="sm"
                variant="ghost"
                loading={reuse.isPending}
                onClick={() => reuse.mutate()}
              >
                {t("plates.reuse")}
              </Button>
            )}
          </div>
          <Tabs
            tabs={[
              { id: "info", label: t("orders.details") },
              { id: "files", label: t("nav.files") },
              { id: "history", label: t("orders.tabHistory") },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === "info" && (
            <DL
              items={[
                [t("plates.widthMm"), p.widthMm],
                [t("plates.heightMm"), p.heightMm],
                [t("plates.surface"), `${p.surfaceCm2} cm²`],
                [t("f.thicknessMm"), p.thicknessMm],
                [t("f.plateType"), p.plateType],
                [t("plates.colorsCount"), p.colorsCount],
                [
                  t("plates.sellingPrice"),
                  money(p.sellingPriceMinor, p.currency),
                ],
                ...(p.purchasePriceMinor !== undefined
                  ? [
                      [
                        t("plates.purchasePrice"),
                        money(p.purchasePriceMinor, p.currency),
                      ] as [string, string],
                    ]
                  : []),
                [t("plates.received"), fmtDate(p.receivedAt)],
                [t("plates.plannedDate"), fmtDate(p.plannedDate)],
                [t("plates.deliveredOn"), fmtDate(p.actualDate)],
                [t("plates.printSpecs"), p.printSpecs],
              ]}
            />
          )}
          {tab === "files" && (
            <div className="space-y-3">
              {manage && (
                <div className="rounded-md bg-slate-50 p-3">
                  {prev && (
                    <p className="mb-2 text-sm">
                      {t("files.uploadingVersionOf", {
                        name: prev.originalName,
                      })}
                    </p>
                  )}
                  <Uploader
                    target={{
                      plateId: id,
                      previousVersionId: prev?.id,
                      category: prev ? "plate_corrected" : "plate_original",
                    }}
                    onUploaded={() => {
                      setPrev(null);
                      refresh();
                    }}
                    multiple={false}
                  />
                </div>
              )}
              <FileList
                files={fq.data ?? []}
                onNewVersion={manage ? setPrev : undefined}
                onChanged={refresh}
              />
            </div>
          )}
          {tab === "history" && (
            <div className="space-y-4">
              <ol className="space-y-2 border-s-2 border-slate-200 ps-4 text-sm">
                {p.history.map((h: any, i: number) => (
                  <li key={i}>
                    {h.from && (
                      <>
                        <StatusBadge status={h.from} /> →{" "}
                      </>
                    )}
                    <StatusBadge status={h.to} />{" "}
                    <span className="text-xs text-slate-500">
                      {fmtDate(h.at, true)}
                    </span>
                    {h.note && <p>“{h.note}”</p>}
                  </li>
                ))}
              </ol>
              {p.operations?.map((o: any) => (
                <p key={o.id} className="rounded bg-slate-50 p-2 text-sm">
                  <span className="text-xs text-slate-500">
                    {o.byName} · {fmtDate(o.at, true)}
                  </span>
                  <br />
                  {o.text}
                </p>
              ))}
              {manage && (
                <div className="flex gap-2">
                  <Input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={t("plates.addNote")}
                  />
                  <Button
                    disabled={!text.trim()}
                    loading={addNote.isPending}
                    onClick={() => addNote.mutate()}
                  >
                    {t("common.add")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!to}
        title={to ? t(`status.${to}`) : ""}
        danger={to === "rejected" || to === "cancelled"}
        loading={status.isPending}
        onClose={() => setTo(null)}
        onConfirm={() => status.mutate()}
      >
        <Field label={t("orders.note")}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </Modal>
  );
}

function PricingRules({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const can = useCan();
  const q = useQuery({ queryKey: ["plate-rules"], queryFn: plates.rules });
  const [v, setV] = useState({
    pricePerCm2: "",
    minimum: "",
    discount: "",
    extra: "",
    note: "",
  });
  const m = useMutation({
    mutationFn: () =>
      plates.addRule({
        pricePerCm2Minor: v.pricePerCm2 ? toMinor(v.pricePerCm2) : undefined,
        minimumChargeMinor: v.minimum ? toMinor(v.minimum) : undefined,
        discountPercent: v.discount ? Number(v.discount) : undefined,
        extraFeesMinor: v.extra ? toMinor(v.extra) : undefined,
        note: v.note || undefined,
      }),
    onSuccess: () => {
      toast("success", t("common.saved"));
      void q.refetch();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  return (
    <Modal open onClose={onClose} wide title={t("plates.pricingRules")}>
      <p className="mb-3 text-sm text-slate-600">{t("plates.pricingHint")}</p>
      {can("finance.manage") && (
        <div className="mb-4 grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-5">
          <Field label={t("plates.pricePerCm2")}>
            <Input
              type="number"
              step="0.0001"
              min="0"
              value={v.pricePerCm2}
              onChange={(e) => setV({ ...v, pricePerCm2: e.target.value })}
            />
          </Field>
          <Field label={t("plates.minimumCharge")}>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={v.minimum}
              onChange={(e) => setV({ ...v, minimum: e.target.value })}
            />
          </Field>
          <Field label={t("f.discountPercent")}>
            <Input
              type="number"
              min="0"
              max="100"
              value={v.discount}
              onChange={(e) => setV({ ...v, discount: e.target.value })}
            />
          </Field>
          <Field label={t("plates.extraFees")}>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={v.extra}
              onChange={(e) => setV({ ...v, extra: e.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <Button loading={m.isPending} onClick={() => m.mutate()}>
              {t("plates.newVersion")}
            </Button>
          </div>
        </div>
      )}
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <EmptyState title={t("plates.noRules")} />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-xs text-slate-500">
              <th className="text-start">v</th>
              <th className="text-start">{t("plates.pricePerCm2")}</th>
              <th className="text-start">{t("plates.minimumCharge")}</th>
              <th className="text-start">{t("f.discountPercent")}</th>
              <th className="text-start">{t("plates.extraFees")}</th>
              <th className="text-start">{t("f.created")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data.map((r) => (
              <tr key={r.id} className="border-t">
                <td>{r.version}</td>
                <td>{r.pricePerCm2Minor ?? "—"}</td>
                <td>{money(r.minimumChargeMinor)}</td>
                <td>{r.discountPercent ?? "—"}</td>
                <td>{money(r.extraFeesMinor)}</td>
                <td>{fmtDate(r.createdAt)}</td>
                <td>
                  {r.isActive && (
                    <Badge tone="bg-emerald-100 text-emerald-700">
                      {t("common.active")}
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

export function PlatesPage() {
  const { t } = useTranslation();
  const can = useCan();
  const user = useAuth((s) => s.user)!;
  const [f, setF] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rules, setRules] = useState(false);
  const cols: Column<Doc>[] = [
    {
      key: "r",
      header: t("f.reference"),
      sortKey: "reference",
      render: (p) => (
        <span className="ltr-text font-semibold text-teal-800">
          {p.reference}
        </span>
      ),
    },
    ...(user.role !== "client"
      ? [
          {
            key: "c",
            header: t("nav.clients"),
            render: (p: Doc) => ltr(p.clientId),
          } as Column<Doc>,
        ]
      : []),
    {
      key: "d",
      header: t("plates.dimensions"),
      render: (p) => ltr(`${p.widthMm} × ${p.heightMm} mm`),
    },
    {
      key: "s",
      header: t("plates.surface"),
      sortKey: "surfaceCm2",
      render: (p) => `${p.surfaceCm2} cm²`,
    },
    {
      key: "st",
      header: t("common.status"),
      sortKey: "status",
      render: (p) => <StatusBadge status={p.status} />,
    },
    {
      key: "p",
      header: t("plates.sellingPrice"),
      render: (p) => money(p.sellingPriceMinor, p.currency),
    },
    {
      key: "rc",
      header: t("plates.received"),
      sortKey: "receivedAt",
      render: (p) => fmtDate(p.receivedAt),
    },
  ];
  return (
    <>
      <PageHeader
        title={t("nav.plates")}
        actions={
          can("plates.manage") && (
            <>
              {(can("finance.view") || can("finance.manage")) && (
                <Button variant="outline" onClick={() => setRules(true)}>
                  {t("plates.pricingRules")}
                </Button>
              )}
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" /> {t("common.add")}
              </Button>
            </>
          )
        }
      />
      <DataTable
        queryKey={["plates"]}
        fetcher={(q) => plates.list(q)}
        columns={cols}
        filters={f}
        onRowClick={(p) => setOpen(p.id)}
        defaultSort="-receivedAt"
        toolbar={
          <>
            <Select
              aria-label={t("common.status")}
              className="w-auto"
              value={f.status ?? ""}
              onChange={(e) => setF({ ...f, status: e.target.value })}
            >
              <option value="">{t("common.allStatuses")}</option>
              {PLATE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
            <Input
              aria-label={t("plates.widthMm")}
              placeholder={t("plates.widthMm")}
              type="number"
              className="w-28"
              value={f.widthMm ?? ""}
              onChange={(e) => setF({ ...f, widthMm: e.target.value })}
            />
            <Input
              aria-label={t("plates.heightMm")}
              placeholder={t("plates.heightMm")}
              type="number"
              className="w-28"
              value={f.heightMm ?? ""}
              onChange={(e) => setF({ ...f, heightMm: e.target.value })}
            />
          </>
        }
      />
      {open && <PlateDetails id={open} onClose={() => setOpen(null)} />}
      {creating && <PlateForm onClose={() => setCreating(false)} />}
      {rules && <PricingRules onClose={() => setRules(false)} />}
    </>
  );
}

// ---------------- Production / subcontracting ----------------
const OP_NEXT: Record<string, string[]> = {
  planned: ["awaiting_approval", "in_progress", "cancelled"],
  awaiting_approval: ["in_progress", "planned", "cancelled"],
  in_progress: ["blocked", "completed", "cancelled"],
  blocked: ["in_progress", "cancelled"],
};

function OperationForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const can = useCan();
  const qc = useQueryClient();
  const [v, setV] = useState<Record<string, string>>({
    orderId: "",
    executorType: "subcontractor",
    supplierId: "",
    printerId: "",
    operationType: "",
    agreed: "",
    plannedStart: "",
    plannedEnd: "",
    quantityOrdered: "",
  });
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));
  const ord = useQuery({
    queryKey: ["orders", "select"],
    queryFn: () => orders.list({ limit: 100 }),
  });
  const sup = useQuery({
    queryKey: ["suppliers", "select"],
    queryFn: () => res.suppliers.list({ limit: 100, isActive: "true" }),
  });
  const prt = useQuery({
    queryKey: ["printers", "select"],
    queryFn: () => res.printers.list({ limit: 100, isActive: "true" }),
  });
  const m = useMutation({
    mutationFn: () =>
      production.create({
        orderId: v.orderId,
        executorType: v.executorType,
        operationType: v.operationType,
        supplierId: v.supplierId || undefined,
        printerId: v.printerId || undefined,
        ...(can("finance.manage") && v.agreed
          ? { agreedCostMinor: toMinor(v.agreed) }
          : {}),
        plannedStart: v.plannedStart
          ? new Date(v.plannedStart).toISOString()
          : undefined,
        plannedEnd: v.plannedEnd
          ? new Date(v.plannedEnd).toISOString()
          : undefined,
        quantityOrdered: v.quantityOrdered
          ? Number(v.quantityOrdered)
          : undefined,
      }),
    onSuccess: () => {
      toast("success", t("common.saved"));
      void qc.invalidateQueries({ queryKey: ["production"] });
      onClose();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={t("production.new")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={m.isPending}
            disabled={!v.orderId || !v.operationType}
            onClick={() => m.mutate()}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("f.order")} required>
          <Select
            value={v.orderId}
            onChange={(e) => set("orderId", e.target.value)}
          >
            <option value="">{t("common.select")}</option>
            {ord.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.jobCode} — {o.jobName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("production.executor")}>
          <Select
            value={v.executorType}
            onChange={(e) => set("executorType", e.target.value)}
          >
            {["internal", "supplier", "subcontractor", "printer"].map((x) => (
              <option key={x} value={x}>
                {t(`production.executors.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        {["supplier", "subcontractor"].includes(v.executorType) && (
          <Field label={t("nav.suppliers")} required>
            <Select
              value={v.supplierId}
              onChange={(e) => set("supplierId", e.target.value)}
            >
              <option value="">{t("common.select")}</option>
              {sup.data?.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {v.executorType === "printer" && (
          <Field label={t("nav.printers")} required>
            <Select
              value={v.printerId}
              onChange={(e) => set("printerId", e.target.value)}
            >
              <option value="">{t("common.select")}</option>
              {prt.data?.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t("production.operationType")} required>
          <Input
            value={v.operationType}
            onChange={(e) => set("operationType", e.target.value)}
          />
        </Field>
        {can("finance.manage") && (
          <Field label={t("production.agreedCost")}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={v.agreed}
              onChange={(e) => set("agreed", e.target.value)}
            />
          </Field>
        )}
        <Field label={t("production.plannedStart")}>
          <Input
            type="date"
            value={v.plannedStart}
            onChange={(e) => set("plannedStart", e.target.value)}
          />
        </Field>
        <Field label={t("production.plannedEnd")}>
          <Input
            type="date"
            value={v.plannedEnd}
            onChange={(e) => set("plannedEnd", e.target.value)}
          />
        </Field>
        <Field label={t("production.qtyOrdered")}>
          <Input
            type="number"
            min="0"
            value={v.quantityOrdered}
            onChange={(e) => set("quantityOrdered", e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

function OperationDetails({ op, onClose }: { op: Doc; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const user = useAuth((s) => s.user)!;
  const [issue, setIssue] = useState("");
  const [nc, setNc] = useState({ type: "", description: "", rework: false });
  const [qty, setQty] = useState(String(op.quantityProduced ?? 0));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["production"] });
    onClose();
  };
  const fail = (e: unknown) => toast("error", errorText(e, t));
  const allowed = (OP_NEXT[op.status] ?? []).filter(
    (s) =>
      user.role !== "printer" ||
      ["in_progress", "blocked", "completed"].includes(s),
  );
  return (
    <Modal open onClose={onClose} wide title={op.reference}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={op.status} />
          {allowed.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === "cancelled" ? "danger" : "outline"}
              onClick={() =>
                production
                  .status(op.id, s, { quantityProduced: Number(qty) })
                  .then(refresh)
                  .catch(fail)
              }
            >
              {t(`status.${s}`)}
            </Button>
          ))}
        </div>
        <DL
          items={[
            [t("production.operationType"), op.operationType],
            [
              t("production.executor"),
              t(`production.executors.${op.executorType}`),
            ],
            [t("production.plannedEnd"), fmtDate(op.plannedEnd)],
            [t("production.qtyOrdered"), op.quantityOrdered],
            ...(op.agreedCostMinor !== undefined
              ? [
                  [t("production.agreedCost"), money(op.agreedCostMinor)] as [
                    string,
                    string,
                  ],
                  [t("production.actualCost"), money(op.actualCostMinor)] as [
                    string,
                    string,
                  ],
                ]
              : []),
          ]}
        />
        <Field label={t("production.qtyProduced")}>
          <Input
            type="number"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="max-w-40"
          />
        </Field>
        <section>
          <h3 className="mb-1 text-sm font-semibold">
            {t("orders.tabIssues")}
          </h3>
          <ul className="mb-2 space-y-1 text-sm">
            {op.issues?.map((i: any) => (
              <li key={i.id} className="rounded bg-slate-50 p-2">
                {i.text}{" "}
                <span className="text-xs text-slate-500">
                  — {i.byName} {fmtDate(i.at)}
                </span>
              </li>
            ))}
            {op.nonConformities?.map((n: any) => (
              <li key={n.id} className="rounded bg-amber-50 p-2">
                <Badge tone="bg-amber-100 text-amber-800">
                  {t("production.nonConformity")}
                </Badge>{" "}
                {n.type}: {n.description}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              value={issue}
              onChange={(e) => setIssue(e.target.value)}
              placeholder={t("production.reportIssue")}
            />
            <Button
              disabled={issue.trim().length < 3}
              onClick={() =>
                production.issue(op.id, issue).then(refresh).catch(fail)
              }
            >
              {t("common.add")}
            </Button>
          </div>
        </section>
        <section className="rounded-md border border-slate-200 p-3">
          <h3 className="mb-2 text-sm font-semibold">
            {t("production.nonConformity")}
          </h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              placeholder={t("f.type")}
              value={nc.type}
              onChange={(e) => setNc({ ...nc, type: e.target.value })}
            />
            <Input
              placeholder={t("f.description")}
              value={nc.description}
              onChange={(e) => setNc({ ...nc, description: e.target.value })}
              className="sm:col-span-2"
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={nc.rework}
                onChange={(e) => setNc({ ...nc, rework: e.target.checked })}
              />{" "}
              {t("production.reworkRequired")}
            </label>
            <Button
              size="sm"
              disabled={!nc.type || nc.description.trim().length < 3}
              onClick={() =>
                production
                  .nonConformity(op.id, {
                    type: nc.type,
                    description: nc.description,
                    reworkRequired: nc.rework,
                  })
                  .then(refresh)
                  .catch(fail)
              }
            >
              {t("common.add")}
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

export function ProductionPage() {
  const { t } = useTranslation();
  const can = useCan();
  const user = useAuth((s) => s.user)!;
  const [queue, setQueue] = useState("");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Doc | null>(null);
  const cols: Column<Doc>[] = [
    {
      key: "r",
      header: t("f.reference"),
      sortKey: "reference",
      render: (o) => ltr(o.reference),
    },
    {
      key: "t",
      header: t("production.operationType"),
      render: (o) => o.operationType,
    },
    {
      key: "e",
      header: t("production.executor"),
      render: (o) => t(`production.executors.${o.executorType}`),
    },
    {
      key: "s",
      header: t("common.status"),
      sortKey: "status",
      render: (o) => <StatusBadge status={o.status} />,
    },
    {
      key: "p",
      header: t("production.plannedEnd"),
      sortKey: "plannedEnd",
      render: (o) => {
        const late =
          o.plannedEnd &&
          new Date(o.plannedEnd) < new Date() &&
          !["completed", "cancelled"].includes(o.status);
        return (
          <span className={late ? "font-medium text-red-600" : undefined}>
            {fmtDate(o.plannedEnd)}
          </span>
        );
      },
    },
    {
      key: "q",
      header: t("production.qtyProduced"),
      render: (o) => `${o.quantityProduced ?? 0} / ${o.quantityOrdered ?? 0}`,
    },
    ...(user.role !== "printer" &&
    (can("finance.view") || user.role === "admin")
      ? [
          {
            key: "c",
            header: t("production.agreedCost"),
            render: (o: Doc) => money(o.agreedCostMinor),
          } as Column<Doc>,
        ]
      : []),
  ];
  return (
    <>
      <PageHeader
        title={t(user.role === "printer" ? "nav.myWork" : "nav.production")}
        actions={
          can("production.manage") && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> {t("common.add")}
            </Button>
          )
        }
      />
      <DataTable
        queryKey={["production"]}
        fetcher={(q) => production.list(q)}
        columns={cols}
        filters={{ queue }}
        onRowClick={setOpen}
        defaultSort="-createdAt"
        toolbar={
          <Select
            aria-label={t("production.queue")}
            className="w-auto"
            value={queue}
            onChange={(e) => setQueue(e.target.value)}
          >
            <option value="">{t("common.all")}</option>
            {["delayed", "blocked", "awaiting_approval"].map((x) => (
              <option key={x} value={x}>
                {t(`production.queues.${x}`)}
              </option>
            ))}
          </Select>
        }
      />
      {creating && <OperationForm onClose={() => setCreating(false)} />}
      {open && <OperationDetails op={open} onClose={() => setOpen(null)} />}
    </>
  );
}

// ---------------- Deliveries ----------------
function DeliveryForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const [orderId, setOrderId] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [carrier, setCarrier] = useState("");
  const [planned, setPlanned] = useState("");
  const [completes, setCompletes] = useState(false);
  const list = useQuery({
    queryKey: ["orders", "deliverable"],
    queryFn: () => orders.list({ limit: 100 }),
  });
  const order = useQuery({
    queryKey: ["orders", orderId],
    queryFn: () => orders.get(orderId),
    enabled: !!orderId,
  });
  const ready =
    list.data?.items.filter((o) =>
      ["in_production", "packed", "in_transit", "partially_delivered"].includes(
        o.status,
      ),
    ) ?? [];
  const lines = order.data?.lineItems ?? [];
  const m = useMutation({
    mutationFn: () =>
      deliveries.create({
        orderId,
        carrier: carrier || undefined,
        plannedDate: planned ? new Date(planned).toISOString() : undefined,
        completesOrder: lines.length ? undefined : completes,
        lines: lines.length
          ? lines
              .filter((l) => Number(qty[l.id]) > 0)
              .map((l) => ({ lineItemId: l.id, quantity: Number(qty[l.id]) }))
          : [],
      }),
    onSuccess: () => {
      toast("success", t("common.saved"));
      void qc.invalidateQueries({ queryKey: ["deliveries"] });
      onClose();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={t("deliveries.new")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={m.isPending}
            disabled={!orderId}
            onClick={() => m.mutate()}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("f.order")} required>
          <Select
            value={orderId}
            onChange={(e) => {
              setOrderId(e.target.value);
              setQty({});
            }}
          >
            <option value="">{t("common.select")}</option>
            {ready.map((o) => (
              <option key={o.id} value={o.id}>
                {o.jobCode} — {o.jobName}
              </option>
            ))}
          </Select>
        </Field>
        {orderId &&
          (lines.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="text-start">{t("f.description")}</th>
                  <th className="text-start">{t("deliveries.ordered")}</th>
                  <th className="text-start">{t("deliveries.delivered")}</th>
                  <th className="text-start">{t("deliveries.quantity")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-1">{l.description}</td>
                    <td>{l.quantity}</td>
                    <td>{l.deliveredQuantity}</td>
                    <td>
                      <Input
                        type="number"
                        min="0"
                        max={l.quantity - l.deliveredQuantity}
                        className="w-28"
                        value={qty[l.id] ?? ""}
                        onChange={(e) =>
                          setQty({ ...qty, [l.id]: e.target.value })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={completes}
                onChange={(e) => setCompletes(e.target.checked)}
              />{" "}
              {t("deliveries.completesOrder")}
            </label>
          ))}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("deliveries.carrier")}>
            <Input
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
            />
          </Field>
          <Field label={t("deliveries.plannedDate")}>
            <Input
              type="date"
              value={planned}
              onChange={(e) => setPlanned(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function DeliveriesPage() {
  const { t } = useTranslation();
  const can = useCan();
  const user = useAuth((s) => s.user)!;
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const NEXT: Record<string, string[]> = {
    planned: ["in_transit", "delivered", "cancelled"],
    in_transit: ["delivered", "failed"],
    failed: ["planned", "cancelled"],
  };
  const act = (d: Doc, s: string) =>
    deliveries
      .status(d.id, s)
      .then(() => {
        toast("success", t("common.saved"));
        void qc.invalidateQueries({ queryKey: ["deliveries"] });
        void qc.invalidateQueries({ queryKey: ["orders"] });
      })
      .catch((e) => toast("error", errorText(e, t)));
  const cols: Column<Doc>[] = [
    {
      key: "r",
      header: t("f.reference"),
      sortKey: "reference",
      render: (d) => ltr(d.reference),
    },
    {
      key: "l",
      header: t("deliveries.lines"),
      render: (d) =>
        d.lines
          ?.map((l: any) => `${l.description ?? ""} × ${l.quantity}`)
          .join(", ") || "—",
    },
    {
      key: "p",
      header: t("deliveries.plannedDate"),
      sortKey: "plannedDate",
      render: (d) => fmtDate(d.plannedDate),
    },
    {
      key: "a",
      header: t("deliveries.actualDate"),
      render: (d) => fmtDate(d.actualDate),
    },
    {
      key: "c",
      header: t("deliveries.carrier"),
      render: (d) => d.carrier ?? "—",
    },
    {
      key: "s",
      header: t("common.status"),
      render: (d) => <StatusBadge status={d.status} />,
    },
    {
      key: "x",
      header: "",
      render: (d) => (
        <div className="flex justify-end gap-1">
          {can("deliveries.manage") &&
            NEXT[d.status]?.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={
                  s === "cancelled" || s === "failed" ? "ghost" : "outline"
                }
                onClick={() => act(d, s)}
              >
                {t(`status.${s}`)}
              </Button>
            ))}
          <Button
            size="sm"
            variant="ghost"
            aria-label="PDF"
            onClick={() => reports.pdf("delivery", d.id)}
          >
            <Download className="size-4" />
          </Button>
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title={t(
          user.role === "client" ? "nav.myDeliveries" : "nav.deliveries",
        )}
        actions={
          can("deliveries.manage") && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> {t("common.add")}
            </Button>
          )
        }
      />
      <DataTable
        queryKey={["deliveries"]}
        fetcher={(q) => deliveries.list(q)}
        columns={cols}
        filters={{ status }}
        defaultSort="-createdAt"
        toolbar={
          <Select
            aria-label={t("common.status")}
            className="w-auto"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t("common.allStatuses")}</option>
            {["planned", "in_transit", "delivered", "failed", "cancelled"].map(
              (s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ),
            )}
          </Select>
        }
      />
      {creating && <DeliveryForm onClose={() => setCreating(false)} />}
    </>
  );
}
export { toDateInput };
