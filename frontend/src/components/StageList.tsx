import { CheckIcon, PendingIcon } from "./Icons";

export interface StageView {
  label: string;
  status: "pending" | "active" | "done";
  done: number;
  total: number;
  unit: string;
}

/** The six processing stages as a calm vertical list. */
export function StageList({ stages }: { stages: StageView[] }) {
  return (
    <ol className="m-0 list-none divide-y divide-line p-0" aria-label="Processing stages">
      {stages.map((s, i) => (
        <li key={s.label} className="flex items-center gap-4 py-3.5" aria-current={s.status === "active" ? "step" : undefined}>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center">
            {s.status === "done" ? (
              <CheckIcon size={22} className="text-teal-500" />
            ) : s.status === "active" ? (
              <span className="h-3.5 w-3.5 rounded-full bg-blue-600" style={{ animation: "sama-pulse 1.4s ease-in-out infinite" }} />
            ) : (
              <PendingIcon size={22} className="text-line-strong" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className={`text-[15px] ${s.status === "pending" ? "text-ink-3" : "font-semibold text-ink"}`}>
              <span className="mr-2 font-mono text-xs font-normal text-ink-3">{i + 1}</span>
              {s.label}
            </div>
          </div>
          <div className="shrink-0 text-right text-sm tnum">
            {s.status === "pending" ? (
              <span className="text-ink-3">Waiting</span>
            ) : (
              <>
                {s.total > 0 && (
                  <span className="text-ink-2">
                    {s.done.toLocaleString("en-IN")}
                    {s.done !== s.total && s.status === "active" ? ` of ${s.total.toLocaleString("en-IN")}` : ""} {s.unit}
                  </span>
                )}
                <span className={`ml-2 text-xs font-semibold ${s.status === "done" ? "text-teal-700" : "text-blue-700"}`}>
                  {s.status === "done" ? "Done" : "Working"}
                </span>
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
