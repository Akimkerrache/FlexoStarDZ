import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
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
  Textarea,
  errorText,
} from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import {
  LineItemsEditor,
  emptyLine,
  linesFromDocs,
  linesToPayload,
  linesValid,
  type LineDraft,
} from "@/features/LineItems";
import { invoices, payments, quotations, reports, res } from "@/services/api";
import { fmtDate, money, newKey, toDateInput, toMinor } from "@/lib/utils";
import { useAuth, useCan, useUi } from "@/stores";
import type { Doc } from "@/types";

const ltr = (v?: string) => <span className="ltr-text">{v || "—"}</span>;

function usePdf() {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  return (
    kind: "invoice" | "quotation" | "delivery" | "statement",
    id: string,
  ) => reports.pdf(kind, id).catch((e) => toast("error", errorText(e, t)));
}

// ---------------- Quotations ----------------
function QuotationEditor({
  q,
  onClose,
}: {
  q: Doc | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const can = useCan();
  const clients = useQuery({
    queryKey: ["clients", "select"],
    queryFn: () => res.clients.list({ limit: 100, isActive: "true" }),
  });
  const [clientId, setClientId] = useState(
    q?.clientId?.id ?? q?.clientId ?? "",
  );
  const [validUntil, setValidUntil] = useState(
    toDateInput(q?.validUntil) ||
      toDateInput(new Date(Date.now() + 30 * 86400000).toISOString()),
  );
  const [title, setTitle] = useState(q?.title ?? "");
  const [notes, setNotes] = useState(q?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    q ? linesFromDocs(q.lines) : [emptyLine()],
  );
  const withCost = can("finance.manage") || can("finance.view");
  const save = useMutation({
    mutationFn: () => {
      const body = {
        validUntil: new Date(validUntil).toISOString(),
        title: title || undefined,
        notes: notes || undefined,
        lines: linesToPayload(lines, withCost),
      };
      return q
        ? quotations.update(q.id, body)
        : quotations.create({ ...body, clientId });
    },
    onSuccess: () => {
      toast("success", t("common.saved"));
      void qc.invalidateQueries({ queryKey: ["quotations"] });
      onClose();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const locked = !!q && q.status !== "draft";
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={q ? q.number : t("quotations.new")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {!locked && (
            <Button
              loading={save.isPending}
              disabled={!clientId || !linesValid(lines)}
              onClick={() => save.mutate()}
            >
              {t("common.save")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {locked && (
          <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">
            {t("quotations.locked")}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("nav.clients")} required>
            <Select
              value={clientId}
              disabled={!!q}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">{t("common.select")}</option>
              {clients.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("quotations.validUntil")} required>
            <Input
              type="date"
              value={validUntil}
              disabled={locked}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </Field>
          <Field label={t("f.title")}>
            <Input
              value={title}
              disabled={locked}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
        </div>
        <LineItemsEditor
          lines={lines}
          onChange={setLines}
          withCost={withCost}
          disabled={locked}
        />
        <Field label={t("f.notes")}>
          <Textarea
            value={notes}
            disabled={locked}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {q?.estimatedCostMinor !== undefined && (
          <p className="text-sm text-slate-600">
            {t("f.estimatedCost")}: {money(q.estimatedCostMinor)} ·{" "}
            {t("f.estimatedMargin")}: {money(q.marginMinor)} ({q.marginPercent}
            %)
          </p>
        )}
      </div>
    </Modal>
  );
}

function ConvertModal({ q, onClose }: { q: Doc; onClose: () => void }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const machines = useQuery({
    queryKey: ["machines", "form"],
    queryFn: () => res.machines.list({ limit: 100, isActive: "true" }),
  });
  const [machineId, setMachineId] = useState("");
  const [jobName, setJobName] = useState(q.title ?? "");
  const [dir, setDir] = useState("surface");
  const [mat, setMat] = useState("transparent");
  const m = useMutation({
    mutationFn: () =>
      quotations.convert(q.id, {
        machineId,
        jobName,
        technicalSpecifications: { printDirection: dir, printMaterial: mat },
      }),
    onSuccess: (r) => {
      toast("success", t("quotations.converted", { code: r.jobCode }));
      nav(`/orders/${r.orderId}/edit`);
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("quotations.convert")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={m.isPending}
            disabled={!machineId || !jobName.trim()}
            onClick={() => m.mutate()}
          >
            {t("quotations.convert")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        {t("quotations.convertHint")}
      </p>
      <div className="space-y-3">
        <Field label={t("orderForm.machine")} required>
          <Select
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
          >
            <option value="">{t("orderForm.selectMachine")}</option>
            {machines.data?.items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("orderForm.jobName")} required>
          <Input value={jobName} onChange={(e) => setJobName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("orderForm.printDirection")}>
            <Select value={dir} onChange={(e) => setDir(e.target.value)}>
              {["surface", "reverse"].map((d) => (
                <option key={d} value={d}>
                  {t(`orderForm.dir.${d}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("orderForm.printMaterial")}>
            <Select value={mat} onChange={(e) => setMat(e.target.value)}>
              {["transparent", "white", "metalize"].map((d) => (
                <option key={d} value={d}>
                  {t(`material.${d}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function QuotationsPage() {
  const { t } = useTranslation();
  const can = useCan();
  const user = useAuth((s) => s.user)!;
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const pdf = usePdf();
  const [editing, setEditing] = useState<Doc | "new" | null>(null);
  const [converting, setConverting] = useState<Doc | null>(null);
  const [status, setStatus] = useState("");
  const manage = can("quotations.manage");
  const act = (q: Doc, s: string) =>
    quotations
      .status(q.id, s)
      .then(() => {
        toast("success", t("common.saved"));
        void qc.invalidateQueries({ queryKey: ["quotations"] });
      })
      .catch((e) => toast("error", errorText(e, t)));
  const NEXT: Record<string, string[]> = {
    draft: ["sent"],
    sent: ["accepted", "rejected", "draft"],
    rejected: ["draft"],
    expired: ["draft"],
  };
  const cols: Column<Doc>[] = [
    {
      key: "n",
      header: t("f.number"),
      sortKey: "number",
      render: (q) => ltr(q.number),
    },
    ...(user.role !== "client"
      ? [
          {
            key: "c",
            header: t("nav.clients"),
            render: (q: Doc) => q.clientId?.legalName ?? "—",
          } as Column<Doc>,
        ]
      : []),
    {
      key: "v",
      header: t("quotations.validUntil"),
      sortKey: "validUntil",
      render: (q) => fmtDate(q.validUntil),
    },
    {
      key: "s",
      header: t("common.status"),
      render: (q) => <StatusBadge status={q.status} />,
    },
    {
      key: "t",
      header: t("f.total"),
      sortKey: "grandTotalMinor",
      render: (q) => (
        <span className="font-medium">{money(q.grandTotalMinor)}</span>
      ),
    },
    {
      key: "a",
      header: "",
      render: (q) => (
        <div
          className="flex justify-end gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {manage &&
            NEXT[q.status]?.map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                onClick={() => act(q, s)}
              >
                {t(`quotations.action.${s}`)}
              </Button>
            ))}
          {manage && q.status === "accepted" && can("orders.create") && (
            <Button size="sm" onClick={() => setConverting(q)}>
              {t("quotations.convert")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label="PDF"
            onClick={() => pdf("quotation", q.id)}
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
        title={t("nav.quotations")}
        actions={
          manage && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" /> {t("common.add")}
            </Button>
          )
        }
      />
      <DataTable
        queryKey={["quotations"]}
        fetcher={(q) => quotations.list(q)}
        columns={cols}
        filters={{ status }}
        onRowClick={(q) => setEditing(q)}
        defaultSort="-createdAt"
        toolbar={
          <Select
            aria-label={t("common.status")}
            className="w-auto"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t("common.allStatuses")}</option>
            {[
              "draft",
              "sent",
              "accepted",
              "rejected",
              "expired",
              "converted",
            ].map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        }
      />
      {editing && (
        <QuotationEditor
          q={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {converting && (
        <ConvertModal q={converting} onClose={() => setConverting(null)} />
      )}
    </>
  );
}

// ---------------- Invoices & payments ----------------
function PaymentForm({
  invoice,
  onDone,
}: {
  invoice: Doc;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const [amount, setAmount] = useState(
    (invoice.outstandingMinor / 100).toFixed(2),
  );
  const [date, setDate] = useState(toDateInput(new Date().toISOString()));
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [key, setKey] = useState(newKey());
  const m = useMutation({
    mutationFn: () =>
      payments.create(
        {
          invoiceId: invoice.id,
          amountMinor: toMinor(amount),
          paymentDate: new Date(date).toISOString(),
          method,
          reference: reference || undefined,
        },
        key,
      ),
    onSuccess: () => {
      toast("success", t("payments.recorded"));
      setKey(newKey());
      onDone();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  return (
    <div className="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-5">
      <Field label={t("f.amount")}>
        <Input
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label={t("f.date")}>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field label={t("payments.method")}>
        <Select value={method} onChange={(e) => setMethod(e.target.value)}>
          {["bank_transfer", "cash", "cheque", "card", "other"].map((x) => (
            <option key={x} value={x}>
              {t(`payments.methods.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("payments.reference")}>
        <Input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </Field>
      <div className="flex items-end">
        <Button
          loading={m.isPending}
          disabled={!(Number(amount) > 0)}
          onClick={() => m.mutate()}
        >
          {t("payments.record")}
        </Button>
      </div>
    </div>
  );
}

function InvoiceModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const can = useCan();
  const pdf = usePdf();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const q = useQuery({
    queryKey: ["invoices", id],
    queryFn: () => invoices.get(id),
  });
  const pay = useQuery({
    queryKey: ["payments", "invoice", id],
    queryFn: () => payments.list({ invoiceId: id, limit: 100 }),
  });
  const [lines, setLines] = useState<LineDraft[] | null>(null);
  const refresh = () => {
    void q.refetch();
    void pay.refetch();
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ["payments"] });
  };
  const issue = useMutation({
    mutationFn: () => invoices.issue(id),
    onSuccess: () => {
      toast("success", t("invoices.issued"));
      refresh();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const save = useMutation({
    mutationFn: () => invoices.update(id, { lines: linesToPayload(lines!) }),
    onSuccess: () => {
      toast("success", t("common.saved"));
      setLines(null);
      refresh();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const cancel = useMutation({
    mutationFn: () => invoices.cancel(id, reason),
    onSuccess: () => {
      toast("success", t("common.saved"));
      setCancelling(false);
      refresh();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const inv = q.data;
  const manage = can("finance.manage");
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={inv?.number ?? t("invoices.draft")}
    >
      {!inv ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <StatusBadge status={inv.status} />
              <span className="text-sm text-slate-500">
                {t(`invoices.type.${inv.type}`)}
              </span>
            </div>
            <div className="flex gap-2">
              {manage && inv.status === "draft" && inv.type === "client" && (
                <Button
                  loading={issue.isPending}
                  onClick={() => issue.mutate()}
                >
                  {t("invoices.issue")}
                </Button>
              )}
              {manage &&
                !["cancelled", "paid"].includes(inv.status) &&
                inv.amountPaidMinor === 0 &&
                inv.status !== "draft" && (
                  <Button variant="danger" onClick={() => setCancelling(true)}>
                    {t("invoices.cancel")}
                  </Button>
                )}
              <Button variant="outline" onClick={() => pdf("invoice", inv.id)}>
                <Download className="size-4" /> PDF
              </Button>
            </div>
          </div>
          <DL
            items={[
              [t("f.date"), fmtDate(inv.invoiceDate)],
              [t("invoices.dueDate"), fmtDate(inv.dueDate)],
              [t("f.total"), money(inv.grandTotalMinor, inv.currency)],
              [t("invoices.paid"), money(inv.amountPaidMinor, inv.currency)],
              [
                t("invoices.outstanding"),
                <strong key="o">
                  {money(inv.outstandingMinor, inv.currency)}
                </strong>,
              ],
              [t("f.tax"), money(inv.taxTotalMinor, inv.currency)],
            ]}
          />
          <LineItemsEditor
            lines={lines ?? linesFromDocs(inv.lines)}
            onChange={setLines}
            disabled={!manage || inv.status !== "draft"}
          />
          {lines && (
            <div className="flex justify-end">
              <Button
                loading={save.isPending}
                disabled={!linesValid(lines)}
                onClick={() => save.mutate()}
              >
                {t("common.save")}
              </Button>
            </div>
          )}
          <section>
            <h3 className="mb-2 text-sm font-semibold">{t("nav.payments")}</h3>
            {pay.data?.items.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {pay.data.items.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="ltr-text">{p.number}</span>
                    <span>{fmtDate(p.paymentDate)}</span>
                    <span>{t(`payments.methods.${p.method}`)}</span>
                    <span className="ltr-text text-slate-500">
                      {p.reference}
                    </span>
                    <StatusBadge status={p.status} />
                    <span className="font-medium">
                      {money(p.amountMinor, p.currency)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {t(`payments.class.${p.classification}`)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">{t("payments.none")}</p>
            )}
            {manage &&
              ["issued", "partially_paid", "overdue"].includes(inv.status) && (
                <div className="mt-3">
                  <PaymentForm invoice={inv} onDone={refresh} />
                </div>
              )}
          </section>
        </div>
      )}
      <ConfirmDialog
        open={cancelling}
        danger
        title={t("invoices.cancel")}
        onClose={() => setCancelling(false)}
        loading={cancel.isPending}
        confirmDisabled={reason.trim().length < 3}
        onConfirm={() => cancel.mutate()}
      >
        <Field label={t("invoices.cancelReason")}>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </ConfirmDialog>
    </Modal>
  );
}

function NewInvoice({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const [type, setType] = useState<"client" | "supplier">("client");
  const [partyId, setPartyId] = useState("");
  const [due, setDue] = useState("");
  const [supplierNo, setSupplierNo] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const clients = useQuery({
    queryKey: ["clients", "select"],
    queryFn: () => res.clients.list({ limit: 100, isActive: "true" }),
  });
  const suppliers = useQuery({
    queryKey: ["suppliers", "select"],
    queryFn: () => res.suppliers.list({ limit: 100, isActive: "true" }),
  });
  const m = useMutation({
    mutationFn: () =>
      invoices.create({
        type,
        ...(type === "client"
          ? { clientId: partyId }
          : {
              supplierId: partyId,
              supplierInvoiceNumber: supplierNo || undefined,
            }),
        dueDate: due ? new Date(due).toISOString() : undefined,
        lines: linesToPayload(lines),
      }),
    onSuccess: () => {
      toast("success", t("common.saved"));
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      onClose();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const parties =
    type === "client"
      ? clients.data?.items.map((c) => ({ id: c.id, name: c.legalName }))
      : suppliers.data?.items.map((c) => ({ id: c.id, name: c.name }));
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={t("invoices.new")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={m.isPending}
            disabled={!partyId || !linesValid(lines)}
            onClick={() => m.mutate()}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label={t("f.type")}>
            <Select
              value={type}
              onChange={(e) => {
                setType(e.target.value as any);
                setPartyId("");
              }}
            >
              {["client", "supplier"].map((x) => (
                <option key={x} value={x}>
                  {t(`invoices.type.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t(type === "client" ? "nav.clients" : "nav.suppliers")}
            required
          >
            <Select
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
            >
              <option value="">{t("common.select")}</option>
              {parties?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("invoices.dueDate")}>
            <Input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
          {type === "supplier" && (
            <Field label={t("invoices.supplierNumber")}>
              <Input
                value={supplierNo}
                onChange={(e) => setSupplierNo(e.target.value)}
              />
            </Field>
          )}
        </div>
        <LineItemsEditor lines={lines} onChange={setLines} />
        <p className="text-xs text-slate-500">{t("invoices.legalNotice")}</p>
      </div>
    </Modal>
  );
}

export function InvoicesPage() {
  const { t } = useTranslation();
  const can = useCan();
  const user = useAuth((s) => s.user)!;
  const pdf = usePdf();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const cols: Column<Doc>[] = [
    {
      key: "n",
      header: t("f.number"),
      sortKey: "number",
      render: (i) => ltr(i.number ?? t("invoices.draft")),
    },
    ...(user.role !== "client"
      ? [
          {
            key: "ty",
            header: t("f.type"),
            render: (i: Doc) => t(`invoices.type.${i.type}`),
          } as Column<Doc>,
          {
            key: "p",
            header: t("invoices.party"),
            render: (i: Doc) =>
              i.clientId?.legalName ?? i.supplierId?.name ?? "—",
          } as Column<Doc>,
        ]
      : []),
    {
      key: "d",
      header: t("f.date"),
      sortKey: "invoiceDate",
      render: (i) => fmtDate(i.invoiceDate),
    },
    {
      key: "due",
      header: t("invoices.dueDate"),
      sortKey: "dueDate",
      render: (i) => fmtDate(i.dueDate),
    },
    {
      key: "s",
      header: t("common.status"),
      render: (i) => <StatusBadge status={i.status} />,
    },
    {
      key: "t",
      header: t("f.total"),
      sortKey: "grandTotalMinor",
      render: (i) => money(i.grandTotalMinor, i.currency),
    },
    {
      key: "o",
      header: t("invoices.outstanding"),
      render: (i) => (
        <span className="font-medium">
          {money(i.outstandingMinor, i.currency)}
        </span>
      ),
    },
    {
      key: "a",
      header: "",
      render: (i) => (
        <Button
          size="sm"
          variant="ghost"
          aria-label="PDF"
          onClick={(e) => {
            e.stopPropagation();
            void pdf("invoice", i.id);
          }}
        >
          <Download className="size-4" />
        </Button>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title={t(user.role === "client" ? "nav.myInvoices" : "nav.invoices")}
        actions={
          <>
            {user.role === "client" && user.clientId && (
              <Button
                variant="outline"
                onClick={() => void pdf("statement", user.clientId!)}
              >
                <Download className="size-4" /> {t("invoices.statement")}
              </Button>
            )}
            {can("finance.manage") && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" /> {t("common.add")}
              </Button>
            )}
          </>
        }
      />
      <DataTable
        queryKey={["invoices"]}
        fetcher={(q) => invoices.list(q)}
        columns={cols}
        filters={f}
        onRowClick={(i) => setOpen(i.id)}
        defaultSort="-createdAt"
        empty={<EmptyState title={t("invoices.empty")} />}
        toolbar={
          <>
            {user.role !== "client" && (
              <Select
                aria-label={t("f.type")}
                className="w-auto"
                value={f.type ?? ""}
                onChange={(e) => setF({ ...f, type: e.target.value })}
              >
                <option value="">{t("common.all")}</option>
                {["client", "supplier"].map((x) => (
                  <option key={x} value={x}>
                    {t(`invoices.type.${x}`)}
                  </option>
                ))}
              </Select>
            )}
            <Select
              aria-label={t("common.status")}
              className="w-auto"
              value={f.status ?? ""}
              onChange={(e) => setF({ ...f, status: e.target.value })}
            >
              <option value="">{t("common.allStatuses")}</option>
              {[
                "draft",
                "issued",
                "partially_paid",
                "paid",
                "overdue",
                "cancelled",
              ].map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </>
        }
      />
      {open && <InvoiceModal id={open} onClose={() => setOpen(null)} />}
      {creating && <NewInvoice onClose={() => setCreating(false)} />}
    </>
  );
}

export function PaymentsPage() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user)!;
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const [voiding, setVoiding] = useState<Doc | null>(null);
  const [reason, setReason] = useState("");
  const [dir, setDir] = useState("");
  const void_ = useMutation({
    mutationFn: () => payments.void(voiding!.id, reason),
    onSuccess: () => {
      toast("success", t("common.saved"));
      setVoiding(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["payments"] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  const cols: Column<Doc>[] = [
    { key: "n", header: t("f.number"), render: (p) => ltr(p.number) },
    {
      key: "i",
      header: t("nav.invoices"),
      render: (p) => ltr(p.invoiceId?.number),
    },
    {
      key: "d",
      header: t("f.date"),
      sortKey: "paymentDate",
      render: (p) => fmtDate(p.paymentDate),
    },
    {
      key: "m",
      header: t("payments.method"),
      render: (p) => t(`payments.methods.${p.method}`),
    },
    {
      key: "r",
      header: t("payments.reference"),
      render: (p) => ltr(p.reference ?? p.voidedReference),
    },
    {
      key: "dir",
      header: t("payments.direction"),
      render: (p) => t(`payments.dir.${p.direction}`),
    },
    {
      key: "a",
      header: t("f.amount"),
      sortKey: "amountMinor",
      render: (p) => (
        <span className="font-medium">{money(p.amountMinor, p.currency)}</span>
      ),
    },
    {
      key: "s",
      header: t("common.status"),
      render: (p) => <StatusBadge status={p.status} />,
    },
    ...(user.role === "admin"
      ? [
          {
            key: "x",
            header: "",
            render: (p: Doc) =>
              p.status === "recorded" ? (
                <Button size="sm" variant="ghost" onClick={() => setVoiding(p)}>
                  {t("payments.void")}
                </Button>
              ) : null,
          } as Column<Doc>,
        ]
      : []),
  ];
  return (
    <>
      <PageHeader title={t("nav.payments")} />
      <DataTable
        queryKey={["payments"]}
        fetcher={(q) => payments.list(q)}
        columns={cols}
        searchable={false}
        defaultSort="-paymentDate"
        filters={{ direction: dir }}
        toolbar={
          user.role !== "client" ? (
            <Select
              aria-label={t("payments.direction")}
              className="w-auto"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
            >
              <option value="">{t("common.all")}</option>
              {["in", "out"].map((x) => (
                <option key={x} value={x}>
                  {t(`payments.dir.${x}`)}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />
      <ConfirmDialog
        open={!!voiding}
        danger
        title={t("payments.void")}
        message={t("payments.voidHint")}
        loading={void_.isPending}
        confirmDisabled={reason.trim().length < 3}
        onClose={() => setVoiding(null)}
        onConfirm={() => void_.mutate()}
      >
        <Field label={t("invoices.cancelReason")}>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </ConfirmDialog>
    </>
  );
}
