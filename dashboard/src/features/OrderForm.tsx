import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  Textarea,
  errorText,
} from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import {
  ColorPicker,
  ClientPicker,
  type PantoneChoice,
} from "@/features/Pickers";
import { FileList } from "@/features/FileList";
import { Uploader, useSettings } from "@/features/Uploader";
import { orders, res } from "@/services/api";
import { ApiError } from "@/services/http";
import { ARABIC_RE, newKey, toDateInput, } from "@/lib/utils";
import { isStaff, useAuth, useCan, useUi } from "@/stores";
import { MATERIALS, type BaseColor, type FileAsset, type Order } from "@/types";
import { StatusBadge } from "@/components/ui";

const numStr = (msg: string) =>
  z
    .string()
    .refine(
      (v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0),
      msg,
    );
const ADV = [
  "leftMark",
  "leftPath",
  "rightMark",
  "rightPath",
  "barcodeNumber",
  "printMaterialSizeMm",
  "lineRepeat",
  "cylinder",
  "cylinderRepeat",
  "lineWidthMm",
  "rowHeightMm",
  "printWidthMm",
  "plateHeightMm",
  "totalCm",
  "displacementType",
  "plateType",
  "plateThicknessMm",
  "machWidth",
  "machMaxColors",
  "machDistortion",
  "machLpi",
] as const;
type AdvKey = (typeof ADV)[number];
const ADV_NUMERIC: AdvKey[] = [
  "printMaterialSizeMm",
  "lineRepeat",
  "cylinder",
  "cylinderRepeat",
  "lineWidthMm",
  "rowHeightMm",
  "printWidthMm",
  "plateHeightMm",
  "totalCm",
  "plateThicknessMm",
  "machWidth",
  "machMaxColors",
  "machDistortion",
  "machLpi",
];

function makeSchema(
  t: (k: string) => string,
  rejectArabic: boolean,
  needClient: boolean,
) {
  const num = numStr(t("validation.number"));
  return z
    .object({
      clientId: needClient
        ? z.string().min(1, t("orderForm.selectClientError"))
        : z.string().optional(),
      machineId: z.string().min(1, t("orderForm.machineRequired")),
      jobName: z
        .string()
        .trim()
        .min(1, t("validation.required"))
        .max(200)
        .refine(
          (v) => !(rejectArabic && ARABIC_RE.test(v)),
          t("orderForm.noArabic"),
        ),
      subCustomer: z.string().max(200).optional(),
      priority: z.string().optional(),
      requestedDeliveryDate: z.string().optional(),
      printDirection: z.enum(["surface", "reverse"], {
        errorMap: () => ({ message: t("orderForm.directionRequired") }),
      }),
      linesGuides: z.boolean(),
      logo: z.boolean(),
      printMaterial: z.enum(MATERIALS, {
        errorMap: () => ({ message: t("orderForm.materialRequired") }),
      }),
      laminationMaterial: z.enum(["", ...MATERIALS]).optional(),
      customerNotes: z.string().max(5000).optional(),
      internalNotes: z.string().max(5000).optional(),
      printerNotes: z.string().max(5000).optional(),
      designLink: z
        .string()
        .trim()
        .refine(
          (v) => v === "" || /^https:\/\/[^\s/$.?#].[^\s]*$/i.test(v),
          t("orderForm.linkInvalid"),
        )
        .optional(),
      barcodeEnabled: z.boolean(),
      adv: z.object(
        Object.fromEntries(
          ADV.map((k) => [
            k,
            ADV_NUMERIC.includes(k)
              ? num.optional()
              : z.string().max(200).optional(),
          ]),
        ) as unknown as Record<AdvKey, z.ZodTypeAny>,
      ),
    })
    .superRefine((v, ctx) => {
      if (v.barcodeEnabled && !v.adv.barcodeNumber)
        ctx.addIssue({
          code: "custom",
          path: ["adv", "barcodeNumber"],
          message: t("orderForm.barcodeRequired"),
        });
    });
}
type FormValues = z.infer<ReturnType<typeof makeSchema>>;

const n = (s?: string) => (s === undefined || s === "" ? undefined : Number(s));
const s = (v?: string) => (v ? v : undefined);

function toSpecs(v: FormValues, base: BaseColor[], pantone: PantoneChoice[]) {
  const a = v.adv as Record<AdvKey, string>;
  return {
    printDirection: v.printDirection,
    printOptions: { linesGuides: v.linesGuides, logo: v.logo },
    printMaterial: v.printMaterial,
    laminationMaterial: s(v.laminationMaterial),
    colors: { base, pantone: pantone.map((p) => p.code) },
    photocells: {
      left: { mark: s(a.leftMark), path: s(a.leftPath) },
      right: { mark: s(a.rightMark), path: s(a.rightPath) },
    },
    barcode: {
      enabled: v.barcodeEnabled,
      number: v.barcodeEnabled ? s(a.barcodeNumber) : undefined,
    },
    dimensions: {
      printMaterialSizeMm: n(a.printMaterialSizeMm),
      lineRepeat: n(a.lineRepeat),
      cylinder: n(a.cylinder),
      cylinderRepeat: n(a.cylinderRepeat),
      lineWidthMm: n(a.lineWidthMm),
      rowHeightMm: n(a.rowHeightMm),
      printWidthMm: n(a.printWidthMm),
      plateHeightMm: n(a.plateHeightMm),
      totalCm: n(a.totalCm),
    },
    displacementType: s(a.displacementType),
    plate: { type: s(a.plateType), thicknessMm: n(a.plateThicknessMm) },
    machineSpecifications: {
      printWidthMm: n(a.machWidth),
      maxColors: n(a.machMaxColors),
      distortion: n(a.machDistortion),
      lpi: n(a.machLpi),
    },
  };
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
function toValues(o?: Order): FormValues {
  const sp = o?.technicalSpecifications ?? {};
  return {
    clientId: o?.clientId ?? "",
    machineId: o?.machineId ?? "",
    jobName: o?.jobName ?? "",
    subCustomer: str((o as any)?.subCustomer),
    priority: o?.priority ?? "normal",
    requestedDeliveryDate: toDateInput(o?.requestedDeliveryDate),
    printDirection: sp.printDirection ?? ("" as any),
    linesGuides: sp.printOptions?.linesGuides ?? true,
    logo: sp.printOptions?.logo ?? false,
    printMaterial: sp.printMaterial ?? ("" as any),
    laminationMaterial: sp.laminationMaterial ?? "",
    customerNotes: o?.customerNotes ?? "",
    internalNotes: o?.internalNotes ?? "",
    printerNotes: o?.printerNotes ?? "",
    designLink: "",
    barcodeEnabled: !!sp.barcode?.enabled,
    adv: {
      leftMark: str(sp.photocells?.left?.mark),
      leftPath: str(sp.photocells?.left?.path),
      rightMark: str(sp.photocells?.right?.mark),
      rightPath: str(sp.photocells?.right?.path),
      barcodeNumber: str(sp.barcode?.number),
      printMaterialSizeMm: str(sp.dimensions?.printMaterialSizeMm),
      lineRepeat: str(sp.dimensions?.lineRepeat),
      cylinder: str(sp.dimensions?.cylinder),
      cylinderRepeat: str(sp.dimensions?.cylinderRepeat),
      lineWidthMm: str(sp.dimensions?.lineWidthMm),
      rowHeightMm: str(sp.dimensions?.rowHeightMm),
      printWidthMm: str(sp.dimensions?.printWidthMm),
      plateHeightMm: str(sp.dimensions?.plateHeightMm),
      totalCm: str(sp.dimensions?.totalCm),
      displacementType: str(sp.displacementType),
      plateType: str(sp.plate?.type),
      plateThicknessMm: str(sp.plate?.thicknessMm),
      machWidth: str(sp.machineSpecifications?.printWidthMm),
      machMaxColors: str(sp.machineSpecifications?.maxColors),
      machDistortion: str(sp.machineSpecifications?.distortion),
      machLpi: str(sp.machineSpecifications?.lpi),
    },
  } as FormValues;
}

const SERVER_FIELD: Record<string, string> = {
  clientId: "clientId",
  machineId: "machineId",
  jobName: "jobName",
  "technicalSpecifications.printDirection": "printDirection",
  "technicalSpecifications.printMaterial": "printMaterial",
  "technicalSpecifications.barcode.number": "adv.barcodeNumber",
  designLinks: "designLink",
};

function ReorderModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useUi((st) => st.toast);
  const [busy, setBusy] = useState<string>();
  return (
    <Modal open onClose={onClose} title={t("orderForm.reorderTitle")} wide>
      <p className="mb-3 text-sm text-slate-600">
        {t("orderForm.reorderHint")}
      </p>
      <DataTable<Order>
        queryKey={["orders", "reorder"]}
        fetcher={(q) => orders.list(q)}
        pageSize={8}
        columns={[
          {
            key: "job",
            header: t("f.jobCode"),
            render: (o) => (
              <span className="ltr-text font-medium">{o.jobCode}</span>
            ),
          },
          { key: "name", header: t("f.jobName"), render: (o) => o.jobName },
          {
            key: "st",
            header: t("common.status"),
            render: (o) => <StatusBadge status={o.status} />,
          },
          {
            key: "act",
            header: "",
            render: (o) => (
              <Button
                size="sm"
                loading={busy === o.id}
                onClick={async () => {
                  setBusy(o.id);
                  try {
                    const r = await orders.reorder(o.id, newKey());
                    toast("success", t("orderForm.reordered"));
                    nav(`/orders/${r.id}`);
                  } catch (e) {
                    toast("error", errorText(e, t));
                  } finally {
                    setBusy(undefined);
                  }
                }}
              >
                {t("orderForm.useAsTemplate")}
              </Button>
            ),
          },
        ]}
      />
    </Modal>
  );
}

const radio = "flex items-center gap-1.5 text-sm";

export default function OrderForm({ order }: { order?: Order }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useUi((st) => st.toast);
  const user = useAuth((st) => st.user)!;
  const can = useCan();
  const rules = useSettings().data;
  const editing = !!order;
  const staff = isStaff(user);
  const needClient = staff && !editing;
  const key = useRef(newKey());
  const [showReorder, setShowReorder] = useState(false);
  const [uploaded, setUploaded] = useState<FileAsset[]>([]);
  const [advOpen, setAdvOpen] = useState(false);
  const [bannerError, setBannerError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const initialPantone: PantoneChoice[] = (
    order?.technicalSpecifications?.colors?.pantone ?? []
  ).map((p: any) => ({ code: p.code, name: p.name, hex: p.hex }));
  const [base, setBase] = useState<BaseColor[]>(
    order?.technicalSpecifications?.colors?.base ?? [],
  );
  const [pantone, setPantone] = useState<PantoneChoice[]>(initialPantone);
  const [clientLabel, setClientLabel] = useState(
    order?.client?.legalName ?? "",
  );

  const schema = useMemo(
    () => makeSchema(t as any, rules?.jobNameRejectArabic ?? true, needClient),
    [t, rules?.jobNameRejectArabic, needClient],
  );
  const f = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toValues(order),
  });
  const err = f.formState.errors;

  const myClient = useQuery({
    queryKey: ["my-client"],
    queryFn: () => res.clients.list({ limit: 1 }),
    enabled: user.role === "client",
  });
  const machines = useQuery({
    queryKey: ["machines", "form"],
    queryFn: () => res.machines.list({ limit: 100, isActive: "true" }),
  });
  const plateTypes = useQuery({
    queryKey: ["options", "plateType"],
    queryFn: () => res.options.list({ group: "plateType", limit: 100 }),
  });
  const displacement = useQuery({
    queryKey: ["options", "displacementType"],
    queryFn: () => res.options.list({ group: "displacementType", limit: 100 }),
  });
  const clientLocked = user.role === "client";
  const fileTargetClient = clientLocked
    ? undefined
    : f.watch("clientId") || order?.clientId;

  const onMachine = (id: string) => {
    const m = machines.data?.items.find((x) => x.id === id);
    if (!m) return;
    const set = (k: AdvKey, v: unknown) =>
      !f.getValues(`adv.${k}` as any) &&
      v != null &&
      f.setValue(`adv.${k}` as any, String(v));
    set("machWidth", m.printWidthMm);
    set("machMaxColors", m.maxColors);
    set("machDistortion", m.distortionFactor);
    set("machLpi", m.defaultLpi);
    set("plateType", m.plateType);
  };

  const submit = (asDraft: boolean) =>
    f.handleSubmit(
      async (v) => {
        setBannerError(undefined);
        setSubmitting(true);
        const specs = toSpecs(v, base, pantone);
        const links = [
          ...(order?.designLinks ?? []).map((l) => ({
            url: l.url,
            label: l.label,
          })),
          ...(v.designLink ? [{ url: v.designLink }] : []),
        ];
        try {
          if (editing) {
            const body: Record<string, unknown> = {
              machineId: v.machineId,
              jobName: v.jobName,
              subCustomer: v.subCustomer || undefined,
              requestedDeliveryDate: v.requestedDeliveryDate
                ? new Date(v.requestedDeliveryDate).toISOString()
                : null,
              customerNotes: v.customerNotes ?? "",
              technicalSpecifications: specs,
              designLinks: links,
            };
            if (!body.subCustomer) delete body.subCustomer;
            if (staff)
              Object.assign(body, {
                priority: v.priority,
                internalNotes: v.internalNotes ?? "",
                printerNotes: v.printerNotes ?? "",
              });
            const o = await orders.update(order!.id, body);
            toast("success", t("common.saved"));
            void qc.invalidateQueries({ queryKey: ["orders"] });
            nav(`/orders/${o.id}`);
          } else {
            const o = await orders.create(
              {
                ...(needClient ? { clientId: v.clientId } : {}),
                machineId: v.machineId,
                jobName: v.jobName,
                subCustomer: v.subCustomer || undefined,
                priority: staff ? v.priority : undefined,
                requestedDeliveryDate: v.requestedDeliveryDate
                  ? new Date(v.requestedDeliveryDate).toISOString()
                  : undefined,
                customerNotes: v.customerNotes || undefined,
                ...(staff
                  ? {
                      internalNotes: v.internalNotes || undefined,
                      printerNotes: v.printerNotes || undefined,
                    }
                  : {}),
                technicalSpecifications: specs,
                designLinks: links.map((l) => l.url),
                fileAssetIds: uploaded.map((u) => u.id),
                submit: !asDraft,
              },
              key.current,
            );
            toast("success", t("orderForm.created", { code: o.jobCode }));
            void qc.invalidateQueries({ queryKey: ["orders"] });
            nav(`/orders/${o.id}`);
          }
        } catch (e) {
          if (e instanceof ApiError && e.details?.length) {
            const rest: string[] = [];
            for (const d of e.details) {
              const target =
                SERVER_FIELD[d.field] ??
                SERVER_FIELD[d.field.replace(/^body\./, "")];
              if (target) f.setError(target as any, { message: d.message });
              else rest.push(d.message);
            }
            setBannerError(rest.length ? rest.join(" · ") : e.message);
          } else setBannerError(errorText(e, t));
        } finally {
          setSubmitting(false);
        }
      },
      () => setBannerError(t("orderForm.fixErrors")),
    );

  if (user.role === "client" && myClient.isLoading) return <Loading />;
  if (machines.isError)
    return (
      <ErrorState error={machines.error} onRetry={() => machines.refetch()} />
    );

  const adv = (k: AdvKey, label: string, numeric = true) => (
    <Field
      label={t(label)}
      htmlFor={`adv-${k}`}
      error={(err.adv as any)?.[k]?.message}
    >
      <Input
        id={`adv-${k}`}
        type={numeric ? "number" : "text"}
        step="any"
        min={numeric ? 0 : undefined}
        {...f.register(`adv.${k}` as any)}
      />
    </Field>
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false)();
      }}
    >
      <PageHeader
        title={
          editing
            ? t("orderForm.editTitle", { code: order!.jobCode })
            : t("orderForm.title")
        }
        actions={
          !editing &&
          (user.role === "client" || can("orders.create")) && (
            <Button variant="primary" onClick={() => setShowReorder(true)}>
              <Copy className="size-4" /> {t("orderForm.reorder")}
            </Button>
          )
        }
      />
      <div className="mx-auto max-w-4xl space-y-5">
        <Card>
          <CardHeader title={t("orderForm.sectionMain")} />
          <div className="space-y-5 p-4">
            <Field
              label={t("orderForm.client")}
              htmlFor="client-search"
              required
              error={err.clientId?.message}
            >
              {clientLocked ? (
                <ClientPicker
                  value={myClient.data?.items[0]?.id ?? ""}
                  label={myClient.data?.items[0]?.legalName ?? ""}
                  onChange={() => undefined}
                  locked
                />
              ) : editing ? (
                <Input
                  id="client-search"
                  value={order?.client?.legalName ?? ""}
                  readOnly
                  disabled
                />
              ) : (
                <Controller
                  control={f.control}
                  name="clientId"
                  render={({ field }) => (
                    <ClientPicker
                      value={field.value ?? ""}
                      label={clientLabel}
                      error={err.clientId?.message}
                      onChange={(id, label) => {
                        field.onChange(id);
                        setClientLabel(label);
                      }}
                    />
                  )}
                />
              )}
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={t("orderForm.machine")}
                htmlFor="machineId"
                required
                error={err.machineId?.message}
              >
                <Select
                  id="machineId"
                  aria-invalid={!!err.machineId}
                  {...f.register("machineId", {
                    onChange: (e) => onMachine(e.target.value),
                  })}
                >
                  <option value="">{t("orderForm.selectMachine")}</option>
                  {machines.data?.items.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.code})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t("orderForm.jobName")}
                htmlFor="jobName"
                required
                error={err.jobName?.message}
                hint={
                  rules?.jobNameRejectArabic
                    ? t("orderForm.noArabic")
                    : undefined
                }
              >
                <Input
                  id="jobName"
                  aria-invalid={!!err.jobName}
                  placeholder={t("orderForm.jobNamePlaceholder")}
                  {...f.register("jobName")}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <fieldset className="rounded-md bg-slate-50 p-3">
                <legend className="px-1 text-sm font-medium text-slate-700">
                  {t("orderForm.printDirection")} *
                </legend>
                <div className="flex gap-5">
                  {(["surface", "reverse"] as const).map((d) => (
                    <label key={d} className={radio}>
                      <input
                        type="radio"
                        value={d}
                        {...f.register("printDirection")}
                      />{" "}
                      {t(`orderForm.dir.${d}`)}
                    </label>
                  ))}
                </div>
                {err.printDirection && (
                  <p role="alert" className="mt-1 text-xs text-red-600">
                    {err.printDirection.message}
                  </p>
                )}
              </fieldset>
              <fieldset className="rounded-md bg-slate-50 p-3">
                <legend className="px-1 text-sm font-medium text-slate-700">
                  {t("orderForm.printOptions")}
                </legend>
                <div className="flex gap-5">
                  <label className={radio}>
                    <input type="checkbox" {...f.register("linesGuides")} />{" "}
                    {t("orderForm.linesGuides")}
                  </label>
                  <label className={radio}>
                    <input type="checkbox" {...f.register("logo")} />{" "}
                    {t("orderForm.logo")}
                  </label>
                </div>
              </fieldset>
              {(["printMaterial", "laminationMaterial"] as const).map((k) => (
                <fieldset key={k} className="rounded-md bg-slate-50 p-3">
                  <legend className="px-1 text-sm font-medium text-slate-700">
                    {t(`orderForm.${k}`)}
                    {k === "printMaterial" && " *"}
                  </legend>
                  <div className="flex flex-wrap gap-4">
                    {MATERIALS.map((m) => (
                      <label key={m} className={radio}>
                        <input type="radio" value={m} {...f.register(k)} />{" "}
                        {t(`material.${m}`)}
                      </label>
                    ))}
                  </div>
                  {err[k] && (
                    <p role="alert" className="mt-1 text-xs text-red-600">
                      {err[k]!.message as string}
                    </p>
                  )}
                </fieldset>
              ))}
            </div>

            <ColorPicker
              base={base}
              pantone={pantone}
              onBase={setBase}
              onPantone={setPantone}
              includePantone={!!rules?.colorCountIncludesPantone}
            />

            <Field
              label={t("orderForm.customerNotes")}
              htmlFor="customerNotes"
              error={err.customerNotes?.message}
            >
              <Textarea
                id="customerNotes"
                rows={4}
                placeholder={t("orderForm.notesPlaceholder")}
                {...f.register("customerNotes")}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={t("orderForm.requestedDelivery")}
                htmlFor="requestedDeliveryDate"
              >
                <Input
                  id="requestedDeliveryDate"
                  type="date"
                  {...f.register("requestedDeliveryDate")}
                />
              </Field>
              <Field label={t("orderForm.subCustomer")} htmlFor="subCustomer">
                <Input id="subCustomer" {...f.register("subCustomer")} />
              </Field>
            </div>

            <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium text-slate-700">
                {t("orderForm.attachment")}
              </legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Uploader
                    target={{
                      clientId: fileTargetClient || undefined,
                      orderId: order?.id,
                      category: "design",
                    }}
                    disabled={needClient && !f.watch("clientId")}
                    disabledReason={t("orderForm.selectClientFirst")}
                    onUploaded={(file) => {
                      setUploaded((x) => [...x, file]);
                      void qc.invalidateQueries({ queryKey: ["order-files"] });
                    }}
                  />
                  {uploaded.length > 0 && (
                    <p className="mt-2 text-xs text-emerald-700">
                      {t("orderForm.filesReady", { count: uploaded.length })}
                    </p>
                  )}
                </div>
                <Field
                  label={t("orderForm.designLink")}
                  htmlFor="designLink"
                  error={err.designLink?.message}
                  hint={t("orderForm.designLinkHint")}
                >
                  <Input
                    id="designLink"
                    type="url"
                    inputMode="url"
                    className="ltr-text"
                    placeholder="https://…"
                    aria-invalid={!!err.designLink}
                    {...f.register("designLink")}
                  />
                </Field>
              </div>
              {editing && <FileList files={[]} links={order!.designLinks} />}
            </fieldset>

            {staff && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t("f.priority")} htmlFor="priority">
                  <Select id="priority" {...f.register("priority")}>
                    {["low", "normal", "high", "urgent"].map((p) => (
                      <option key={p} value={p}>
                        {t(`priority.${p}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <span />
                <Field
                  label={t("f.internalNotes")}
                  htmlFor="internalNotes"
                  hint={t("orderForm.internalHint")}
                >
                  <Textarea
                    id="internalNotes"
                    {...f.register("internalNotes")}
                  />
                </Field>
                <Field
                  label={t("f.printerNotes")}
                  htmlFor="printerNotes"
                  hint={t("orderForm.printerHint")}
                >
                  <Textarea id="printerNotes" {...f.register("printerNotes")} />
                </Field>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-start"
            aria-expanded={advOpen}
            onClick={() => setAdvOpen((o) => !o)}
          >
            <span className="text-sm font-semibold text-slate-800">
              {t("orderForm.sectionAdvanced")}
            </span>
            <ChevronDown
              className={`size-4 transition-transform ${advOpen ? "rotate-180" : ""}`}
            />
          </button>
          {advOpen && (
            <div className="space-y-5 border-t border-slate-100 p-4">
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  {t("orderForm.photocells")}
                </h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {adv("leftMark", "orderForm.leftMark", false)}
                  {adv("leftPath", "orderForm.leftPath", false)}
                  {adv("rightMark", "orderForm.rightMark", false)}
                  {adv("rightPath", "orderForm.rightPath", false)}
                </div>
              </div>
              <div>
                <label className={radio}>
                  <input type="checkbox" {...f.register("barcodeEnabled")} />{" "}
                  {t("orderForm.barcode")}
                </label>
                {f.watch("barcodeEnabled") && (
                  <div className="mt-2 max-w-xs">
                    {adv("barcodeNumber", "orderForm.barcodeNumber", false)}
                  </div>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  {t("orderForm.dimensions")}
                </h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {adv("printMaterialSizeMm", "orderForm.printMaterialSize")}
                  {adv("lineRepeat", "orderForm.lineRepeat")}
                  {adv("cylinder", "orderForm.cylinder")}
                  {adv("cylinderRepeat", "orderForm.cylinderRepeat")}
                  {adv("lineWidthMm", "orderForm.lineWidth")}
                  {adv("rowHeightMm", "orderForm.rowHeight")}
                  {adv("printWidthMm", "orderForm.printWidth")}
                  {adv("plateHeightMm", "orderForm.plateHeight")}
                  {adv("totalCm", "orderForm.totalCm")}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field
                  label={t("orderForm.displacementType")}
                  htmlFor="adv-displacementType"
                >
                  <Input
                    id="adv-displacementType"
                    list="displacement-list"
                    {...f.register("adv.displacementType" as any)}
                  />
                  <datalist id="displacement-list">
                    {displacement.data?.items.map((o) => (
                      <option key={o.id} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </datalist>
                </Field>
                <Field label={t("f.plateType")} htmlFor="adv-plateType">
                  <Input
                    id="adv-plateType"
                    list="plate-type-list"
                    {...f.register("adv.plateType" as any)}
                  />
                  <datalist id="plate-type-list">
                    {plateTypes.data?.items.map((o) => (
                      <option key={o.id} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </datalist>
                </Field>
                {adv("plateThicknessMm", "orderForm.plateThickness")}
              </div>
              <div>
                <h3 className="mb-1 text-sm font-medium">
                  {t("orderForm.machineSpecs")}
                </h3>
                <p className="mb-2 text-xs text-slate-500">
                  {t("orderForm.machineSpecsHint")}
                </p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {adv("machWidth", "orderForm.machWidth")}
                  {adv("machMaxColors", "orderForm.machMaxColors")}
                  {adv("machDistortion", "orderForm.distortion")}
                  {adv("machLpi", "orderForm.lpi")}
                </div>
              </div>
            </div>
          )}
        </Card>

        {bannerError && (
          <p
            role="alert"
            className="rounded-md bg-red-50 p-3 text-sm text-red-700"
          >
            {bannerError}
          </p>
        )}
        {needClient && err.clientId && (
          <p role="alert" className="text-center text-sm text-red-600">
            {err.clientId.message}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => nav(-1)}>
            {t("common.cancel")}
          </Button>
          {!editing && (
            <Button
              variant="secondary"
              loading={submitting}
              onClick={() => void submit(true)()}
            >
              {t("orderForm.saveDraft")}
            </Button>
          )}
          <Button type="submit" loading={submitting} className="min-w-40">
            {editing ? t("common.save") : t("orderForm.submit")}
          </Button>
        </div>
      </div>
      {showReorder && <ReorderModal onClose={() => setShowReorder(false)} />}
    </form>
  );
}
