/** All money is stored as integer minor units (e.g. centimes). Never use floats for balances. */
export const toMinor = (major: number): number =>
  Math.round((major + Number.EPSILON) * 100);
export const toMajor = (minor: number): number => minor / 100;

export interface LineInput {
  quantity: number;
  unitPriceMinor: number;
  discountPercent?: number;
  /** Tax rate in percent. Only applied when an approved rate is supplied by configuration/user. */
  taxPercent?: number;
}

export interface LineTotals {
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export function computeLine(l: LineInput): LineTotals {
  const grossMinor = Math.round(l.quantity * l.unitPriceMinor);
  const discountMinor = Math.round(
    (grossMinor * (l.discountPercent ?? 0)) / 100,
  );
  const netMinor = grossMinor - discountMinor;
  const taxMinor = Math.round((netMinor * (l.taxPercent ?? 0)) / 100);
  return {
    grossMinor,
    discountMinor,
    netMinor,
    taxMinor,
    totalMinor: netMinor + taxMinor,
  };
}

export function computeTotals(lines: LineInput[]) {
  const ls = lines.map(computeLine);
  const sum = (k: keyof LineTotals) => ls.reduce((a, b) => a + b[k], 0);
  return {
    lines: ls,
    subtotalMinor: sum("grossMinor"),
    discountTotalMinor: sum("discountMinor"),
    taxTotalMinor: sum("taxMinor"),
    grandTotalMinor: sum("totalMinor"),
  };
}

export function computeMargin(revenueMinor: number, costMinor: number) {
  const marginMinor = revenueMinor - costMinor;
  const marginPercent =
    revenueMinor > 0
      ? Math.round((marginMinor / revenueMinor) * 10000) / 100
      : 0;
  return { marginMinor, marginPercent };
}
