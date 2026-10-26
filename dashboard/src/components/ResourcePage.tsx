import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, RotateCcw, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  ConfirmDialog,
  errorText,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
} from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { ResourceForm, type FieldDef } from "@/components/ResourceForm";
import { accounts } from "@/services/api";
import { useUi } from "@/stores";
import type { Doc, Paged } from "@/types";

export interface ResourceConfig {
  key: string;
  titleKey: string;
  api: {
    list: (q?: any) => Promise<Paged<Doc>>;
    create: (b: unknown) => Promise<Doc>;
    update: (id: string, b: unknown) => Promise<Doc>;
    archive?: (id: string) => Promise<Doc>;
    restore?: (id: string) => Promise<Doc>;
  };
  columns: Column<Doc>[];
  fields: FieldDef[];
  canWrite: boolean;
  /** Clients and printers can be created together with their login account. */
  accountKind?: "clients" | "printers";
  filterField?: {
    name: string;
    label: string;
    options: { value: string; label: string }[];
  };
  extraActions?: (row: Doc) => ReactNode;
  showArchiveFilter?: boolean;
}

const accountFields: FieldDef[] = [
  {
    name: "account.name",
    label: "accounts.name",
    type: "text",
    createOnly: true,
  },
  {
    name: "account.email",
    label: "accounts.email",
    type: "email",
    createOnly: true,
  },
  {
    name: "account.password",
    label: "accounts.password",
    type: "password",
    createOnly: true,
    hint: "accounts.passwordHint",
  },
];

export function AccountsModal({
  kind,
  owner,
  onClose,
}: {
  kind: "clients" | "printers";
  owner: Doc;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const [reset, setReset] = useState<Doc | null>(null);
  const [pw, setPw] = useState("");
  const list = useQuery({ queryKey: ['accounts', kind, owner.id], queryFn: () => accounts.list(kind, owner.id) });
  const users = list.data ?? null;
  const done = () => {
    void list.refetch();
    void qc.invalidateQueries({ queryKey: [kind] });
  };
  const run = (fn: () => Promise<unknown>, okKey: string) =>
    fn()
      .then(() => {
        toast("success", t(okKey));
        done();
      })
      .catch((e) => toast("error", errorText(e, t)));

  return (
    <Modal
      open
      onClose={onClose}
      title={t("accounts.title", { name: owner.legalName ?? owner.name })}
      wide
    >
      <div className="space-y-4">
        {users?.length === 0 && (
          <p className="text-sm text-slate-500">{t("accounts.none")}</p>
        )}
        <ul className="divide-y divide-slate-100">
          {users?.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{u.name}</p>
                <p className="ltr-text text-slate-500">{u.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge
                  status={u.isActive ? "recorded" : "voided"}
                  label={u.isActive ? t("common.active") : t("common.inactive")}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    run(
                      () =>
                        u.isActive
                          ? accounts.deactivate(u.id)
                          : accounts.activate(u.id),
                      "common.saved",
                    )
                  }
                >
                  {u.isActive ? t("common.deactivate") : t("common.activate")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setReset(u)}>
                  {t("accounts.resetPassword")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <h3 className="text-sm font-semibold">{t("accounts.add")}</h3>
        <ResourceForm
          fields={[
            {
              name: "name",
              label: "accounts.name",
              type: "text",
              required: true,
            },
            {
              name: "email",
              label: "accounts.email",
              type: "email",
              required: true,
            },
            {
              name: "password",
              label: "accounts.password",
              type: "password",
              required: true,
              hint: "accounts.passwordHint",
            },
          ]}
          onCancel={onClose}
          onSubmit={async (p) => {
            await accounts.create(kind, owner.id, p);
            toast("success", t("common.saved"));
            done();
          }}
        />
      </div>
      <ConfirmDialog
        open={!!reset}
        title={t("accounts.resetPassword")}
        onClose={() => {
          setReset(null);
          setPw("");
        }}
        confirmLabel={t("common.save")}
        onConfirm={() =>
          run(() => accounts.resetPassword(reset!.id, pw), "common.saved").then(
            () => {
              setReset(null);
              setPw("");
            },
          )
        }
      >
        <Field
          label={t("accounts.newPassword")}
          hint={t("accounts.passwordHint")}
        >
          <Input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </ConfirmDialog>
    </Modal>
  );
}

export function ResourcePage({ cfg }: { cfg: ResourceConfig }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState<Doc | "new" | null>(null);
  const [archiving, setArchiving] = useState<Doc | null>(null);
  const [accountsFor, setAccountsFor] = useState<Doc | null>(null);
  const [filter, setFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const fields = cfg.accountKind
    ? [...cfg.fields, ...accountFields]
    : cfg.fields;
  const invalidate = () => qc.invalidateQueries({ queryKey: [cfg.key] });
  const archive = useMutation({
    mutationFn: (d: Doc) =>
      d.isActive === false ? cfg.api.restore!(d.id) : cfg.api.archive!(d.id),
    onSuccess: () => {
      toast("success", t("common.saved"));
      setArchiving(null);
      void invalidate();
    },
    onError: (e) => toast("error", errorText(e, t)),
  });

  const columns: Column<Doc>[] = [
    ...cfg.columns,
    ...(cfg.canWrite || cfg.extraActions
      ? [
          {
            key: "actions",
            header: <span className="sr-only">{t("common.actions")}</span>,
            render: (d: Doc) => (
              <div
                className="flex items-center justify-end gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                {cfg.extraActions?.(d)}
                {cfg.canWrite && cfg.accountKind && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("accounts.manage")}
                    title={t("accounts.manage")}
                    onClick={() => setAccountsFor(d)}
                  >
                    <Users className="size-4" />
                  </Button>
                )}
                {cfg.canWrite && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("common.edit")}
                    title={t("common.edit")}
                    onClick={() => setEditing(d)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                )}
                {cfg.canWrite && cfg.api.archive && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={
                      d.isActive === false
                        ? t("common.restore")
                        : t("common.archive")
                    }
                    title={
                      d.isActive === false
                        ? t("common.restore")
                        : t("common.archive")
                    }
                    onClick={() => setArchiving(d)}
                  >
                    {d.isActive === false ? (
                      <RotateCcw className="size-4" />
                    ) : (
                      <Archive className="size-4" />
                    )}
                  </Button>
                )}
              </div>
            ),
          } satisfies Column<Doc>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t(cfg.titleKey)}
        actions={
          cfg.canWrite && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" /> {t("common.add")}
            </Button>
          )
        }
      />
      <DataTable
        queryKey={[cfg.key]}
        fetcher={(q) => cfg.api.list(q)}
        columns={columns}
        filters={{
          ...(cfg.filterField && filter
            ? { [cfg.filterField.name]: filter }
            : {}),
          ...(showArchived ? { includeArchived: "true" } : {}),
        }}
        defaultSort={undefined}
        toolbar={
          <>
            {cfg.filterField && (
              <Select
                aria-label={t(cfg.filterField.label)}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-auto"
              >
                <option value="">{t(cfg.filterField.label)}</option>
                {cfg.filterField.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.label, { defaultValue: o.label })}
                  </option>
                ))}
              </Select>
            )}
            {cfg.api.archive && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="size-4"
                />{" "}
                {t("common.showArchived")}
              </label>
            )}
          </>
        }
      />
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? t("common.add") : t("common.edit")}
        wide
      >
        {editing && (
          <ResourceForm
            fields={fields}
            initial={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSubmit={async (payload) => {
              if (
                payload.account &&
                !payload.account.email &&
                !payload.account.name &&
                !payload.account.password
              )
                delete payload.account;
              await (editing === "new"
                ? cfg.api.create(payload)
                : cfg.api.update(editing.id, payload));
              toast("success", t("common.saved"));
              setEditing(null);
              void invalidate();
            }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={!!archiving}
        danger={archiving?.isActive !== false}
        title={
          archiving?.isActive === false
            ? t("common.restore")
            : t("common.archive")
        }
        message={
          archiving?.isActive === false
            ? t("common.restoreConfirm")
            : t("common.archiveConfirm")
        }
        loading={archive.isPending}
        onClose={() => setArchiving(null)}
        onConfirm={() => archive.mutate(archiving!)}
      />
      {accountsFor && cfg.accountKind && (
        <AccountsModal
          kind={cfg.accountKind}
          owner={accountsFor}
          onClose={() => setAccountsFor(null)}
        />
      )}
    </>
  );
}
