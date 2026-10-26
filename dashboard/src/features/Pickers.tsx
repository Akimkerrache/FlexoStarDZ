import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDebounced } from "@/components/DataTable";
import { Button, Input } from "@/components/ui";
import { res } from "@/services/api";
import { cn, toggleAllBaseColors } from "@/lib/utils";
import { BASE_COLORS, type BaseColor } from "@/types";

export interface PantoneChoice {
  code: string;
  name?: string;
  hex?: string;
}

const SWATCH: Record<BaseColor, string> = {
  C: "#00AEEF",
  M: "#EC008C",
  Y: "#FFF200",
  K: "#231F20",
  W: "#FFFFFF",
};

export function ColorPicker({
  base,
  pantone,
  onBase,
  onPantone,
  includePantone,
}: {
  base: BaseColor[];
  pantone: PantoneChoice[];
  onBase: (b: BaseColor[]) => void;
  onPantone: (p: PantoneChoice[]) => void;
  includePantone: boolean;
}) {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  const debounced = useDebounced(term, 250);
  const q = useQuery({
    queryKey: ["pantone-search", debounced],
    queryFn: () =>
      res.pantone.list({ search: debounced || undefined, limit: 12 }),
    enabled: debounced.length > 0,
  });
  const total = base.length + (includePantone ? pantone.length : 0);
  const toggle = (c: BaseColor) =>
    onBase(
      base.includes(c)
        ? base.filter((x) => x !== c)
        : BASE_COLORS.filter((x) => x === c || base.includes(x)),
    );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="flex items-end gap-3">
        <div className="w-20">
          <label
            htmlFor="color-count"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            {t("orderForm.colorsCount")}
          </label>
          <Input
            id="color-count"
            readOnly
            value={total}
            aria-describedby="color-count-hint"
            className="bg-slate-100 text-center"
          />
        </div>
        <fieldset className="flex-1">
          <legend className="mb-1 text-sm font-medium text-slate-700">
            {t("orderForm.baseColors")}
          </legend>
          <div className="flex flex-wrap items-center gap-2">
            {BASE_COLORS.map((c) => (
              <label
                key={c}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm",
                  base.includes(c)
                    ? "border-teal-600 bg-teal-50"
                    : "border-slate-300 bg-white",
                )}
              >
                <input
                  type="checkbox"
                  className="size-4"
                  checked={base.includes(c)}
                  onChange={() => toggle(c)}
                />
                <span
                  className="size-3 rounded-full border border-slate-300"
                  style={{ background: SWATCH[c] }}
                  aria-hidden
                />
                {c}
              </label>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onBase(toggleAllBaseColors(base))}
              aria-pressed={base.length === BASE_COLORS.length}
            >
              {t("orderForm.all")}
            </Button>
          </div>
        </fieldset>
        <p id="color-count-hint" className="sr-only">
          {t("orderForm.colorCountHint")}
        </p>
      </div>
      <div>
        <label
          htmlFor="pantone-search"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          {t("orderForm.pantone")}
        </label>
        <PantoneSearch
          id="pantone-search"
          term={term}
          setTerm={setTerm}
          results={q.data?.items ?? []}
          loading={q.isFetching}
          onPick={(p) => {
            if (!pantone.some((x) => x.code === p.code))
              onPantone([...pantone, p]);
            setTerm("");
          }}
        />
        {pantone.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {pantone.map((p) => (
              <li
                key={p.code}
                className="flex items-center gap-1.5 rounded-full bg-slate-100 py-1 ps-2 pe-1 text-xs"
              >
                {p.hex && (
                  <span
                    className="size-3 rounded-full border"
                    style={{ background: p.hex }}
                    aria-hidden
                  />
                )}
                <span className="ltr-text">{p.code}</span>
                <button
                  type="button"
                  onClick={() =>
                    onPantone(pantone.filter((x) => x.code !== p.code))
                  }
                  aria-label={t("common.remove")}
                  className="rounded-full p-0.5 hover:bg-slate-200"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PantoneSearch({
  id,
  term,
  setTerm,
  results,
  loading,
  onPick,
}: {
  id: string;
  term: string;
  setTerm: (s: string) => void;
  results: any[];
  loading: boolean;
  onPick: (p: PantoneChoice) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) =>
      !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={box} className="relative">
      <Search
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
      <Input
        id={id}
        role="combobox"
        aria-expanded={open && !!term}
        aria-controls={`${id}-list`}
        autoComplete="off"
        className="ps-9"
        placeholder={t("orderForm.pantonePlaceholder")}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && term && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {loading && (
            <li className="px-3 py-2 text-sm text-slate-500">
              {t("common.loading")}
            </li>
          )}
          {!loading && results.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">
              {t("orderForm.noPantone")}
            </li>
          )}
          {results.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50"
                onClick={() => {
                  onPick({ code: p.code, name: p.name, hex: p.hex });
                  setOpen(false);
                }}
              >
                {p.hex && (
                  <span
                    className="size-4 rounded border"
                    style={{ background: p.hex }}
                    aria-hidden
                  />
                )}
                <span className="ltr-text">{p.code}</span>{" "}
                {p.name && <span className="text-slate-500">{p.name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ClientPicker({
  value,
  label,
  onChange,
  error,
  locked,
}: {
  value: string;
  label: string;
  onChange: (id: string, label: string) => void;
  error?: string;
  locked?: boolean;
}) {
  const { t } = useTranslation();
  const [term, setTerm] = useState(label);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(term, 250);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setTerm(label), [label]);
  useEffect(() => {
    const h = (e: MouseEvent) =>
      !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const q = useQuery({
    queryKey: ["client-search", debounced],
    queryFn: () =>
      res.clients.list({
        search: debounced || undefined,
        limit: 8,
        isActive: "true",
      }),
    enabled: open && !locked,
  });
  return (
    <div ref={box} className="relative">
      <Input
        id="client-search"
        role="combobox"
        aria-expanded={open}
        aria-controls="client-list"
        aria-invalid={!!error}
        autoComplete="off"
        readOnly={locked}
        disabled={locked}
        placeholder={t("orderForm.searchClient")}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
          if (value) onChange("", "");
        }}
        onFocus={() => setOpen(true)}
      />
      {open && !locked && (
        <ul
          id="client-list"
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {q.isFetching && (
            <li className="px-3 py-2 text-sm text-slate-500">
              {t("common.loading")}
            </li>
          )}
          {!q.isFetching && !q.data?.items.length && (
            <li className="px-3 py-2 text-sm text-slate-500">
              {t("orderForm.noClients")}
            </li>
          )}
          {q.data?.items.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === value}>
              <button
                type="button"
                className="flex w-full flex-col px-3 py-2 text-start text-sm hover:bg-slate-50"
                onClick={() => {
                  onChange(c.id, c.legalName);
                  setTerm(c.legalName);
                  setOpen(false);
                }}
              >
                <span className="font-medium">{c.legalName}</span>
                <span className="ltr-text text-xs text-slate-500">
                  {c.code}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
