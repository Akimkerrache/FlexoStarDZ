import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  errorText,
} from "@/components/ui";
import { reports, res } from "@/services/api";
import { money } from "@/lib/utils";
import { isStaff, useAuth, useUi } from "@/stores";
import { ORDER_STATUSES } from "@/types";

function Kpi({
  label,
  value,
  tone = "text-slate-900",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Filters({
  f,
  setF,
  withClient,
}: {
  f: Record<string, string>;
  setF: (x: Record<string, string>) => void;
  withClient: boolean;
}) {
  const { t } = useTranslation();
  const clients = useQuery({
    queryKey: ["clients", "filter"],
    queryFn: () => res.clients.list({ limit: 100 }),
    enabled: withClient,
  });
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <Field label={t("common.from")}>
        <Input
          type="date"
          value={f.dateFrom?.slice(0, 10) ?? ""}
          onChange={(e) =>
            set(
              "dateFrom",
              e.target.value ? new Date(e.target.value).toISOString() : "",
            )
          }
        />
      </Field>
      <Field label={t("common.to")}>
        <Input
          type="date"
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
      </Field>
      {withClient && (
        <Field label={t("nav.clients")}>
          <Select
            value={f.clientId ?? ""}
            onChange={(e) => set("clientId", e.target.value)}
          >
            <option value="">{t("common.all")}</option>
            {clients.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("common.status")}>
        <Select
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
      </Field>
      <Button variant="ghost" onClick={() => setF({})}>
        {t("common.reset")}
      </Button>
    </div>
  );
}

const COLORS = [
  "#0f766e",
  "#0369a1",
  "#7c3aed",
  "#d97706",
  "#dc2626",
  "#4d7c0f",
  "#be185d",
  "#475569",
  "#0891b2",
  "#a16207",
  "#15803d",
  "#71717a",
];

export function DashboardView({ detailed }: { detailed?: boolean }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const [f, setF] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ["dashboard", f],
    queryFn: () => reports.dashboard(f),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const statusData = Object.entries(d.ordersByStatus ?? {}).map(([k, v]) => ({
    name: t(`status.${k}`),
    value: v as number,
    key: k,
  }));
  const staff = d.scope === "staff";
  const fin = d.finance;
  const cur = "DZD";

  return (
    <>
      <Filters f={f} setF={setF} withClient={staff} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {staff && (
          <>
            <Kpi
              label={t("dash.clients")}
              value={`${d.clients.active}`}
              hint={t("dash.ofTotal", { total: d.clients.total })}
            />
            <Kpi label={t("dash.printers")} value={d.printersActive} />
            <Kpi
              label={t("dash.inProgress")}
              value={d.ordersInProgress}
              tone="text-blue-700"
            />
            <Kpi
              label={t("dash.awaitingApproval")}
              value={d.ordersAwaitingApproval}
              tone="text-amber-700"
            />
            <Kpi
              label={t("dash.delayed")}
              value={d.ordersDelayed}
              tone={d.ordersDelayed ? "text-red-600" : undefined}
            />
            <Kpi
              label={t("dash.blocked")}
              value={d.blockedOperations}
              tone={d.blockedOperations ? "text-red-600" : undefined}
            />
            <Kpi
              label={t("dash.quotesAwaiting")}
              value={d.quotationsAwaitingResponse}
            />
            <Kpi
              label={t("dash.deliveriesScheduled")}
              value={d.deliveriesScheduled}
            />
          </>
        )}
        {d.scope === "client" && (
          <>
            <Kpi
              label={t("dash.inProgress")}
              value={Object.entries(d.ordersByStatus)
                .filter(
                  ([k]) =>
                    ![
                      "delivered",
                      "invoiced",
                      "cancelled",
                      "rejected",
                    ].includes(k),
                )
                .reduce((s, [, v]) => s + (v as number), 0)}
            />
            <Kpi
              label={t("dash.deliveriesScheduled")}
              value={d.scheduledDeliveries}
            />
            <Kpi
              label={t("dash.outstanding")}
              value={money(d.outstandingMinor, cur)}
              tone={d.outstandingMinor ? "text-amber-700" : undefined}
            />
          </>
        )}
        {d.scope === "printer" &&
          Object.entries(d.operationsByStatus ?? {}).map(([k, v]) => (
            <Kpi key={k} label={t(`status.${k}`)} value={v as number} />
          ))}
        {fin && (
          <>
            <Kpi
              label={t("dash.receivables")}
              value={money(fin.receivablesMinor, cur)}
              tone="text-amber-700"
            />
            <Kpi
              label={t("dash.payables")}
              value={money(fin.payablesMinor, cur)}
            />
            <Kpi
              label={t("dash.revenue")}
              value={money(fin.revenueMinor, cur)}
            />
            <Kpi
              label={t("dash.paymentsReceived")}
              value={money(fin.paymentsReceivedMinor, cur)}
              tone="text-emerald-700"
            />
            <Kpi
              label={t("dash.paymentsMade")}
              value={money(fin.paymentsMadeMinor, cur)}
            />
            <Kpi
              label={t("dash.expenses")}
              value={money(fin.expensesMinor, cur)}
            />
            <Kpi
              label={t("dash.estimatedMargin")}
              value={money(fin.estimatedMarginMinor, cur)}
            />
            <Kpi
              label={t("dash.actualMargin")}
              value={money(fin.actualMarginMinor, cur)}
              hint={t("dash.actualMarginHint")}
            />
          </>
        )}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("dash.ordersByStatus")} />
          <div className="h-72 p-3">
            {statusData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={statusData}
                  layout="vertical"
                  margin={{ left: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="value"
                    fill="#0f766e"
                    name={t("nav.orders")}
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title={t("dash.ordersOverTime")} />
          <div className="h-72 p-3">
            {d.ordersOverTime?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.ordersOverTime}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#0369a1"
                    strokeWidth={2}
                    name={t("nav.orders")}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </div>
        </Card>
      </div>

      {fin && (
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <Card>
            <CardHeader title={t("dash.topClients")} />
            <div className="h-64 p-3">
              {fin.topClients.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={fin.topClients.map((c: any) => ({
                      name: c.name ?? "—",
                      value: c.revenueMinor / 100,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip />
                    <Bar
                      dataKey="value"
                      fill={COLORS[2]}
                      name={t("dash.revenue")}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title={t("dash.topProducts")} />
            <div className="h-64 p-3">
              {fin.topProducts.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={fin.topProducts.map((c: any) => ({
                      name: c.name ?? "—",
                      value: c.revenueMinor / 100,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip />
                    <Bar
                      dataKey="value"
                      fill={COLORS[3]}
                      name={t("dash.revenue")}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title={t("dash.supplierPerformance")} />
            <div className="h-64 p-3">
              {fin.supplierPerformance.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={fin.supplierPerformance.map((c: any) => ({
                      name: c.name ?? "—",
                      operations: c.operations,
                      delayed: c.delayed,
                      nonConformities: c.nonConformities,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar
                      dataKey="operations"
                      fill={COLORS[1]}
                      name={t("dash.operations")}
                    />
                    <Bar
                      dataKey="delayed"
                      fill={COLORS[4]}
                      name={t("dash.delayedOps")}
                    />
                    <Bar
                      dataKey="nonConformities"
                      fill={COLORS[3]}
                      name={t("dash.nonConformities")}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
            </div>
          </Card>
        </div>
      )}

      {detailed && staff && (
        <Card className="mt-5">
          <CardHeader title={t("reports.exports")} />
          <div className="flex flex-wrap gap-2 p-4">
            {[
              "orders",
              ...(fin ? ["invoices", "payments", "expenses"] : []),
              "clients",
            ].map((r) => (
              <Button
                key={r}
                variant="outline"
                onClick={() =>
                  reports
                    .exportCsv(r, f)
                    .catch((e) => toast("error", errorText(e, t)))
                }
              >
                <Download className="size-4" /> {t(`reports.export.${r}`)}
              </Button>
            ))}
          </div>
        </Card>
      )}
      {!staff && !detailed && null}
    </>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user)!;
  return (
    <>
      <PageHeader
        title={t(user.role === "client" ? "nav.myDashboard" : "nav.dashboard")}
        subtitle={t("dash.welcome", { name: user.name })}
      />
      <DashboardView />
    </>
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  void isStaff(user);
  return (
    <>
      <PageHeader title={t("nav.reports")} subtitle={t("reports.subtitle")} />
      <DashboardView detailed />
    </>
  );
}
