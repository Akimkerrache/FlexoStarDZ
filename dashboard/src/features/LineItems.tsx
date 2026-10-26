import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Input } from "@/components/ui";
import { fromMinor, money, toMinor } from "@/lib/utils";

export interface LineDraft {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string; // major units
  discountPercent: string;
  taxPercent: string;
  unitCost: string; // major units, quotations only
  catalogItemId?: string;
  orderId?: string;
}

export const emptyLine = (): LineDraft => ({
  description: "",
  quantity: "1",
  unit: "unit",
  unitPrice: "0",
  discountPercent: "0",
  taxPercent: "0",
  unitCost: "0",
});

export function linesFromDocs(lines: any[] = []): LineDraft[] {
  return lines.map((l) => ({
    description: l.description,
    quantity: String(l.quantity),
    unit: l.unit ?? "unit",
    unitPrice: fromMinor(l.unitPriceMinor ?? 0),
    discountPercent: String(l.discountPercent ?? 0),
    taxPercent: String(l.taxPercent ?? 0),
    unitCost: fromMinor(l.unitCostMinor ?? 0),
    catalogItemId: l.catalogItemId,
    orderId: l.orderId,
  }));
}

export function linesToPayload(lines: LineDraft[], withCost = false) {
  return lines.map((l) => ({
    ...(l.catalogItemId ? { catalogItemId: l.catalogItemId } : {}),
    ...(l.orderId ? { orderId: l.orderId } : {}),
    description: l.description.trim(),
    quantity: Number(l.quantity),
    unit: l.unit || "unit",
    unitPriceMinor: toMinor(l.unitPrice),
    discountPercent: Number(l.discountPercent || 0),
    taxPercent: Number(l.taxPercent || 0),
    ...(withCost ? { unitCostMinor: toMinor(l.unitCost) } : {}),
  }));
}

/** Preview only: the server recalculates every total and is the source of truth. */
export function previewTotals(lines: LineDraft[]) {
  let sub = 0,
    disc = 0,
    tax = 0;
  for (const l of lines) {
    const gross = Math.round(Number(l.quantity || 0) * toMinor(l.unitPrice));
    const d = Math.round((gross * Number(l.discountPercent || 0)) / 100);
    sub += gross;
    disc += d;
    tax += Math.round(((gross - d) * Number(l.taxPercent || 0)) / 100);
  }
  return { sub, disc, tax, total: sub - disc + tax };
}

export const linesValid = (lines: LineDraft[]) =>
  lines.length > 0 &&
  lines.every(
    (l) =>
      l.description.trim() &&
      Number(l.quantity) > 0 &&
      Number(l.unitPrice) >= 0,
  );

export function LineItemsEditor({
  lines,
  onChange,
  withCost,
  disabled,
}: {
  lines: LineDraft[];
  onChange: (l: LineDraft[]) => void;
  withCost?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const set = (i: number, k: keyof LineDraft, v: string) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const tot = previewTotals(lines);
  const cell = "min-w-20";
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="text-start text-xs text-slate-500">
              {[
                "f.description",
                "f.quantity",
                "f.unit",
                "f.unitPrice",
                "f.discountPercent",
                "f.taxPercent",
                ...(withCost ? ["f.unitCost"] : []),
              ].map((h) => (
                <th key={h} className="px-1 pb-1 text-start font-medium">
                  {t(h)}
                </th>
              ))}
              <th className="px-1 pb-1 text-end font-medium">
                {t("f.lineTotal")}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const gross = Math.round(
                Number(l.quantity || 0) * toMinor(l.unitPrice),
              );
              const net =
                gross -
                Math.round((gross * Number(l.discountPercent || 0)) / 100);
              return (
                <tr key={i}>
                  <td className="p-1">
                    <Input
                      aria-label={t("f.description")}
                      className="min-w-52"
                      value={l.description}
                      disabled={disabled}
                      onChange={(e) => set(i, "description", e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      aria-label={t("f.quantity")}
                      type="number"
                      min="0"
                      step="any"
                      className={cell}
                      value={l.quantity}
                      disabled={disabled}
                      onChange={(e) => set(i, "quantity", e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      aria-label={t("f.unit")}
                      className="w-20"
                      value={l.unit}
                      disabled={disabled}
                      onChange={(e) => set(i, "unit", e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      aria-label={t("f.unitPrice")}
                      type="number"
                      min="0"
                      step="0.01"
                      className="min-w-24"
                      value={l.unitPrice}
                      disabled={disabled}
                      onChange={(e) => set(i, "unitPrice", e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      aria-label={t("f.discountPercent")}
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      className="w-20"
                      value={l.discountPercent}
                      disabled={disabled}
                      onChange={(e) =>
                        set(i, "discountPercent", e.target.value)
                      }
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      aria-label={t("f.taxPercent")}
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      className="w-20"
                      value={l.taxPercent}
                      disabled={disabled}
                      onChange={(e) => set(i, "taxPercent", e.target.value)}
                    />
                  </td>
                  {withCost && (
                    <td className="p-1">
                      <Input
                        aria-label={t("f.unitCost")}
                        type="number"
                        min="0"
                        step="0.01"
                        className="min-w-24"
                        value={l.unitCost}
                        disabled={disabled}
                        onChange={(e) => set(i, "unitCost", e.target.value)}
                      />
                    </td>
                  )}
                  <td className="whitespace-nowrap px-1 text-end">
                    {money(
                      net + Math.round((net * Number(l.taxPercent || 0)) / 100),
                    )}
                  </td>
                  <td className="p-1">
                    {!disabled && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("common.remove")}
                        onClick={() =>
                          onChange(lines.filter((_, j) => j !== i))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...lines, emptyLine()])}
        >
          <Plus className="size-4" /> {t("common.addLine")}
        </Button>
      )}
      <dl className="ms-auto grid max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-500">{t("f.subtotal")}</dt>
        <dd className="text-end">{money(tot.sub)}</dd>
        <dt className="text-slate-500">{t("f.discounts")}</dt>
        <dd className="text-end">{money(tot.disc)}</dd>
        <dt className="text-slate-500">{t("f.tax")}</dt>
        <dd className="text-end">{money(tot.tax)}</dd>
        <dt className="font-semibold">{t("f.total")}</dt>
        <dd className="text-end font-semibold">{money(tot.total)}</dd>
      </dl>
      <p className="text-xs text-slate-500">{t("f.serverRecalculates")}</p>
    </div>
  );
}
