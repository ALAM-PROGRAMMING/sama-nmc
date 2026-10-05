"use client";
import { useMemo } from "react";
import type { RunOutput } from "@/engine/types";
import { fmtScore } from "@/lib/format";
import { HonestyBadge } from "@/components/HonestyBadge";
import { StatusIcon } from "@/components/StatusPill";
import { Panel } from "@/components/Panel";
import { Stat } from "@/components/Stat";

const n = (x: number) => x.toLocaleString("en-IN");

export function ThisRun({ run }: { run: RunOutput }) {
  const s = run.summary;
  const classNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of run.records) m.set(r.class_code, r.class_name);
    return m;
  }, [run]);
  const byClass = useMemo(() => Object.entries(s.by_class).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)), [s.by_class]);
  const maxClass = Math.max(1, ...byClass.map(([, v]) => v));
  const zoneTotal = s.auto + s.review + s.reject;
  const zones = [
    { kind: "verified" as const, label: "Verified (auto)", note: "same item, proven", v: s.auto, bar: "bg-teal-500" },
    { kind: "review" as const, label: "Needs review", note: "a person decides", v: s.review, bar: "bg-orange-500" },
    { kind: "reject" as const, label: "Blocked look-alike", note: "different items", v: s.reject, bar: "bg-red-500" },
  ];
  const statuses = Object.entries(run.config_status);

  return (
    <section aria-labelledby="this-run-h" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="this-run-h" className="text-xl">This run</h2>
        {run.scope === "sample" ? <HonestyBadge kind="SYNTHETIC" /> : <span className="text-xs font-semibold text-ink-2">Your uploaded file</span>}
      </div>

      <div className="rounded-ctl border border-line bg-white">
        <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 lg:grid-cols-5 lg:divide-y-0">
          <Stat value={s.records} label="Records" />
          <Stat value={s.candidate_pairs} label="Candidate pairs examined" />
          <Stat value={s.groups} tone="teal" label="Verified identities" note="groups" />
          <Stat value={s.unique} tone="blue" label="Unique records" />
          <Stat value={s.generic_records} tone="amber" label="GENERIC records" note="review only" />
        </div>
        <div className="border-t border-line px-4 py-2 text-xs text-ink-3">
          {n(s.nmcs)} identities in total · {n(s.pending)} records wait on an open review · {n(s.filtered)} unrelated pairs filtered (clearly different, never merged)
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Records by material class">
          <ul className="m-0 list-none space-y-2.5 p-0">
            {byClass.map(([code, count]) => (
              <li key={code} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[210px_minmax(0,1fr)_auto]">
                <span className="min-w-0 truncate text-sm text-ink" title={`${classNames.get(code) ?? code} (${code})`}>
                  <span className="font-mono text-xs text-ink-3">{code}</span> {classNames.get(code) ?? code}
                </span>
                <span className="order-3 col-span-2 h-3 rounded-tbl bg-canvas sm:order-none sm:col-span-1" aria-hidden="true">
                  <span className="block h-3 rounded-tbl bg-blue-600" style={{ width: `${Math.max(2, (count / maxClass) * 100)}%` }} />
                </span>
                <span className="text-sm font-semibold tnum text-ink">{n(count)}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Where the candidate pairs went">
          {zoneTotal === 0 ? (
            <p className="text-sm text-ink-2">No pair needed a decision: no two records looked alike.</p>
          ) : (
            <>
              <div className="flex h-5 overflow-hidden rounded-tbl border border-line" role="img" aria-label={zones.map((z) => `${z.label}: ${n(z.v)}`).join(", ")}>
                {zones.map((z) => z.v > 0 && <span key={z.kind} className={z.bar} style={{ width: `${(z.v / zoneTotal) * 100}%` }} />)}
              </div>
              <ul className="m-0 mt-3 list-none space-y-2 p-0">
                {zones.map((z) => (
                  <li key={z.kind} className="flex items-center gap-2 text-sm">
                    <StatusIcon kind={z.kind} />
                    <span className="font-semibold text-ink">{z.label}</span>
                    <span className="text-ink-3">{z.note}</span>
                    <span className="ml-auto tnum font-semibold text-ink">{n(z.v)}</span>
                    <span className="w-14 text-right text-xs tnum text-ink-3">{((z.v / zoneTotal) * 100).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-3">Pairs shown for decision: {n(zoneTotal)}. A further {n(s.filtered)} pairs were filtered as unrelated and never merged.</p>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Thresholds and tables used" aside={<span className="font-mono text-xs text-ink-3">{run.gate_model} · {run.text_model}</span>}>
        <dl className="m-0 grid gap-x-8 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold text-ink-2">Safety gate</dt>
            <dd className="m-0 font-mono text-[15px] text-ink">{run.gate_model}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-ink-2">Tier E auto-verify threshold</dt>
            <dd className="m-0 font-mono text-[15px] text-ink">{run.thresholds.thr_E === null ? "none (always review)" : fmtScore(run.thresholds.thr_E, 6)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-ink-2">Ordinary-matcher threshold</dt>
            <dd className="m-0 font-mono text-[15px] text-ink">{fmtScore(run.thresholds.t_base, 4)}</dd>
          </div>
        </dl>
        <div className="mt-4 text-xs font-semibold text-ink-2">Status of each engineering table behind this run</div>
        <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
          {statuses.map(([k, v]) => (
            <li key={k} className="inline-flex items-center gap-1.5 rounded-tbl border border-line px-2 py-1 text-xs">
              <span className="font-mono text-ink-2">{k}</span>
              {v === "unverified" ? <HonestyBadge kind="UNVERIFIED TABLE" /> : <span className="font-semibold uppercase text-ink-2">{v}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-3">Tables marked unverified are drafts that an engineer has not reviewed. Decisions that depend on them are sent to review, not auto-verified.</p>
      </Panel>
    </section>
  );
}
