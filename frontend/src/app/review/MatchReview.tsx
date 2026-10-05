"use client";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { explainDecision } from "@/engine/explain";
import type { MasterState, RunOutput } from "@/engine/types";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { ArrowRightIcon, ChevronIcon, FileIcon } from "@/components/Icons";
import { NmcCode } from "@/components/NmcCode";
import { StatusPill, type StatusKind } from "@/components/StatusPill";
import { TierChip } from "@/components/TierChip";
import { CHAIN_TRAP_IDS, HUMAN_PILL, humanState, listDecisions, type FilterId } from "@/lib/review";
import { SAMPLE_META } from "@/lib/sampleMeta";
import { EvidenceCertificate } from "./EvidenceCertificate";
import { ReviewActions } from "./ReviewActions";
import { AttributeTable, identityOf, RecordCard, WhyPanel } from "./parts";

const ENGINE_PILL: Record<string, StatusKind> = { verified: "verified", review: "review", lookalike: "reject" };
const BAR: Record<string, string> = { verified: "border-l-teal-500", review: "border-l-orange-500", lookalike: "border-l-red-500" };

const href = (id: string, filter: FilterId | null, evidence = false) =>
  `/review?d=${encodeURIComponent(id)}${filter ? `&f=${filter}` : ""}${evidence ? "&evidence=1" : ""}`;

function ChainTrapGuide({ id }: { id: string }) {
  const first = CHAIN_TRAP_IDS[0];
  const second = CHAIN_TRAP_IDS[1];
  return (
    <details className="rounded-ctl border border-line bg-white px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold text-navy">Try the chain trap (optional, about a minute)</summary>
      <div className="mt-3 space-y-3 text-ink">
        <p>
          A carbon-steel valve could be A216 WCB or A105, and those two grades are different. Each link on its own is reasonable. Approve both and watch the safety check step in.
        </p>
        <ol className="m-0 space-y-2 pl-5">
          <li>
            Open the{" "}
            {id === first ? <strong>carbon steel and A216 WCB link (this page)</strong> : <Link href={href(first, null)}>carbon steel and A216 WCB link</Link>}. As Demo analyst click <strong>Approve</strong>, switch to Demo engineer and click <strong>Approve</strong> again. A national code is created for the two records.
          </li>
          <li>
            Open the{" "}
            {id === second ? <strong>carbon steel and A105 link (this page)</strong> : <Link href={href(second, null)}>carbon steel and A105 link</Link>}. Approve it as Demo engineer, switch to Demo analyst and approve again.
          </li>
          <li>The second link is refused: joining it would put A216 WCB and A105 under one code. An engineer can reject the link.</li>
        </ol>
      </div>
    </details>
  );
}

export function MatchReview({ run, master, id, filter, evidence }: { run: RunOutput; master: MasterState; id: string; filter: FilterId | null; evidence: boolean }) {
  const router = useRouter();
  const d = run.decisions.find((x) => x.id === id);
  const featured = run.scope === "sample" ? SAMPLE_META.featured : [];
  const featuredCase = featured.find((f) => f.decision_id === id) ?? null;

  const neighbours = useMemo(() => {
    if (!filter) return null;
    const list = listDecisions(master, filter, featured.map((f) => f.decision_id));
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return null;
    return { i, n: list.length, prev: list[i - 1]?.id ?? null, next: list[i + 1]?.id ?? null };
    // decisions made on this page should not reshuffle the walk: depend on the run, not on master
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, filter, id]);

  useEffect(() => {
    if (evidence) document.getElementById("evidence")?.scrollIntoView({ block: "start" });
  }, [evidence, id]);

  if (!d) {
    return (
      <div className="space-y-4">
        <Callout tone="attention" title="That decision is not part of this run">
          The link may be from a different run. Open the queue to choose a decision.
        </Callout>
        <Link href="/review" className="font-semibold">Back to Match Review</Link>
      </div>
    );
  }
  const a = run.records.find((r) => r.id === d.left)!;
  const b = run.records.find((r) => r.id === d.right)!;
  const ex = explainDecision(d);
  const hs = humanState(master, d);
  const identity = identityOf(master, d);
  const setEvidence = (on: boolean) => router.replace(href(id, filter, on), { scroll: false });

  return (
    <div className="space-y-5">
      <div className={`flex flex-wrap items-center justify-between gap-2 ${evidence ? "print:hidden" : ""}`}>
        <Link href={filter ? `/review?f=${filter}` : "/review"} className="inline-flex items-center gap-1 text-sm font-semibold no-underline hover:underline">
          <ChevronIcon size={14} className="rotate-180" /> All decisions
        </Link>
        {neighbours && (
          <nav aria-label="Previous and next decision" className="flex items-center gap-2 text-sm">
            <span className="text-ink-3">{neighbours.i + 1} of {neighbours.n}</span>
            {neighbours.prev ? <Link href={href(neighbours.prev, filter)} className="rounded-ctl border border-line-strong bg-white px-2.5 py-1 font-semibold no-underline">Previous</Link> : <span className="rounded-ctl border border-line px-2.5 py-1 text-ink-3">Previous</span>}
            {neighbours.next ? <Link href={href(neighbours.next, filter)} className="rounded-ctl border border-line-strong bg-white px-2.5 py-1 font-semibold no-underline">Next</Link> : <span className="rounded-ctl border border-line px-2.5 py-1 text-ink-3">Next</span>}
          </nav>
        )}
      </div>

      <div className={`space-y-5 ${evidence ? "print:hidden" : ""}`}>
        {/* 1. decision banner */}
        <section aria-label="Decision" className={`rounded-ctl border border-line border-l-[6px] bg-white px-5 py-4 ${BAR[d.kind]}`}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill kind={ENGINE_PILL[d.kind]} />
            <TierChip tier={d.tier} />
            {d.kind === "review" && hs !== "open" && (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                then a person: <StatusPill kind={HUMAN_PILL[hs].kind} label={HUMAN_PILL[hs].label} />
              </span>
            )}
            <span className="ml-auto font-mono text-xs text-ink-3">{d.class_code === "9999" ? "GENERIC" : d.class_code}</span>
          </div>
          <h1 className="mt-2 text-[26px] leading-snug">{ex.headline}</h1>
          <p className="mt-1 text-sm text-ink-2">{ex.next_step}</p>
        </section>

        {featuredCase && (
          <Callout tone="info" title={`Why this case matters: ${featuredCase.title}`}>
            {featuredCase.blurb}
          </Callout>
        )}
        {run.scope === "sample" && CHAIN_TRAP_IDS.includes(id as (typeof CHAIN_TRAP_IDS)[number]) && <ChainTrapGuide id={id} />}

        {/* 2. the two records */}
        <div className="grid gap-4 md:grid-cols-2">
          <RecordCard label="CPSE A" rec={a} nmc={master.record_nmc[a.id] ?? null} />
          <RecordCard label="CPSE B" rec={b} nmc={master.record_nmc[b.id] ?? null} />
        </div>

        {/* 3. attributes */}
        <AttributeTable d={d} a={a} b={b} />

        {/* 4. why */}
        <WhyPanel d={d} />

        {/* 5. evidence + identity + actions */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant={evidence ? "secondary" : "primary"} onClick={() => setEvidence(!evidence)} aria-expanded={evidence} aria-controls="evidence">
            <FileIcon size={14} /> {evidence ? "Hide evidence" : "View evidence"}
          </Button>
          {identity.code && (
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
              Shared national code <NmcCode code={identity.code} size="sm" />
              <Link href={`/registry?code=${encodeURIComponent(identity.code)}`} className="inline-flex items-center gap-1 font-semibold">
                See in NMC Registry <ArrowRightIcon size={14} />
              </Link>
            </span>
          )}
        </div>

        <ReviewActions key={d.id} master={master} d={d} />
      </div>

      {evidence && <EvidenceCertificate master={master} decisionId={d.id} onClose={() => setEvidence(false)} />}
    </div>
  );
}
