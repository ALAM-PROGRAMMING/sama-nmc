import type { ReactNode } from "react";
import { CheckIcon, CircleIcon, CrossIcon, FlagIcon, PendingIcon } from "./Icons";

export type StatusKind = "verified" | "review" | "reject" | "unique" | "pending";

const STYLE: Record<StatusKind, { label: string; box: string; icon: ReactNode }> = {
  verified: {
    label: "Verified",
    box: "border-teal-200 bg-teal-50 text-teal-700",
    icon: <CheckIcon size={14} className="text-teal-500" />,
  },
  review: {
    label: "Needs review",
    box: "border-amber-200 bg-amber-50 text-amber-800",
    icon: <FlagIcon size={14} className="text-orange-500" />,
  },
  reject: {
    label: "Blocked look-alike",
    box: "border-red-200 bg-red-50 text-red-700",
    icon: <CrossIcon size={14} className="text-red-500" />,
  },
  unique: {
    label: "Unique",
    box: "border-blue-100 bg-blue-50 text-blue-700",
    icon: <CircleIcon size={14} className="text-blue-600" />,
  },
  pending: {
    label: "Pending",
    box: "border-line-strong bg-canvas text-ink-2",
    icon: <PendingIcon size={14} className="text-ink-3" />,
  },
};

/** Status is never colour alone: always an icon and a word. */
export function StatusPill({ kind, label, className = "" }: { kind: StatusKind; label?: string; className?: string }) {
  const s = STYLE[kind];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-tbl border px-2 py-0.5 text-xs font-semibold ${s.box} ${className}`}
    >
      {s.icon}
      {label ?? s.label}
    </span>
  );
}

export function StatusIcon({ kind, size = 16 }: { kind: StatusKind; size?: number }) {
  const map = {
    verified: <CheckIcon size={size} className="text-teal-500" />,
    review: <FlagIcon size={size} className="text-orange-500" />,
    reject: <CrossIcon size={size} className="text-red-500" />,
    unique: <CircleIcon size={size} className="text-blue-600" />,
    pending: <PendingIcon size={size} className="text-ink-3" />,
  };
  return map[kind];
}
