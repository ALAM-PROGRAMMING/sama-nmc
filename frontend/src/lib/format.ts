/** Number formatting helpers. Formatting only — never a source of numbers. */

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

export function fmtScore(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

/** Upper bound as a percentage with enough digits to stay honest (0.00163 -> "0.163%"). */
export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const pct = n * 100;
  return `${pct < 1 ? pct.toFixed(3) : pct.toFixed(2)}%`;
}

export function scopeLabel(scope: string): string {
  return scope.replace(/_/g, "-");
}
