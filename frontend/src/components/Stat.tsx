import type { ReactNode } from "react";

export function Stat({
  value,
  label,
  note,
  icon,
  tone = "default",
}: {
  value: number | string;
  label: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "teal" | "amber" | "red" | "blue";
}) {
  const color = { default: "text-navy", teal: "text-teal-700", amber: "text-amber-800", red: "text-red-700", blue: "text-blue-700" }[tone];
  return (
    <div className="min-w-0 px-4 py-3">
      <div className={`font-cond text-[30px] font-bold leading-none tnum ${color}`}>
        {typeof value === "number" ? value.toLocaleString("en-IN") : value}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        {icon}
        <span>{label}</span>
      </div>
      {note && <div className="mt-0.5 text-xs text-ink-3">{note}</div>}
    </div>
  );
}
