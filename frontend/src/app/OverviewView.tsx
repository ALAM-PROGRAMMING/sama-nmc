"use client";
import { useMemo } from "react";
import { ButtonLink } from "@/components/Button";
import { ArrowRightIcon, DownloadIcon, LockIcon, PlayIcon, UploadIcon } from "@/components/Icons";
import { HonestyBadge } from "@/components/HonestyBadge";
import { NmcCode } from "@/components/NmcCode";
import { Panel } from "@/components/Panel";
import { StatusPill } from "@/components/StatusPill";
import { attributeLabel, prettyValue } from "@/engine/explain";
import type { Decision, RecordView } from "@/engine/types";
import { SAMPLE_META } from "@/lib/sampleMeta";
import { useShowcase } from "@/lib/useShowcase";

/** Everything shown here is read from the sample run; no verdict is written by hand. */
function useExamples() {
  const run = useShowcase();
  return useMemo(() => {
    if (!run) return null;
    const rec = new Map(run.records.map((r) => [r.id, r]));
    const dec = new Map(run.decisions.map((d) => [d.id, d]));
    const byKey = (k: string) => SAMPLE_META.featured.find((f) => f.key === k);

    let same: { members: RecordView[]; code: string } | null = null;
    const v = byKey("verified");
    const vd = v ? dec.get(v.decision_id) : undefined;
    const code = vd ? rec.get(vd.left)?.nmc : null;
    const entry = code ? run.nmcs.find((n) => n.code === code) : undefined;
    if (entry) {
      same = {
        code: entry.code,
        members: entry.members.slice(0, 3).map((m) => rec.get(m)).filter((x): x is RecordView => !!x),
      };
    }

    let diff: { d: Decision; l: RecordView; r: RecordView } | null = null;
    const lk = byKey("lookalike");
    const ld = lk ? dec.get(lk.decision_id) : undefined;
    const l = ld ? rec.get(ld.left) : undefined;
    const r = ld ? rec.get(ld.right) : undefined;
    if (ld && l && r) diff = { d: ld, l, r };
    return { same, diff };
  }, [run]);
}

function Example() {
  const ex = useExamples();
  if (!ex) return <div className="h-64 rounded-ctl border border-line bg-white" aria-hidden="true" />;
  const { same, diff } = ex;
  const conflicts = diff ? diff.d.comparison.filter((c) => c.state === "conflict") : [];
  const agreeing = diff ? diff.d.comparison.filter((c) => c.critical && c.state === "agree").length : 0;
  const kind = diff?.d.zone === "REJECT" ? "reject" : diff?.d.zone === "REVIEW" ? "review" : "verified";
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {same && (
        <Panel title="Three descriptions, one identity" aside={<HonestyBadge kind="SYNTHETIC" />}>
          <ul className="m-0 list-none space-y-2 p-0">
            {same.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-tbl border border-line px-3 py-2">
                <span className="w-16 shrink-0 font-mono text-xs text-ink-3">{m.cpse}</span>
                <span className="font-mono text-[13px] text-ink">{m.raw}</span>
              </li>
            ))}
          </ul>
          <div className="my-3 flex items-center gap-2 text-sm text-ink-2">
            <ArrowRightIcon size={16} className="rotate-90 text-ink-3" /> recognised as the same item
          </div>
          <div className="rounded-ctl bg-navy px-4 py-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-onnavy">One national identity</div>
            <NmcCode code={same.code} size="lg" onDark />
          </div>
          <div className="mt-3">
            <StatusPill kind="verified" />
          </div>
        </Panel>
      )}
      {diff && (
        <Panel title="Almost identical, but not the same" aside={<HonestyBadge kind="SYNTHETIC" />}>
          <ul className="m-0 list-none space-y-2 p-0">
            {[diff.l, diff.r].map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-tbl border border-line px-3 py-2">
                <span className="w-16 shrink-0 font-mono text-xs text-ink-3">{m.cpse}</span>
                <span className="font-mono text-[13px] text-ink">{m.raw}</span>
              </li>
            ))}
          </ul>
          {conflicts.length > 0 && (
            <dl className="m-0 mt-3 divide-y divide-red-200 rounded-tbl border border-red-200 bg-red-50">
              {conflicts.map((c) => (
                <div key={c.property} className="flex flex-wrap items-center gap-x-4 px-3 py-2">
                  <dt className="w-28 text-xs font-semibold text-red-700">{attributeLabel(c.property)} differs</dt>
                  <dd className="m-0 font-mono text-sm text-ink">
                    {prettyValue(c.property, c.left)} <span className="text-ink-3">vs</span> {prettyValue(c.property, c.right)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-3 text-sm text-ink-2">
            {agreeing} other critical {agreeing === 1 ? "attribute agrees" : "attributes agree"}, but {conflicts.length === 1 ? "this one differs" : "these differ"}. That is enough to keep them apart.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill kind={kind} />
            <span className="text-sm text-ink-2">Never merged automatically</span>
          </div>
        </Panel>
      )}
    </div>
  );
}

const STEPS = [
  { n: "1", t: "Compare every attribute", d: "Size, class, material, face and more are read from each description and compared one by one." },
  { n: "2", t: "Safety rules decide", d: "A critical difference blocks a merge. Anything vague, missing or risky goes to a person." },
  { n: "3", t: "Engineers approve, the ledger remembers", d: "People confirm the doubtful cases, and every decision is written to a tamper-evident log." },
];

export function OverviewView() {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return (
    <div className="space-y-8">
      <section className="rounded-ctl border border-line bg-white px-6 py-8 sm:px-10 sm:py-10">
        <div className="text-xs font-semibold text-ink-3">National material master for MoPNG / CPCL</div>
        <h1 className="mt-2 max-w-[860px] text-[clamp(30px,4.6vw,46px)] leading-[1.1]">
          Turn fragmented CPSE material records into verified national identities.
        </h1>
        <p className="mt-4 max-w-[680px] text-[17px] text-ink-2">
          AI-assisted material harmonization with attribute-aware matching, safety rules and engineer governance.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <ButtonLink href="/sample" size="lg">
            <PlayIcon size={14} /> Try with sample data
          </ButtonLink>
          <ButtonLink href="/upload" variant="secondary" size="lg">
            <UploadIcon size={16} /> Upload your CSV
          </ButtonLink>
          <a href={`${base}/sample/sama_nmc_template.csv`} download className="inline-flex h-11 items-center gap-1.5 px-2 text-sm font-semibold">
            <DownloadIcon size={15} /> Download sample template
          </a>
        </div>
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-3">
          <LockIcon size={14} />
          Runs locally in your browser · Explainable decisions · No uploaded data leaves this device
        </p>
      </section>

      <section aria-labelledby="live-heading" className="space-y-3">
        <h2 id="live-heading" className="text-xl">
          See what it does
        </h2>
        <Example />
      </section>

      <section aria-labelledby="how-heading" className="space-y-3">
        <h2 id="how-heading" className="text-xl">
          How it works
        </h2>
        <ol className="m-0 grid list-none gap-px overflow-hidden rounded-ctl border border-line bg-line p-0 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="bg-white p-5">
              <span className="flex h-7 w-7 items-center justify-center rounded-tbl bg-navy font-cond text-base font-bold text-white">{s.n}</span>
              <h3 className="mt-3 text-lg leading-tight">{s.t}</h3>
              <p className="mt-1.5 text-sm text-ink-2">{s.d}</p>
            </li>
          ))}
        </ol>
        <p className="pt-2 font-cond text-[22px] font-semibold text-navy">AI proposes. Rules constrain. Engineers approve. The ledger remembers.</p>
      </section>
    </div>
  );
}
