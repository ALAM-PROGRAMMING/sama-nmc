export type HonestyKind = "SYNTHETIC" | "DEMO DATA" | "DEMO" | "UNVERIFIED TABLE" | "ILLUSTRATIVE";

/** Hatched badge: marks anything that is not production evidence. */
export function HonestyBadge({ kind, className = "" }: { kind: HonestyKind; className?: string }) {
  const amber = kind === "UNVERIFIED TABLE";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-tbl border border-dashed px-1.5 py-px font-mono text-xs font-medium uppercase tracking-wide ${
        amber ? "hatch-amber border-orange-500 bg-amber-50 text-amber-800" : "hatch-grey border-ink-3 bg-white text-ink-2"
      } ${className}`}
    >
      {kind}
    </span>
  );
}
