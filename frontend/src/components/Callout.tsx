import type { ReactNode } from "react";
import { CheckIcon, CrossIcon, FlagIcon, InfoIcon } from "./Icons";

const TONES = {
  info: { box: "border-blue-100 bg-blue-50", bar: "bg-blue-600", icon: <InfoIcon size={16} className="text-blue-600" />, tx: "text-blue-700" },
  good: { box: "border-teal-200 bg-teal-50", bar: "bg-teal-500", icon: <CheckIcon size={16} className="text-teal-500" />, tx: "text-teal-700" },
  attention: { box: "border-amber-200 bg-amber-50", bar: "bg-orange-500", icon: <FlagIcon size={16} className="text-orange-500" />, tx: "text-amber-800" },
  danger: { box: "border-red-200 bg-red-50", bar: "bg-red-500", icon: <CrossIcon size={16} className="text-red-500" />, tx: "text-red-700" },
} as const;

export function Callout({
  tone = "info",
  title,
  children,
  role,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children: ReactNode;
  role?: "alert" | "status";
}) {
  const t = TONES[tone];
  return (
    <div role={role} className={`relative flex gap-3 rounded-ctl border py-3 pl-5 pr-4 ${t.box}`}>
      <span className={`absolute inset-y-0 left-0 w-1 rounded-l-ctl ${t.bar}`} aria-hidden="true" />
      <span className="mt-0.5 shrink-0">{t.icon}</span>
      <div className="min-w-0 text-sm text-ink">
        {title && <div className={`font-semibold ${t.tx}`}>{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}
