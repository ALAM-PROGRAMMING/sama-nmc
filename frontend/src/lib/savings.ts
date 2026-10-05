/**
 * Savings lens (illustrative): what the spread between CPSE prices for ONE verified identity could mean.
 * Pure function over run data. No number is invented: every value is a price, a quantity or arithmetic on them.
 *
 *   illustrative opportunity = SUM over matched rows of (price - lowest price) x annual quantity
 *
 * Only rows with a usable price and the SAME unit of measure are compared. It is never called "savings".
 */
import type { RecordView } from "@/engine/types";

export type SavingsInput = Pick<RecordView, "id" | "cpse" | "matnr" | "uom" | "price" | "qty">;

export interface SavingsRow {
  id: string;
  cpse: string;
  matnr: string;
  uom: string;
  price: number | null;
  qty: number | null;
  included: boolean;
  /** why the row is left out (shown struck through) */
  reason: string | null;
  /** price minus the lowest price (included rows only) */
  above: number | null;
  /** (price - lowest) x quantity (included rows with a quantity only) */
  opportunity: number | null;
}

export interface SavingsLens {
  basisUom: string;
  rows: SavingsRow[];
  min: number;
  max: number;
  spread: number;
  spreadPct: number; // spread as a fraction of the lowest price
  pooledQty: number | null; // null when no matched row states a quantity
  opportunity: number | null;
  rowsWithoutQty: number;
}

const usable = (p: number | null): p is number => p !== null && Number.isFinite(p) && p > 0;

/** Returns null when fewer than two members share a unit of measure and have a price. */
export function computeSavings(members: SavingsInput[]): SavingsLens | null {
  const priced = members.filter((m) => usable(m.price) && m.uom.trim() !== "");
  const byUom = new Map<string, number>();
  for (const m of priced) byUom.set(m.uom, (byUom.get(m.uom) ?? 0) + 1);
  let basis: string | null = null;
  for (const [u, n] of [...byUom.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    if (n >= 2) {
      basis = u;
      break;
    }
  }
  if (basis === null) return null;

  const inc = priced.filter((m) => m.uom === basis);
  const min = Math.min(...inc.map((m) => m.price as number));
  const max = Math.max(...inc.map((m) => m.price as number));

  const rows: SavingsRow[] = members.map((m) => {
    const base = { id: m.id, cpse: m.cpse, matnr: m.matnr, uom: m.uom, price: m.price, qty: m.qty };
    if (!usable(m.price)) return { ...base, included: false, reason: "no price in the file", above: null, opportunity: null };
    if (m.uom.trim() === "") return { ...base, included: false, reason: "unit of measure not stated", above: null, opportunity: null };
    if (m.uom !== basis) return { ...base, included: false, reason: `unit differs (${m.uom}, not ${basis})`, above: null, opportunity: null };
    const above = m.price - min;
    return { ...base, included: true, reason: null, above, opportunity: m.qty !== null && m.qty >= 0 ? above * m.qty : null };
  });

  const withQty = rows.filter((r) => r.included && r.qty !== null && r.qty >= 0);
  return {
    basisUom: basis,
    rows,
    min,
    max,
    spread: max - min,
    spreadPct: (max - min) / min,
    pooledQty: withQty.length ? withQty.reduce((s, r) => s + (r.qty as number), 0) : null,
    opportunity: withQty.length ? withQty.reduce((s, r) => s + (r.opportunity as number), 0) : null,
    rowsWithoutQty: rows.filter((r) => r.included && (r.qty === null || r.qty < 0)).length,
  };
}
