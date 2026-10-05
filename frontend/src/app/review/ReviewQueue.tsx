"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { shortReason } from "@/engine/explain";
import type { Decision, MasterState, RunOutput } from "@/engine/types";
import { Callout } from "@/components/Callout";
import { HonestyBadge } from "@/components/HonestyBadge";
import { PersonaSwitch } from "@/components/PersonaSwitch";
import { Stat } from "@/components/Stat";
import { StatusIcon, StatusPill } from "@/components/StatusPill";
import { TierChip } from "@/components/TierChip";
import { FILTERS, HUMAN_PILL, humanState, listDecisions, reviewCounts, type FilterId } from "@/lib/review";
import { SAMPLE_META } from "@/lib/sampleMeta";

const PAGE = 50;

function Item({ d, master, filter, featuredTitle }: { d: Decision; master: MasterState; filter: FilterId; featuredTitle?: string }) {
  const rec = new Map(master.run.records.map((r) => [r.id, r]));
  const a = rec.get(d.left)!;
  const b = rec.get(d.right)!;
  const pill = HUMAN_PILL[humanState(master, d)];
  const cpses = Array.from(new Set([a.cpse, b.cpse])).join(" · ");
  return (
    <li>
      <Link
        href={`/review?d=${encodeURIComponent(d.id)}&f=${filter}`}
        className="block rounded-ctl border border-line bg-white px-4 py-3 text-ink no-underline hover:border-navy hover:bg-blue-50/40 hover:text-ink"
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill kind={pill.kind} label={pill.label} />
          <TierChip tier={d.tier} />
          {featuredTitle && <span className="text-xs font-semibold text-blue-700">{featuredTitle}</span>}
          <span className="ml-auto text-xs text-ink-3">{cpses}</span>
        </div>
        <div className="mt-2 grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
          <div className="min-w-0 break-words"><span className="mr-1.5 font-mono text-xs text-ink-3">{a.matnr}</span>{a.raw}</div>
          <div className="min-w-0 break-words"><span className="mr-1.5 font-mono text-xs text-ink-3">{b.matnr}</span>{b.raw}</div>
        </div>
        <div className="mt-1.5 text-sm text-ink-2">{shortReason(d)}</div>
      </Link>
    </li>
  );
}

export function ReviewQueue({ run, master, initialFilter }: { run: RunOutput; master: MasterState; initialFilter: FilterId }) {
  const [filter, setFilter] = useState<FilterId>(initialFilter);
  const [page, setPage] = useState(0);
  const c = reviewCounts(master);
  const featured = run.scope === "sample" ? SAMPLE_META.featured : [];
  const fIds = featured.map((f) => f.decision_id);
  const byId = new Map(run.decisions.map((d) => [d.id, d]));

  const list = useMemo(() => listDecisions(master, filter, []).filter((d) => !fIds.includes(d.id)), [master, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const visible = list.slice(cur * PAGE, cur * PAGE + PAGE);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px]">Match Review</h1>
        {run.scope === "sample" && <HonestyBadge kind="SYNTHETIC" />}
        <div className="ml-auto"><PersonaSwitch /></div>
      </div>
      <p className="max-w-3xl text-sm text-ink-2">
        Pick a pair to see what the system compared, why it decided, and the evidence behind it. AI proposes. Rules constrain. Engineers approve. The ledger remembers.
      </p>

      <section aria-label="Review summary" className="rounded-ctl border border-line bg-white">
        <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
          <Stat value={c.open} tone="amber" label="Needs review" icon={<StatusIcon kind="review" size={14} />} />
          <Stat value={c.approved} tone="teal" label="Approved" icon={<StatusIcon kind="verified" size={14} />} />
          <Stat value={c.rejected} tone="red" label="Rejected" icon={<StatusIcon kind="reject" size={14} />} />
          <Stat value={c.blocked} tone="red" label="Join blocked" icon={<StatusIcon kind="reject" size={14} />} note="approved, refused by the safety check" />
        </div>
      </section>

      {featured.length > 0 && (
        <section aria-labelledby="feat-h" className="space-y-2">
          <h2 id="feat-h" className="text-lg">Featured cases</h2>
          <ul className="m-0 grid list-none gap-2 p-0 lg:grid-cols-2">
            {featured.map((f) => {
              const d = byId.get(f.decision_id);
              return d ? <Item key={f.key} d={d} master={master} filter={filter} featuredTitle={f.title} /> : null;
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="all-h" className="space-y-3">
        <h2 id="all-h" className="text-lg">{featured.length ? "All other decisions" : "Decisions"}</h2>
        <div role="group" aria-label="Filter decisions" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setPage(0);
              }}
              className={`rounded-ctl border px-3 py-1.5 text-sm font-semibold ${filter === f.id ? "border-navy bg-navy text-white" : "border-line-strong bg-white text-navy hover:bg-blue-50"}`}
            >
              {f.label} <span className={`tnum font-normal ${filter === f.id ? "text-onnavy" : "text-ink-3"}`}>{c[f.id].toLocaleString("en-IN")}</span>
            </button>
          ))}
        </div>
        {(filter === "open" || filter === "blocked") && (
          <p className="text-xs text-ink-3">Reviewer decisions improve review prioritization. Safety rules remain fixed.</p>
        )}
        {list.length === 0 ? (
          <Callout tone="info">Nothing here{filter === "open" ? ": every pair that needed a person has been decided." : "."}</Callout>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {visible.map((d) => <Item key={d.id} d={d} master={master} filter={filter} />)}
          </ul>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
            <button type="button" disabled={cur === 0} onClick={() => setPage(cur - 1)} className="rounded-ctl border border-line-strong bg-white px-3 py-1.5 font-semibold text-navy disabled:opacity-50">Previous</button>
            <span className="text-ink-2">Page {cur + 1} of {pages}</span>
            <button type="button" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="rounded-ctl border border-line-strong bg-white px-3 py-1.5 font-semibold text-navy disabled:opacity-50">Next</button>
          </nav>
        )}
      </section>
    </div>
  );
}
