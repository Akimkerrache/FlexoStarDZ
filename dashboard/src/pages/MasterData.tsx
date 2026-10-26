import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ResourcePage, type ResourceConfig } from "@/components/ResourcePage";
import {
  Button,
  Field,
  Modal,
  StatusBadge,
  Textarea,
  errorText,
} from "@/components/ui";
import { type Column } from "@/components/DataTable";
import { ConfirmDialog } from "@/components/ui";
import { managers, orders, res } from "@/services/api";
import { http } from "@/services/http";
import { useAuth, useCan, useUi } from "@/stores";
import { fmtDate, money } from "@/lib/utils";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/ui";
import { ResourceForm, type FieldDef } from "@/components/ResourceForm";
import { PERMISSIONS, type Doc } from "@/types";

const activeCol: Column<Doc> = {
  key: "status",
  header: "common.status",
  render: (d) => <ActiveBadge d={d} />,
};
function ActiveBadge({ d }: { d: Doc }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      status={d.isActive === false ? "voided" : "recorded"}
      label={d.isActive === false ? t("common.inactive") : t("common.active")}
    />
  );
}
const col = (
  key: string,
  header: React.ReactNode,
  render: (d: Doc) => React.ReactNode,
  sortKey?: string,
): Column<Doc> => ({ key, header, render, sortKey });
const ltr = (v?: string) => <span className="ltr-text">{v || "—"}</span>;

function Header({ k }: { k: string }) {
  const { t } = useTranslation();
  return <>{t(k)}</>;
}
const h = (k: string) => <Header k={k} />;

const addressFields = (p: string): FieldDef[] => [
  { name: `${p}.line1`, label: "f.addressLine", type: "text" },
  { name: `${p}.city`, label: "f.city", type: "text" },
  { name: `${p}.country`, label: "f.country", type: "text" },
];

export function ClientsPage() {
  const can = useCan();
  const cfg: ResourceConfig = {
    key: "clients",
    titleKey: "nav.clients",
    api: res.clients as any,
    canWrite: can("clients.manage"),
    accountKind: "clients",
    columns: [
      col("code", h("f.code"), (d) => ltr(d.code), "code"),
      col(
        "legalName",
        h("f.legalName"),
        (d) => <span className="font-medium">{d.legalName}</span>,
        "legalName",
      ),
      col("email", h("f.email"), (d) => ltr(d.email)),
      col("phone", h("f.phone"), (d) => ltr(d.phone)),
      { ...activeCol, header: h("common.status") },
    ],
    fields: [
      { name: "legalName", label: "f.legalName", type: "text", required: true },
      {
        name: "code",
        label: "f.code",
        type: "text",
        hint: "f.codeAuto",
        createOnly: true,
      },
      { name: "email", label: "f.email", type: "email" },
      { name: "phone", label: "f.phone", type: "text" },
      ...addressFields("address"),
      {
        name: "administrative.registrationNumber",
        label: "f.registrationNumber",
        type: "text",
      },
      {
        name: "administrative.taxIdentifier",
        label: "f.taxIdentifier",
        type: "text",
      },
      {
        name: "commercial.paymentTermsDays",
        label: "f.paymentTermsDays",
        type: "integer",
        min: 0,
        max: 365,
      },
      {
        name: "commercial.conditions",
        label: "f.commercialConditions",
        type: "textarea",
      },
      { name: "internalNotes", label: "f.internalNotes", type: "textarea" },
    ],
  };
  return <ResourcePage cfg={cfg} />;
}

export function PrintersPage() {
  const can = useCan();
  const cfg: ResourceConfig = {
    key: "printers",
    titleKey: "nav.printers",
    api: res.printers as any,
    canWrite:
      can("clients.manage") && useAuth.getState().user?.role === "admin",
    accountKind: "printers",
    columns: [
      col("code", h("f.code"), (d) => ltr(d.code), "code"),
      col(
        "name",
        h("f.name"),
        (d) => <span className="font-medium">{d.name}</span>,
        "name",
      ),
      col("contact", h("f.contactPerson"), (d) => d.contactPerson),
      col("phone", h("f.phone"), (d) => ltr(d.phone)),
      { ...activeCol, header: h("common.status") },
    ],
    fields: [
      { name: "name", label: "f.name", type: "text", required: true },
      {
        name: "code",
        label: "f.code",
        type: "text",
        hint: "f.codeAuto",
        createOnly: true,
      },
      { name: "contactPerson", label: "f.contactPerson", type: "text" },
      { name: "email", label: "f.email", type: "email" },
      { name: "phone", label: "f.phone", type: "text" },
      ...addressFields("address"),
      {
        name: "capabilities",
        label: "f.capabilities",
        type: "tags",
        hint: "f.tagsHint",
      },
      { name: "technicalSpecs", label: "f.technicalSpecs", type: "textarea" },
      { name: "notes", label: "f.notes", type: "textarea" },
    ],
  };
  return <ResourcePage cfg={cfg} />;
}

export function SuppliersPage() {
  const can = useCan();
  const cfg: ResourceConfig = {
    key: "suppliers",
    titleKey: "nav.suppliers",
    api: res.suppliers as any,
    canWrite: can("suppliers.manage"),
    filterField: {
      name: "type",
      label: "f.type",
      options: [
        { value: "supplier", label: "f.supplier" },
        { value: "subcontractor", label: "f.subcontractor" },
      ],
    },
    columns: [
      col("code", h("f.code"), (d) => ltr(d.code), "code"),
      col(
        "name",
        h("f.name"),
        (d) => <span className="font-medium">{d.name}</span>,
        "name",
      ),
      col("type", h("f.type"), (d) => <TypeLabel v={d.type} />),
      col("lead", h("f.leadTimeDays"), (d) => d.leadTimeDays ?? "—"),
      { ...activeCol, header: h("common.status") },
    ],
    fields: [
      {
        name: "type",
        label: "f.type",
        type: "select",
        required: true,
        options: [
          { value: "supplier", label: "f.supplier" },
          { value: "subcontractor", label: "f.subcontractor" },
        ],
      },
      { name: "name", label: "f.name", type: "text", required: true },
      {
        name: "code",
        label: "f.code",
        type: "text",
        createOnly: true,
        hint: "f.codeAuto",
      },
      { name: "email", label: "f.email", type: "email" },
      { name: "phone", label: "f.phone", type: "text" },
      ...addressFields("address"),
      {
        name: "services",
        label: "f.services",
        type: "tags",
        hint: "f.tagsHint",
      },
      {
        name: "leadTimeDays",
        label: "f.leadTimeDays",
        type: "integer",
        min: 0,
      },
      {
        name: "administrative.registrationNumber",
        label: "f.registrationNumber",
        type: "text",
      },
      {
        name: "administrative.taxIdentifier",
        label: "f.taxIdentifier",
        type: "text",
      },
      { name: "notes", label: "f.notes", type: "textarea" },
    ],
  };
  return <ResourcePage cfg={cfg} />;
}
const TypeLabel = ({ v }: { v: string }) => <>{useTranslation().t(`f.${v}`)}</>;

export function CategoriesPage() {
  const can = useCan();
  const cfg: ResourceConfig = {
    key: "categories",
    titleKey: "nav.categories",
    api: res.categories as any,
    canWrite: can("catalog.manage"),
    columns: [
      col("code", h("f.code"), (d) => ltr(d.code), "code"),
      col(
        "name",
        h("f.name"),
        (d) => <span className="font-medium">{d.name}</span>,
        "name",
      ),
      col("nameAr", h("f.nameAr"), (d) => d.nameAr),
      { ...activeCol, header: h("common.status") },
    ],
    fields: [
      {
        name: "code",
        label: "f.code",
        type: "text",
        required: true,
        createOnly: true,
      },
      { name: "name", label: "f.name", type: "text", required: true },
      { name: "nameAr", label: "f.nameAr", type: "text" },
      { name: "sortOrder", label: "f.sortOrder", type: "integer" },
      { name: "description", label: "f.description", type: "textarea" },
    ],
  };
  return <ResourcePage cfg={cfg} />;
}

export function ItemsPage() {
  const can = useCan();
  const user = useAuth((s) => s.user);
  const finance = user?.role === "admin" || can("finance.view");
  const cfg: ResourceConfig = {
    key: "items",
    titleKey: "nav.catalog",
    api: res.items as any,
    canWrite: can("catalog.manage"),
    columns: [
      col("code", h("f.code"), (d) => ltr(d.code), "code"),
      col(
        "name",
        h("f.name"),
        (d) => <span className="font-medium">{d.name}</span>,
        "name",
      ),
      col("category", h("f.category"), (d) => d.categoryId?.name),
      col("unit", h("f.unit"), (d) => d.unit),
      ...(finance
        ? [col("cost", h("f.purchaseCost"), (d) => money(d.purchaseCostMinor))]
        : []),
      col("price", h("f.sellingPrice"), (d) => money(d.sellingPriceMinor)),
      { ...activeCol, header: h("common.status") },
    ],
    fields: [
      { name: "name", label: "f.name", type: "text", required: true },
      { name: "nameAr", label: "f.nameAr", type: "text" },
      {
        name: "categoryId",
        label: "f.category",
        type: "ref",
        required: true,
        ref: { list: (q) => res.categories.list(q), label: (d) => d.name },
      },
      {
        name: "code",
        label: "f.code",
        type: "text",
        createOnly: true,
        hint: "f.codeAuto",
      },
      { name: "unit", label: "f.unit", type: "text" },
      {
        name: "purchaseCostMinor",
        label: "f.purchaseCost",
        type: "money",
        min: 0,
      },
      {
        name: "sellingPriceMinor",
        label: "f.sellingPrice",
        type: "money",
        min: 0,
      },
      { name: "description", label: "f.description", type: "textarea" },
    ],
  };
  return <ResourcePage cfg={cfg} />;
}

export function MachinesPage() {
  const can = useCan();
  const num = (name: string, label: string): FieldDef => ({
    name,
    label,
    type: "number",
    min: 0,
  });
  const cfg: ResourceConfig = {
    key: "machines",
    titleKey: "nav.machines",
    api: res.machines as any,
    canWrite: can("machines.manage"),
    columns: [
      col("code", h("f.code"), (d) => ltr(d.code), "code"),
      col(
        "name",
        h("f.name"),
        (d) => <span className="font-medium">{d.name}</span>,
        "name",
      ),
      col("width", h("f.printWidthMm"), (d) => d.printWidthMm ?? "—"),
      col("colors", h("f.maxColors"), (d) => d.maxColors ?? "—"),
      col("lpi", h("f.defaultLpi"), (d) => d.defaultLpi ?? "—"),
      { ...activeCol, header: h("common.status") },
    ],
    fields: [
      { name: "name", label: "f.name", type: "text", required: true },
      {
        name: "code",
        label: "f.code",
        type: "text",
        required: true,
        createOnly: true,
      },
      num("printWidthMm", "f.printWidthMm"),
      {
        name: "maxColors",
        label: "f.maxColors",
        type: "integer",
        min: 1,
        max: 20,
      },
      num("thicknessMm", "f.thicknessMm"),
      num("distortionFactor", "f.distortionFactor"),
      num("defaultLpi", "f.defaultLpi"),
      { name: "plateType", label: "f.plateType", type: "text" },
      num("repeatMinMm", "f.repeatMinMm"),
      num("repeatMaxMm", "f.repeatMaxMm"),
      num("cylinderCircumferenceMm", "f.cylinderCircumferenceMm"),
      {
        name: "clientId",
        label: "nav.clients",
        type: "ref",
        ref: { list: (q) => res.clients.list(q), label: (d) => d.legalName },
        hint: "f.optionalAssociation",
      },
      {
        name: "printerId",
        label: "nav.printers",
        type: "ref",
        ref: { list: (q) => res.printers.list(q), label: (d) => d.name },
        hint: "f.optionalAssociation",
      },
      { name: "notes", label: "f.notes", type: "textarea" },
    ],
  };
  return <ResourcePage cfg={cfg} />;
}

const OPTION_GROUPS = [
  "plateType",
  "displacementType",
  "material",
  "nonConformityType",
  "expenseCategory",
];
export function OptionsPage() {
  const can = useCan();
  const opts = OPTION_GROUPS.map((g) => ({
    value: g,
    label: `optionGroup.${g}`,
  }));
  const cfg: ResourceConfig = {
    key: "options",
    titleKey: "nav.technicalOptions",
    api: res.options as any,
    canWrite: can("machines.manage") || can("catalog.manage"),
    filterField: { name: "group", label: "f.group", options: opts },
    columns: [
      col("group", h("f.group"), (d) => <GroupLabel v={d.group} />),
      col("code", h("f.code"), (d) => ltr(d.code)),
      col("label", h("f.label"), (d) => d.label),
      col("labelAr", h("f.labelAr"), (d) => d.labelAr),
      { ...activeCol, header: h("common.status") },
    ],
    fields: [
      {
        name: "group",
        label: "f.group",
        type: "select",
        required: true,
        options: opts,
        createOnly: true,
      },
      {
        name: "code",
        label: "f.code",
        type: "text",
        required: true,
        createOnly: true,
      },
      { name: "label", label: "f.label", type: "text", required: true },
      { name: "labelAr", label: "f.labelAr", type: "text" },
      { name: "sortOrder", label: "f.sortOrder", type: "integer" },
    ],
  };
  return <ResourcePage cfg={cfg} />;
}
const GroupLabel = ({ v }: { v: string }) => (
  <>{useTranslation().t(`optionGroup.${v}`)}</>
);

function PantoneImport({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const colors = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [code, name, hex] = l.split(",").map((s) => s.trim());
        return {
          code,
          ...(name ? { name } : {}),
          ...(hex && /^#[0-9a-f]{6}$/i.test(hex) ? { hex } : {}),
        };
      });
    setBusy(true);
    try {
      await http.post("/pantone/bulk", { colors });
      toast("success", t("pantone.imported", { count: colors.length }));
      void qc.invalidateQueries({ queryKey: ["pantone"] });
      onClose();
    } catch (e) {
      toast("error", errorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t("pantone.import")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} disabled={!text.trim()} onClick={submit}>
            {t("pantone.import")}
          </Button>
        </>
      }
    >
      <Field label={t("pantone.importHint")}>
        <Textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            "PANTONE 185 C, Red, #E4002B\nPANTONE 286 C, Blue, #0033A0"
          }
          className="ltr-text font-mono"
        />
      </Field>
    </Modal>
  );
}

export function PantonePage() {
  const can = useCan();
  const { t } = useTranslation();
  const [imp, setImp] = useState(false);
  const cfg: ResourceConfig = {
    key: "pantone",
    titleKey: "nav.pantone",
    api: res.pantone as any,
    canWrite: can("catalog.manage"),
    columns: [
      col("code", h("f.code"), (d) => ltr(d.code), "code"),
      col("name", h("f.name"), (d) => d.name),
      col("hex", h("f.hex"), (d) =>
        d.hex ? (
          <span className="flex items-center gap-2">
            <span
              className="size-4 rounded border"
              style={{ background: d.hex }}
            />
            {ltr(d.hex)}
          </span>
        ) : (
          "—"
        ),
      ),
      { ...activeCol, header: h("common.status") },
    ],
    fields: [
      {
        name: "code",
        label: "f.code",
        type: "text",
        required: true,
        createOnly: true,
      },
      { name: "name", label: "f.name", type: "text" },
      { name: "hex", label: "f.hex", type: "text", hint: "f.hexHint" },
    ],
  };
  return (
    <>
      {can("catalog.manage") && (
        <div className="mb-3 flex justify-end">
          <Button variant="outline" onClick={() => setImp(true)}>
            <Upload className="size-4" /> {t("pantone.import")}
          </Button>
        </div>
      )}
      <ResourcePage cfg={cfg} />
      {imp && <PantoneImport onClose={() => setImp(false)} />}
    </>
  );
}

export function ExpensesPage() {
  const can = useCan();
  const cfg: ResourceConfig = {
    key: "expenses",
    titleKey: "nav.expenses",
    api: { ...(res.expenses as any), restore: undefined },
    canWrite: can("finance.manage"),
    columns: [
      col("number", h("f.number"), (d) => ltr(d.number)),
      col("date", h("f.date"), (d) => fmtDate(d.date), "date"),
      col("category", h("f.category"), (d) => d.category, "category"),
      col("payee", h("f.payee"), (d) => d.payee),
      col(
        "amount",
        h("f.amount"),
        (d) => <span className="font-medium">{money(d.amountMinor)}</span>,
        "amountMinor",
      ),
    ],
    fields: [
      { name: "category", label: "f.category", type: "text", required: true },
      {
        name: "amountMinor",
        label: "f.amount",
        type: "money",
        required: true,
        min: 0.01,
      },
      { name: "date", label: "f.date", type: "date", required: true },
      { name: "payee", label: "f.payee", type: "text" },
      {
        name: "supplierId",
        label: "nav.suppliers",
        type: "ref",
        ref: { list: (q) => res.suppliers.list(q), label: (d) => d.name },
      },
      {
        name: "orderId",
        label: "f.order",
        type: "ref",
        ref: {
          list: (q) => orders.list(q) as any,
          label: (d) => `${d.jobCode} — ${d.jobName}`,
        },
      },
      { name: "notes", label: "f.notes", type: "textarea" },
    ],
  };
  return <ResourcePage cfg={cfg} />;
}

// ---- Managers & permissions (Admin only) ----
export function ManagersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState<Doc | "new" | null>(null);
  const [perms, setPerms] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<Doc | null>(null);
  const [reset, setReset] = useState<Doc | null>(null);
  const [pw, setPw] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["managers"] });
  const open = (d: Doc | "new") => {
    setEditing(d);
    setPerms(
      d === "new"
        ? ["orders.view", "orders.create", "clients.view", "printers.view"]
        : d.permissions,
    );
  };
  const fields: FieldDef[] = [
    { name: "name", label: "f.name", type: "text", required: true },
    { name: "phone", label: "f.phone", type: "text" },
    {
      name: "email",
      label: "f.email",
      type: "email",
      required: true,
      createOnly: true,
    },
    {
      name: "password",
      label: "accounts.password",
      type: "password",
      required: true,
      createOnly: true,
      hint: "accounts.passwordHint",
    },
  ];
  const cols: Column<Doc>[] = [
    col(
      "name",
      h("f.name"),
      (d) => <span className="font-medium">{d.name}</span>,
      "name",
    ),
    col("email", h("f.email"), (d) => ltr(d.email)),
    col("perms", h("managers.permissions"), (d) => (
      <span className="text-xs text-slate-500">
        {d.permissions.length} / {PERMISSIONS.length}
      </span>
    )),
    col("last", h("f.lastLogin"), (d) => fmtDate(d.lastLoginAt, true)),
    { ...activeCol, header: h("common.status") },
    col(
      "actions",
      <span className="sr-only">{t("common.actions")}</span>,
      (d) => (
        <div
          className="flex justify-end gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Button size="sm" variant="outline" onClick={() => open(d)}>
            {t("common.edit")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setReset(d)}>
            {t("accounts.resetPassword")}
          </Button>
          <Button
            size="sm"
            variant={d.isActive ? "danger" : "outline"}
            onClick={() => setConfirm(d)}
          >
            {d.isActive ? t("common.deactivate") : t("common.activate")}
          </Button>
        </div>
      ),
    ),
  ];
  return (
    <>
      <PageHeader
        title={t("nav.managers")}
        subtitle={t("managers.subtitle")}
        actions={<Button onClick={() => open("new")}>{t("common.add")}</Button>}
      />
      <DataTable
        queryKey={["managers"]}
        fetcher={(q) => managers.list(q)}
        columns={cols}
      />
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? t("common.add") : t("common.edit")}
        wide
      >
        {editing && (
          <div className="space-y-5">
            <ResourceForm
              fields={fields}
              initial={editing === "new" ? null : editing}
              onCancel={() => setEditing(null)}
              onSubmit={async (p) => {
                if (editing === "new")
                  await managers.create({ ...p, permissions: perms });
                else
                  await managers.update(editing.id, {
                    name: p.name,
                    phone: p.phone,
                    permissions: perms,
                  });
                toast("success", t("common.saved"));
                setEditing(null);
                void refresh();
              }}
            />
            <fieldset className="rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-sm font-semibold">
                {t("managers.permissions")}
              </legend>
              <p className="mb-2 text-xs text-slate-500">
                {t("managers.permissionsHint")}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {PERMISSIONS.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={perms.includes(p)}
                      onChange={(e) =>
                        setPerms((cur) =>
                          e.target.checked
                            ? [...cur, p]
                            : cur.filter((x) => x !== p),
                        )
                      }
                    />{" "}
                    {t(`perm.${p.replace('.', '_')}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={!!confirm}
        danger={!!confirm?.isActive}
        title={
          confirm?.isActive ? t("common.deactivate") : t("common.activate")
        }
        message={
          confirm?.isActive ? t("managers.deactivateConfirm") : undefined
        }
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          (confirm!.isActive
            ? managers.deactivate(confirm!.id)
            : managers.activate(confirm!.id)
          )
            .then(() => {
              toast("success", t("common.saved"));
              setConfirm(null);
              void refresh();
            })
            .catch((e) => toast("error", errorText(e, t)))
        }
      />
      <ConfirmDialog
        open={!!reset}
        title={t("accounts.resetPassword")}
        onClose={() => {
          setReset(null);
          setPw("");
        }}
        onConfirm={() =>
          managers
            .resetPassword(reset!.id, pw)
            .then(() => {
              toast("success", t("common.saved"));
              setReset(null);
              setPw("");
            })
            .catch((e) => toast("error", errorText(e, t)))
        }
      >
        <Field
          label={t("accounts.newPassword")}
          hint={t("accounts.passwordHint")}
        >
          <input
            type="password"
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
      </ConfirmDialog>
    </>
  );
}
