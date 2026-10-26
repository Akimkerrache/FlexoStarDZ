import { useEffect, useState } from "react";
import { useForm, type FieldValues, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z, type ZodTypeAny } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { ApiError } from "@/services/http";
import { fromMinor, toDateInput, toMinor } from "@/lib/utils";
import type { Doc, Paged } from "@/types";

export interface FieldDef {
  name: string; // dot paths allowed: "address.city"
  label: string; // i18n key
  type:
    | "text"
    | "email"
    | "password"
    | "number"
    | "integer"
    | "money"
    | "textarea"
    | "select"
    | "checkbox"
    | "date"
    | "ref"
    | "tags";
  required?: boolean;
  options?: { value: string; label: string }[]; // label is an i18n key
  ref?: {
    list: (q: Record<string, any>) => Promise<Paged<Doc>>;
    label: (d: Doc) => string;
    filter?: Record<string, any>;
  };
  hint?: string;
  wide?: boolean;
  createOnly?: boolean;
  editOnly?: boolean;
  min?: number;
  max?: number;
}

const getPath = (o: any, p: string) =>
  p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o: any, p: string, v: unknown) => {
  const ks = p.split(".");
  let cur = o;
  ks.slice(0, -1).forEach((k) => (cur = cur[k] ??= {}));
  cur[ks[ks.length - 1]] = v;
};

function leaf(f: FieldDef, msg: (k: string, o?: any) => string): ZodTypeAny {
  const req = msg("validation.required");
  if (f.type === "checkbox") return z.boolean().optional();
  let s: ZodTypeAny = z.string();
  if (f.type === "email")
    s = z
      .string()
      .trim()
      .refine(
        (v) => v === "" || /^\S+@\S+\.\S+$/.test(v),
        msg("validation.email"),
      );
  if (f.type === "password")
    s = z
      .string()
      .refine((v) => v === "" || v.length >= 10, msg("validation.password"));
  if (["number", "integer", "money"].includes(f.type)) {
    s = z
      .string()
      .refine(
        (v) =>
          v === "" ||
          (!Number.isNaN(Number(v)) &&
            (f.type !== "integer" || Number.isInteger(Number(v))) &&
            (f.min === undefined || Number(v) >= f.min) &&
            (f.max === undefined || Number(v) <= f.max)),
        msg("validation.number"),
      );
  }
  return f.required ? z.string().min(1, req).and(s) : s.optional();
}

function buildSchema(fields: FieldDef[], msg: (k: string, o?: any) => string) {
  const tree: any = {};
  for (const f of fields) {
    const ks = f.name.split(".");
    let cur = tree;
    ks.slice(0, -1).forEach((k) => (cur = cur[k] ??= {}));
    cur[ks[ks.length - 1]] = leaf(f, msg);
  }
  const conv = (n: any): ZodTypeAny =>
    n instanceof z.ZodType
      ? n
      : z
          .object(
            Object.fromEntries(Object.entries(n).map(([k, v]) => [k, conv(v)])),
          )
          .optional();
  return conv(tree) as z.ZodObject<any>;
}

export function toFormValues(fields: FieldDef[], doc?: Doc | null) {
  const out: any = {};
  for (const f of fields) {
    const raw = doc ? getPath(doc, f.name) : undefined;
    let v: unknown;
    if (f.type === "checkbox") v = raw ?? false;
    else if (f.type === "money") v = fromMinor(raw);
    else if (f.type === "date") v = toDateInput(raw);
    else if (f.type === "tags") v = Array.isArray(raw) ? raw.join(", ") : "";
    else if (f.type === "ref")
      v = raw && typeof raw === "object" ? raw.id : (raw ?? "");
    else v = raw == null ? "" : String(raw);
    setPath(out, f.name, v);
  }
  return out;
}

export function toPayload(fields: FieldDef[], values: any) {
  const out: any = {};
  for (const f of fields) {
    const v = getPath(values, f.name);
    if (f.type === "checkbox") setPath(out, f.name, !!v);
    else if (v === "" || v == null) continue;
    else if (f.type === "money") setPath(out, f.name, toMinor(v));
    else if (f.type === "number" || f.type === "integer")
      setPath(out, f.name, Number(v));
    else if (f.type === "tags")
      setPath(
        out,
        f.name,
        String(v)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    else if (f.type === "date")
      setPath(out, f.name, new Date(v + "T00:00:00.000Z").toISOString());
    else setPath(out, f.name, v);
  }
  return out;
}

function RefSelect({
  f,
  reg,
  error,
  id,
}: {
  f: FieldDef;
  reg: any;
  error?: string;
  id: string;
}) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["ref", f.name, f.ref!.filter],
    queryFn: () => f.ref!.list({ limit: 100, ...(f.ref!.filter ?? {}) }),
    staleTime: 60_000,
  });
  return (
    <Select id={id} aria-invalid={!!error} {...reg}>
      <option value="">{t("common.select")}</option>
      {q.data?.items.map((d) => (
        <option key={d.id} value={d.id}>
          {f.ref!.label(d)}
        </option>
      ))}
    </Select>
  );
}

interface Props {
  fields: FieldDef[];
  initial?: Doc | null;
  onSubmit: (payload: any) => Promise<unknown>;
  onCancel: () => void;
  submitLabel?: string;
}

/** Definition-driven form: Zod validation on the client, server field errors mapped back onto inputs. */
export function ResourceForm({
  fields: all,
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: Props) {
  const { t } = useTranslation();
  const editing = !!initial;
  const fields = all.filter((f) => (editing ? !f.createOnly : !f.editOnly));
  const form = useForm<FieldValues>({
    defaultValues: toFormValues(fields, initial),
    resolver: zodResolver(buildSchema(fields, t as any)),
  });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string>();
  useEffect(() => form.reset(toFormValues(fields, initial)), [initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit(async (values) => {
    setBusy(true);
    setFormError(undefined);
    try {
      await onSubmit(toPayload(fields, values));
    } catch (e) {
      if (e instanceof ApiError && e.details?.length) {
        for (const d of e.details)
          form.setError(d.field as Path<FieldValues>, { message: d.message });
        setFormError(e.message);
      } else
        setFormError(e instanceof ApiError ? e.message : t("errors.network"));
    } finally {
      setBusy(false);
    }
  });

  const err = (n: string) =>
    getPath(form.formState.errors, n)?.message as string | undefined;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const id = `f-${f.name}`;
          const reg = form.register(f.name);
          return (
            <Field
              key={f.name}
              htmlFor={id}
              label={f.type === "checkbox" ? undefined : t(f.label)}
              required={f.required}
              error={err(f.name)}
              hint={f.hint ? t(f.hint) : undefined}
              className={
                f.wide || f.type === "textarea" ? "sm:col-span-2" : undefined
              }
            >
              {f.type === "textarea" ? (
                <Textarea id={id} aria-invalid={!!err(f.name)} {...reg} />
              ) : f.type === "select" ? (
                <Select id={id} aria-invalid={!!err(f.name)} {...reg}>
                  {!f.required && (
                    <option value="">{t("common.select")}</option>
                  )}
                  {f.options!.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.label, { defaultValue: o.label })}
                    </option>
                  ))}
                </Select>
              ) : f.type === "ref" ? (
                <RefSelect f={f} reg={reg} error={err(f.name)} id={id} />
              ) : f.type === "checkbox" ? (
                <label className="flex items-center gap-2 pt-6 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-slate-300"
                    {...reg}
                  />{" "}
                  {t(f.label)}
                </label>
              ) : (
                <Input
                  id={id}
                  aria-invalid={!!err(f.name)}
                  type={
                    f.type === "email"
                      ? "email"
                      : f.type === "password"
                        ? "password"
                        : f.type === "date"
                          ? "date"
                          : ["number", "integer", "money"].includes(f.type)
                            ? "number"
                            : "text"
                  }
                  step={
                    f.type === "money"
                      ? "0.01"
                      : f.type === "number"
                        ? "any"
                        : undefined
                  }
                  autoComplete={f.type === "password" ? "new-password" : "off"}
                  className={f.type === "email" ? "ltr-text" : undefined}
                  {...reg}
                />
              )}
            </Field>
          );
        })}
      </div>
      {formError && (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={busy}>
          {submitLabel ?? t("common.save")}
        </Button>
      </div>
    </form>
  );
}
