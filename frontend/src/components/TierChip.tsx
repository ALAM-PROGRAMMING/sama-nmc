import { Tooltip } from "./Tooltip";

/** Tier R = engineered item (two approvals, always an engineer). Tier E = standard item. */
export function TierChip({ tier }: { tier: "R" | "E" }) {
  const r = tier === "R";
  return (
    <Tooltip
      label={
        r
          ? "Tier R: an engineered item. A person always checks it, and approval needs two people including an engineer."
          : "Tier E: a standard item. One approval is enough when a person is needed."
      }
    >
      <span
        className={`inline-flex items-center whitespace-nowrap rounded-tbl border px-1.5 py-px font-mono text-xs font-semibold ${
          r ? "border-navy bg-navy text-white" : "border-line-strong bg-white text-ink-2"
        }`}
      >
        {r ? "TIER R" : "TIER E"}
      </span>
    </Tooltip>
  );
}
