import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Bell, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DL,
  EmptyState,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  errorText,
} from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { openDownload } from "@/features/FileList";
import { useSettings } from "@/features/Uploader";
import {
  auditLogs,
  auth as authApi,
  files,
  notifications,
} from "@/services/api";
import { applyLanguage } from "@/i18n";
import { fmtBytes, fmtDate } from "@/lib/utils";
import { useAuth, useUi } from "@/stores";
import { PERMISSIONS, type Doc, type FileAsset } from "@/types";

export function FilesPage() {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const [category, setCategory] = useState("");
  const cols: Column<FileAsset>[] = [
    {
      key: "n",
      header: t("f.name"),
      sortKey: "originalName",
      render: (f) => (
        <span className="ltr-text font-medium">{f.originalName}</span>
      ),
    },
    { key: "v", header: t("files.version"), render: (f) => `v${f.version}` },
    {
      key: "c",
      header: t("f.category"),
      render: (f) =>
        t(`fileCategory.${f.category}`, { defaultValue: f.category }),
    },
    {
      key: "s",
      header: t("files.size"),
      sortKey: "sizeBytes",
      render: (f) => fmtBytes(f.sizeBytes),
    },
    {
      key: "a",
      header: t("files.access"),
      render: (f) =>
        f.accessClass === "internal" ? (
          <Badge tone="bg-amber-100 text-amber-800">
            {t("files.internal")}
          </Badge>
        ) : (
          <Badge>{t("files.shared")}</Badge>
        ),
    },
    {
      key: "d",
      header: t("f.created"),
      sortKey: "createdAt",
      render: (f) => fmtDate(f.createdAt),
    },
    {
      key: "x",
      header: "",
      render: (f) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            openDownload(f.id).catch((e) => toast("error", errorText(e, t)))
          }
        >
          <Download className="size-4" /> {t("files.download")}
        </Button>
      ),
    },
  ];
  return (
    <>
      <PageHeader title={t("nav.files")} subtitle={t("files.subtitle")} />
      <DataTable<FileAsset>
        queryKey={["files"]}
        fetcher={(q) => files.list(q)}
        columns={cols}
        filters={{ category }}
        defaultSort="-createdAt"
        toolbar={
          <Select
            aria-label={t("f.category")}
            className="w-auto"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">{t("common.all")}</option>
            {[
              "design",
              "proof",
              "print_ready",
              "document",
              "invoice",
              "delivery_proof",
              "plate_original",
              "plate_corrected",
              "other",
            ].map((c) => (
              <option key={c} value={c}>
                {t(`fileCategory.${c}`)}
              </option>
            ))}
          </Select>
        }
      />
    </>
  );
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user)!;
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => notifications.list({ limit: 50 }),
  });
  const refresh = () => {
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const readAll = useMutation({
    mutationFn: notifications.readAll,
    onSuccess: refresh,
  });
  const scan = useMutation({
    mutationFn: notifications.scan,
    onSuccess: () => {
      toast("success", t("notifications.scanned"));
      refresh();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  return (
    <>
      <PageHeader
        title={t("nav.notifications")}
        actions={
          <>
            {user.role === "admin" && (
              <Button
                variant="outline"
                loading={scan.isPending}
                onClick={() => scan.mutate()}
              >
                {t("notifications.scan")}
              </Button>
            )}
            <Button variant="outline" onClick={() => readAll.mutate()}>
              {t("notifications.markAll")}
            </Button>
          </>
        }
      />
      <Card>
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.items.length ? (
          <EmptyState title={t("notifications.empty")} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {q.data.items.map((n) => (
              <li key={n.id}>
                <button
                  className="flex w-full items-start gap-3 p-4 text-start hover:bg-slate-50"
                  onClick={() => {
                    void notifications.read(n.id).then(refresh);
                    if (n.link) nav(n.link);
                  }}
                >
                  <Bell
                    className={`mt-0.5 size-4 ${n.readAt ? "text-slate-300" : "text-teal-700"}`}
                  />
                  <span className="flex-1">
                    <span
                      className={`block text-sm ${n.readAt ? "text-slate-600" : "font-semibold"}`}
                    >
                      {n.title}
                    </span>
                    {n.body && (
                      <span className="block text-sm text-slate-500">
                        {n.body}
                      </span>
                    )}
                    <span className="text-xs text-slate-400">
                      {fmtDate(n.createdAt, true)}
                    </span>
                  </span>
                  {!n.readAt && (
                    <Badge tone="bg-teal-100 text-teal-800">
                      {t("notifications.new")}
                    </Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export function AuditLogsPage() {
  const { t } = useTranslation();
  const [f, setF] = useState<Record<string, string>>({});
  const cols: Column<Doc>[] = [
    {
      key: "d",
      header: t("f.date"),
      sortKey: "createdAt",
      render: (l) => fmtDate(l.createdAt, true),
    },
    {
      key: "u",
      header: t("audit.actor"),
      render: (l) =>
        l.actorId ? `${l.actorId.name} (${l.actorRole})` : t("audit.system"),
    },
    {
      key: "a",
      header: t("audit.action"),
      sortKey: "action",
      render: (l) => (
        <span className="ltr-text font-mono text-xs">{l.action}</span>
      ),
    },
    {
      key: "t",
      header: t("audit.target"),
      render: (l) => (
        <span className="ltr-text text-xs">
          {l.targetType} {l.targetId}
        </span>
      ),
    },
    {
      key: "m",
      header: t("audit.details"),
      render: (l) => (
        <code className="ltr-text block max-w-md truncate text-xs text-slate-500">
          {JSON.stringify(l.metadata)}
        </code>
      ),
    },
  ];
  return (
    <>
      <PageHeader title={t("nav.auditLogs")} subtitle={t("audit.subtitle")} />
      <DataTable
        queryKey={["audit"]}
        fetcher={(q) => auditLogs.list(q)}
        columns={cols}
        filters={f}
        defaultSort="-createdAt"
        toolbar={
          <>
            <Input
              aria-label={t("audit.action")}
              placeholder={t("audit.actionPrefix")}
              className="w-48"
              value={f.action ?? ""}
              onChange={(e) => setF({ ...f, action: e.target.value })}
            />
            <Input
              aria-label={t("audit.target")}
              placeholder="Order, Invoice…"
              className="w-40"
              value={f.targetType ?? ""}
              onChange={(e) => setF({ ...f, targetType: e.target.value })}
            />
          </>
        }
      />
    </>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const q = useSettings();
  if (q.isLoading) return <Loading />;
  const s = q.data!;
  const yes = (b: boolean) => (
    <Badge
      tone={
        b ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"
      }
    >
      {b ? t("common.yes") : t("common.no")}
    </Badge>
  );
  return (
    <>
      <PageHeader title={t("nav.settings")} subtitle={t("settings.subtitle")} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("settings.businessRules")} />
          <div className="space-y-3 p-4">
            <DL
              items={[
                [t("settings.jobNameRule"), yes(s.jobNameRejectArabic)],
                [
                  t("settings.colorCountPantone"),
                  yes(s.colorCountIncludesPantone),
                ],
                [t("settings.currency"), s.defaultCurrency],
                [
                  t("settings.alertInterval"),
                  `${s.alertScanIntervalMinutes} min`,
                ],
              ]}
            />
            <p className="text-xs text-slate-500">{t("settings.envHint")}</p>
          </div>
        </Card>
        <Card>
          <CardHeader title={t("settings.storage")} />
          <div className="space-y-3 p-4">
            <DL
              items={[
                [t("settings.storageConfigured"), yes(s.storageConfigured)],
                [t("settings.maxUpload"), `${s.maxUploadSizeMb} MB`],
                [t("settings.maxSingle"), `${s.maxSingleUploadSizeMb} MB`],
              ]}
            />
            {!s.storageConfigured && (
              <p
                role="alert"
                className="rounded-md bg-amber-50 p-3 text-sm text-amber-800"
              >
                {t("upload.notConfigured")}
              </p>
            )}
            <p className="text-xs text-slate-500">{t("settings.scanNotice")}</p>
          </div>
        </Card>
        <Card>
          <CardHeader title={t("settings.orderWorkflow")} />
          <div className="p-4">
            <ul className="space-y-1.5 text-sm">
              {Object.entries(s.orderTransitions).map(([from, to]) => (
                <li key={from}>
                  <strong>{t(`status.${from}`)}</strong> →{" "}
                  {to.length ? to.map((x) => t(`status.${x}`)).join(", ") : "—"}
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card>
          <CardHeader title={t("settings.permissionCatalogue")} />
          <div className="p-4">
            <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
              {PERMISSIONS.map((p) => (
                <li key={p}>{t(`perm.${p.replace('.', '_')}`)}</li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}

export function ProfilePage() {
  const { t } = useTranslation();
  const { user, setUser, logout } = useAuth();
  const { lang, setLang, toast } = useUi();
  const nav = useNavigate();
  const [name, setName] = useState(user!.name);
  const [busy, setBusy] = useState(false);
  const schema = z.object({
    currentPassword: z.string().min(1, t("validation.required")),
    newPassword: z.string().min(10, t("validation.password")),
  });
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const saveProfile = async (patch: { name?: string; language?: string }) => {
    setBusy(true);
    try {
      setUser(await authApi.updateMe(patch));
      toast("success", t("common.saved"));
    } catch (e) {
      toast("error", errorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title={t("nav.profile")} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("profile.account")} />
          <div className="space-y-4 p-4">
            <DL
              items={[
                [
                  t("f.email"),
                  <span key="e" className="ltr-text">
                    {user!.email}
                  </span>,
                ],
                [t("profile.role"), t(`roles.${user!.role}`)],
                [t("f.lastLogin"), fmtDate(user!.lastLoginAt, true)],
              ]}
            />
            <Field label={t("f.name")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("common.language")}>
              <Select
                value={lang}
                onChange={(e) => {
                  const l = e.target.value as "en" | "ar";
                  setLang(l);
                  applyLanguage(l);
                  void saveProfile({ language: l });
                }}
              >
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </Select>
            </Field>
            <Button
              loading={busy}
              disabled={!name.trim() || name === user!.name}
              onClick={() => saveProfile({ name })}
            >
              {t("common.save")}
            </Button>
          </div>
        </Card>
        <Card>
          <CardHeader title={t("profile.changePassword")} />
          <form
            noValidate
            className="space-y-4 p-4"
            onSubmit={f.handleSubmit(async (v) => {
              try {
                await authApi.changePassword(v.currentPassword, v.newPassword);
                toast("success", t("profile.passwordChanged"));
                await logout();
                nav("/login");
              } catch (e) {
                toast("error", errorText(e, t));
              }
            })}
          >
            <Field
              label={t("profile.currentPassword")}
              error={f.formState.errors.currentPassword?.message}
            >
              <Input
                type="password"
                autoComplete="current-password"
                {...f.register("currentPassword")}
              />
            </Field>
            <Field
              label={t("accounts.newPassword")}
              hint={t("accounts.passwordHint")}
              error={f.formState.errors.newPassword?.message}
            >
              <Input
                type="password"
                autoComplete="new-password"
                {...f.register("newPassword")}
              />
            </Field>
            <Button type="submit" loading={f.formState.isSubmitting}>
              {t("profile.changePassword")}
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}

