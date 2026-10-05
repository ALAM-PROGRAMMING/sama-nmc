"use client";
import Link from "next/link";
import { useMemo } from "react";
import { attributeLabel, explainDecision, prettyValue, stateTone, stateWord } from "@/engine/explain";
import type { Decision, RecordView, RunOutput } from "@/engine/types";
import { fmtScore } from "@/lib/format";
import { HonestyBadge } from "@/components/HonestyBadge";
import { ArrowRightIcon } from "@/components/Icons";
import { StatusPill } from "@/components/StatusPill";

const n = (x: number) => x.toLocaleString("en-IN");

const TONE = {
  same: "text-teal-700",
  different: "font-semibold text-red-700",
  vague: "font-semibold text-amber-800",
  missing: "font-semibold text-amber-800",
  neutral: "text-ink-3",
} as const;

function pick(run: RunOutput, max = 3): Decision[] {
  const dec = new Map(run.decisions.map((d) => [d.id, d]));
  const all = run.fuzzy.stopped_ids.map((id) => dec.get(id)).filter((d): d is Decision => !!d);
  const chosen: Decision[] = [];
  const add = (d?: Decision) => d && !chosen.includes(d) && chosen.length < max && chosen.push(d);
  add(all.find((d) => d.zone === "REJECT"));
  add(all.find((d) => d.zone === "REVIEW" && d.tier === "R"));
  add(all.find((d) => d.zone === "REVIEW" && d.tier === "E"));
  for (const d of all) add(d);
  return chosen;
}

function ExampleCard({ d, rec }: { d: Decision; rec: Map<string, RecordView> }) {
  const l = rec.get(d.left);
  const r = rec.get(d.right);
  const ex = explainDecision(d);
  const rows = d.comparison.filter((c) => c.critical || c.state === "conflict");
  return (
    <article className="flex flex-col rounded-ctl border border-line bg-white">
      <div className="space-y-1.5 border-b border-line p-4">
        {[l, r].map((x, i) => (
          <div key={i} className="text-sm">
            <span className="mr-2 font-mono text-xs text-ink-3">{x?.id ?? "?"}</span>
            <span className="font-mono text-[13px] text-ink">{x?.raw}</span>
          </div>
        ))}
      </div>
      <div className="grid gap-px bg-line sm:grid-cols-2">
        <div className="bg-white p-4">
          <div className="eyebrow">Ordinary matcher</div>
          <div className="mt-1 text-sm text-ink">Text similarity <strong className="font-mono">{fmtScore(d.baseline_score, 3)}</strong></div>
          <div className="mt-1.5 inline-flex items-center rounded-tbl border border-line-strong px-2 py-0.5 text-xs font-semibold text-ink-2">
            {d.baseline_zone === "AUTO_MERGE" ? "Would auto-merge" : "Would send to review"}
          </div>
        </div>
        <div className="bg-white p-4">
          <div className="eyebrow">SAMA-NMC</div>
          <div className="mt-1.5">
            <StatusPill kind={d.zone === "REJECT" ? "reject" : d.zone === "REVIEW" ? "review" : "verified"} />
          </div>
        </div>
      </div>
      <p className="border-t border-line px-4 py-3 text-sm text-ink">{ex.headline}</p>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Attributes compared</caption>
          <thead>
            <tr className="bg-canvas text-xs text-ink-2">
              <th scope="col" className="px-4 py-1.5 font-semibold">Attribute</th>
              <th scope="col" className="px-3 py-1.5 font-semibold">First</th>
              <th scope="col" className="px-3 py-1.5 font-semibold">Second</th>
              <th scope="col" className="px-3 py-1.5 font-semibold">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const tone = stateTone(c.state);
              const hot = c.state === "conflict";
              return (
                <tr key={c.property} className={`border-t border-line ${hot ? "bg-red-50" : ""}`}>
                  <td className="px-4 py-1.5 text-ink-2">{attributeLabel(c.property)}</td>
                  <td className="px-3 py-1.5 font-mono text-[13px]">{prettyValue(c.property, c.left)}</td>
                  <td className="px-3 py-1.5 font-mono text-[13px]">{prettyValue(c.property, c.right)}</td>
                  <td className={`px-3 py-1.5 text-xs ${TONE[tone]}`}>{stateWord(c.state)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-auto border-t border-line px-4 py-2.5">
        <Link href={`/review?d=${encodeURIComponent(d.id)}`} className="inline-flex items-center gap-1 text-sm font-semibold">
          Open in Match Review <ArrowRightIcon size={12} />
        </Link>
      </div>
    </article>
  );
}

export function TwoEngines({ run }: { run: RunOutput }) {
  const f = run.fuzzy;
  const ak = f.answer_key;
  const rec = useMemo(() => new Map(run.records.map((r) => [r.id, r])), [run]);
  const examples = useMemo(() => pick(run), [run]);
  return (
    <section aria-labelledby="two-h" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="two-h" className="text-xl">Same data, two engines</h2>
        <HonestyBadge kind="DEMO" />
      </div>
      <p className="text-sm text-ink-3">Decision safety on the same candidate pairs, not a search benchmark.</p>

      <div className="rounded-ctl border border-line border-l-4 border-l-navy bg-white px-5 py-4">
        <p className="text-[15px] text-ink">
          An ordinary text matcher would auto-merge <strong className="tnum">{n(f.fuzzy_auto)}</strong> of the {n(run.summary.candidate_pairs)} candidate pairs in this run. SAMA-NMC stopped{" "}
          <strong className="tnum">{n(f.stopped_by_sama)}</strong> of those and auto-verified <strong className="tnum">{n(f.both_auto)}</strong>.
        </p>
        {ak ? (
          <p className="mt-1.5 text-[15px] text-ink">
            Against the demo answer key ({n(ak.pairs_with_truth)} pairs with a known answer), the ordinary matcher made <strong className="tnum text-red-700">{n(ak.fuzzy_wrong)}</strong> wrong merges and SAMA-NMC made{" "}
            <strong className="tnum text-teal-700">{n(ak.sama_wrong)}</strong>.
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-ink-3">Your file has no answer key, so right and wrong cannot be counted here. The pairs below are where the two engines disagree.</p>
        )}
        <p className="mt-1.5 text-xs text-ink-3">Ordinary-matcher threshold for this comparison: {fmtScore(f.t_base, 4)}.</p>
      </div>

      {examples.length === 0 ? (
        <p className="rounded-ctl border border-dashed border-line-strong bg-white px-5 py-6 text-sm text-ink-2">
          In this run, SAMA-NMC did not stop any pair that an ordinary matcher would have merged, so there is nothing to compare.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {examples.map((d) => (
            <ExampleCard key={d.id} d={d} rec={rec} />
          ))}
        </div>
      )}
    </section>
  );
}
