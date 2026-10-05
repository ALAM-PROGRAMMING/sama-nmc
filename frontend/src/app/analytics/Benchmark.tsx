"use client";
import { useEffect, useState } from "react";
import type { BenchmarkAsset, BenchmarkScope } from "@/engine/types";
import { fmtPct, scopeLabel } from "@/lib/format";
import { withBase } from "@/state/engineFacade";
import { Callout } from "@/components/Callout";
import { HonestyBadge } from "@/components/HonestyBadge";
import { CheckIcon, CrossIcon, FlagIcon } from "@/components/Icons";

const n = (x: number) => x.toLocaleString("en-IN");

type ScopeId = "synthetic" | "unseen_noise" | "real_labelled";
const SCOPES: Array<{ id: ScopeId; label: string; disabled?: boolean }> = [
  { id: "synthetic", label: "Synthetic" },
  { id: "unseen_noise", label: "Unseen noise" },
  { id: "real_labelled", label: "Real labelled", disabled: true },
];

const MODES = [
  { key: "sama" as const, title: "SAMA-NMC", sub: "rules + gate + engineer approval", accent: "border-t-navy" },
  { key: "baseline" as const, title: "Ordinary matcher", sub: "text similarity only", accent: "border-t-ink-3" },
  { key: "model_only" as const, title: "Model alone", sub: "ablation: the score without the safety rules", accent: "border-t-ink-3" },
];

function Cell({ icon, label, value, scope, tone = "text-ink" }: { icon: React.ReactNode; label: string; value: number; scope: string; tone?: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className={`font-cond text-[28px] font-bold leading-none tnum ${tone}`}>{n(value)}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        {icon}
        {label}
      </div>
      <div className="font-mono text-xs text-ink-3">{scope}</div>
    </div>
  );
}

function ScopeBlock({ id, data }: { id: Exclude<ScopeId, "real_labelled">; data: BenchmarkScope }) {
  const scope = scopeLabel(id);
  const tag = `${scope} · n=${n(data.n_pairs)}`;
  const sf = data.safety;
  const hard = [
    ["Trap-twin auto-merges", sf.auto_trap],
    ["Risk-word auto-merges", sf.auto_riskword],
    ["Part-number-suffix auto-merges", sf.auto_mpn_suffix],
    ["All wrong auto-merges", sf.auto_false_merges],
  ] as Array<[string, number]>;
  const b = data.blocking;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">
        Evidence scope: <strong className="font-mono text-ink">{scope}</strong> · <strong className="tnum">{n(data.n_pairs)}</strong> candidate pairs from{" "}
        <strong className="tnum">{n(data.n_records)}</strong> records.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {MODES.map((m) => {
          const d = data.modes[m.key];
          return (
            <article key={m.key} className={`rounded-ctl border border-line border-t-4 bg-white ${m.accent}`}>
              <div className="border-b border-line px-4 py-3">
                <h3 className="text-lg leading-tight">{m.title}</h3>
                <p className="text-xs text-ink-3">{m.sub}</p>
              </div>
              <div className="grid grid-cols-2 divide-x divide-y divide-line">
                <Cell
                  icon={d.auto_wrong === 0 ? <CheckIcon size={13} className="text-teal-500" /> : <CrossIcon size={13} className="text-red-500" />}
                  label="Wrong auto-merges"
                  value={d.auto_wrong}
                  scope={tag}
                  tone={d.auto_wrong === 0 ? "text-teal-700" : "text-red-700"}
                />
                <Cell icon={<CheckIcon size={13} className="text-teal-500" />} label="Correct auto-merges" value={d.auto_correct} scope={tag} />
                <Cell icon={<FlagIcon size={13} className="text-orange-500" />} label="Sent to review" value={d.review} scope={tag} />
                <Cell icon={<CrossIcon size={13} className="text-ink-3" />} label="Rejected" value={d.reject} scope={tag} />
              </div>
              <dl className="m-0 space-y-1 border-t border-line px-4 py-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">95% upper bound on the wrong auto-merge rate</dt>
                  <dd className="m-0 shrink-0 font-mono font-semibold text-ink">{fmtPct(d.upper_bound_95)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">True matches wrongly rejected</dt>
                  <dd className="m-0 shrink-0 font-mono font-semibold tnum text-ink">{n(d.reject_true_match)}</dd>
                </div>
                <p className="text-xs text-ink-3">{tag}</p>
              </dl>
            </article>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-ctl border border-line bg-white p-4">
          <h3 className="text-lg">Hard safety counts, SAMA-NMC</h3>
          <p className="text-xs text-ink-3">Automatic merges of the pair types that must never be auto-merged. Measured: {tag}.</p>
          <ul className="m-0 mt-2 list-none divide-y divide-line p-0">
            {hard.map(([label, v]) => (
              <li key={label} className="flex items-center gap-2 py-1.5 text-sm">
                {v === 0 ? <CheckIcon size={14} className="text-teal-500" /> : <CrossIcon size={14} className="text-red-500" />}
                <span className="text-ink">{label}</span>
                <span className={`ml-auto font-mono font-semibold tnum ${v === 0 ? "text-teal-700" : "text-red-700"}`}>{n(v)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-ctl border border-line bg-white p-4">
          <h3 className="text-lg">Blocking recall</h3>
          <p className="text-xs text-ink-3">How many true matching pairs the candidate search found before any decision. Measured: {tag}.</p>
          <div className="mt-2 font-cond text-[32px] font-bold leading-none tnum text-navy">{b.recall === null ? "—" : fmtPct(b.recall)}</div>
          <p className="mt-1 text-sm text-ink-2">
            <span className="tnum">{n(b.found)}</span> of <span className="tnum">{n(b.true_pairs)}</span> true pairs found.
            {id === "unseen_noise" && " Coverage is lower here, so fewer true pairs reached a decision at all."}
          </p>
        </div>
      </div>
    </div>
  );
}

export function Benchmark() {
  const [data, setData] = useState<BenchmarkAsset | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  const [scope, setScope] = useState<ScopeId>("synthetic");

  useEffect(() => {
    let off = false;
    fetch(withBase("/data/benchmark.json"))
      .then((r) => (r.ok ? (r.json() as Promise<BenchmarkAsset>) : Promise.reject(new Error("missing"))))
      .then((j) => {
        if (off) return;
        if (!j?.synthetic?.modes) throw new Error("bad");
        setData(j);
        setState("ok");
      })
      .catch(() => !off && setState("missing"));
    return () => {
      off = true;
    };
  }, []);

  return (
    <section aria-labelledby="bench-h" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="bench-h" className="text-xl">Offline benchmark (Python reference)</h2>
        <HonestyBadge kind="SYNTHETIC" />
      </div>
      {state === "loading" && <div className="rounded-ctl border border-line bg-white p-6 text-sm text-ink-2">Loading the benchmark…</div>}
      {state === "missing" && (
        <Callout tone="attention" title="The benchmark file is not available" role="status">
          The offline benchmark results could not be loaded, so nothing is shown here. No numbers are estimated in their place.
        </Callout>
      )}
      {state === "ok" && data && (
        <>
          <p className="text-sm text-ink-2">{data.scope_note} Gate: <span className="font-mono">{data.gate}</span>.</p>

          <div role="tablist" aria-label="Evidence scope" className="flex flex-wrap gap-1.5">
            {SCOPES.map((s) => {
              const sel = s.id === scope;
              return (
                <button
                  key={s.id}
                  role="tab"
                  type="button"
                  id={`bench-${s.id}`}
                  aria-selected={sel}
                  aria-controls="bench-panel"
                  disabled={s.disabled}
                  onClick={() => setScope(s.id)}
                  className={`inline-flex items-center rounded-ctl border px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed ${
                    sel ? "border-navy bg-navy text-white" : s.disabled ? "border-line bg-canvas text-ink-3" : "border-line-strong bg-white text-ink-2 hover:bg-blue-50"
                  }`}
                >
                  {s.label}
                  {s.disabled && <span className="ml-2 text-xs font-normal">not yet measured</span>}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-ink-3">
            Real labelled data is not yet measured: it needs pairs labelled by engineers from real CPSE records, which this demo does not have. Nothing is shown for it rather than an estimate.
          </p>

          <div id="bench-panel" role="tabpanel" aria-labelledby={`bench-${scope}`}>
            {scope !== "real_labelled" && <ScopeBlock key={scope} id={scope} data={data[scope]} />}
          </div>

          <Callout tone="info" title="Read these numbers with care">
            <ul className="m-0 list-disc space-y-1 pl-4">
              <li>The data is synthetic, generated for this benchmark. It is not real CPSE data.</li>
              <li>The unseen-noise scope uses a different pattern of spelling and wording noise, and the candidate search covers fewer true pairs there (new abbreviations stop the engine recognising some items, which is fixed by adding them to a reviewed dictionary).</li>
              <li>The ordinary matcher uses the same frozen text vectors with a threshold chosen on the synthetic calibration data. On unseen wording that threshold is not re-tuned, as it would not be in real use; a matcher tuned on that data itself could score better.</li>
              <li>These are counts measured on these pairs. They are not a promise about other data, and a zero is bounded by the 95% upper bound shown, not proven to be zero everywhere.</li>
              <li>The engineering tables behind the rules are unverified drafts until an engineer reviews them.</li>
            </ul>
          </Callout>
        </>
      )}
    </section>
  );
}
