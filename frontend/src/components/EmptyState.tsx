import type { ReactNode } from "react";
import { InfoIcon } from "./Icons";

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-ctl border border-dashed border-line-strong bg-white px-6 py-12 text-center">
      <InfoIcon size={24} className="mx-auto text-blue-600" />
      <h2 className="mt-3 text-xl">{title}</h2>
      {children && <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">{children}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
