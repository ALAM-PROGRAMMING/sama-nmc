"use client";
import Link from "next/link";
import { useMemo, useState, type KeyboardEvent } from "react";
import { shortReason } from "@/engine/explain";
import { tamperedCopy, verifyChain } from "@/engine/audit";
import type { AuditEvent, Decision, MasterState } from "@/engine/types";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { CheckIcon, ShieldIcon } from "@/components/Icons";
import { PersonaSwitch } from "@/components/PersonaSwitch";
import { RunGate } from "@/components/RunGate";
import { Stat } from "@/components/Stat";
import { StatusIcon, StatusPill } from "@/components/StatusPill";
import { TierChip } from "@/components/TierChip";
import { actionWords, compareOpen, formatWhen, groupAudit, HUMAN_PILL, humanState, needsEngineer, payloadText, reasonLabel, REVIEWER_ACTIONS } from "@/lib/review";

type Tab = "queue" | "made" | "audit";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "queue", label: "Review queue" },
  { id: "made", label: "Decisions made" },
  { id: "audit", label: "Audit trail" },
];

export function GovernanceView() {
  return <RunGate title="Governance">{(_run, master) => <Loaded master={master} />}</RunGate>;
}

function pairText(master: MasterState, d: Decision) {
  const rec = new Map(master.run.records.map((r) => [r.id, r]));
  const a = rec.get(d.left)!;
  const b = rec.get(d.right)!;
  return (
    <div className="min-w-0 text-sm">
      <div className="break-words"><span className="mr-1.5 font-mono text-xs text-ink-3">{a.cpse} {a.matnr}</span>{a.raw}</div>
      <div className="break-words"><span className="mr-1.5 font-mono text-xs text-ink-3">{b.cpse} {b.matnr}</span>{b.raw}</div>
    </div>
  );
}

function Loaded({ master }: { master: MasterState }) {
  const [tab, setTab] = useState<Tab>("queue");
  const decisions = master.run.decisions;
  const state = useMemo(() => decisions.map((d) => [d, humanState(master, d)] as const), [master, decisions]);
  const open = state.filter(([, s]) => s === "open" || s === "blocked").map(([d]) => d).sort((a, b) => {
    const ba = humanState(master, a) === "blocked" ? 0 : 1;
    const bb = humanState(master, b) === "blocked" ? 0 : 1;
    return ba !== bb ? ba - bb : compareOpen(master, a, b);
  });
  const made = state.filter(([, s]) => s === "approved" || s === "rejected" || s === "blocked").map(([d]) => d);
  const n = { open: state.filter(([, s]) => s === "open").length, approved: state.filter(([, s]) => s === "approved").length, rejected: state.filter(([, s]) => s === "rejected").length, blocked: state.filter(([, s]) => s === "blocked").length };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const t = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
      setTab(t.id);
      document.getElementById(`gtab-${t.id}`)?.focus();
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px]">Governance</h1>
        <div className="ml-auto"><PersonaSwitch /></div>
      </div>
      <p className="max-w-3xl text-sm text-ink-2">
        AI proposes. Rules constrain. Engineers approve. The ledger remembers. Here are the open items, what people decided, and the tamper-evident trail behind it all.
      </p>

      <section aria-label="Governance summary" className="rounded-ctl border border-line bg-white">
        <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
          <Stat value={n.open} tone="amber" label="Waiting for review" icon={<StatusIcon kind="review" size={14} />} />
          <Stat value={n.approved} tone="teal" label="Approved" icon={<StatusIcon kind="verified" size={14} />} />
          <Stat value={n.rejected} tone="red" label="Rejected" icon={<StatusIcon kind="reject" size={14} />} />
          <Stat value={n.blocked} tone="red" label="Join blocked" icon={<StatusIcon kind="reject" size={14} />} />
        </div>
      </section>

      <div role="tablist" aria-label="Governance sections" onKeyDown={onKey} className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`gtab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`gpanel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === t.id ? "border-navy text-navy" : "border-transparent text-ink-2 hover:text-navy"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`gpanel-${tab}`} aria-labelledby={`gtab-${tab}`}>
        {tab === "queue" && <QueueTab master={master} items={open} />}
        {tab === "made" && <MadeTab master={master} items={made} />}
        {tab === "audit" && <AuditTab master={master} />}
      </div>
    </div>
  );
}

function QueueTab({ master, items }: { master: MasterState; items: Decision[] }) {
  if (items.length === 0) return <Callout tone="good">Nothing is waiting. Every pair that needed a person has been decided.</Callout>;
  return (
    <div className="overflow-x-auto rounded-ctl border border-line bg-white">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <caption className="sr-only">Open review items, engineer-needed first</caption>
        <thead>
          <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-ink-3">
            <th scope="col" className="px-4 py-2 font-semibold">Pair</th>
            <th scope="col" className="px-3 py-2 font-semibold">Why</th>
            <th scope="col" className="px-3 py-2 font-semibold">Tier</th>
            <th scope="col" className="px-3 py-2 font-semibold">Progress</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => {
            const item = master.reviews[d.id];
            const blocked = humanState(master, d) === "blocked";
            return (
              <tr key={d.id} className="border-b border-line last:border-b-0 hover:bg-blue-50/40">
                <td className="px-4 py-2.5 align-top">
                  <Link href={`/review?d=${encodeURIComponent(d.id)}`} className="block text-ink no-underline hover:text-ink">{pairText(master, d)}</Link>
                </td>
                <td className="px-3 py-2.5 align-top text-ink-2">{shortReason(d)}</td>
                <td className="px-3 py-2.5 align-top"><TierChip tier={d.tier} /></td>
                <td className="px-3 py-2.5 align-top">
                  {blocked ? <StatusPill kind="reject" label="Join blocked" /> : (
                    <>
                      <div className="font-semibold">{item.approvals.length} of {item.approvals_required} approvals</div>
                      {needsEngineer(item) && <div className="text-xs text-amber-800">engineer needed</div>}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MadeTab({ master, items }: { master: MasterState; items: Decision[] }) {
  if (items.length === 0) return <Callout tone="info">No reviewer decisions yet. Open a pair in Match Review and approve or reject it.</Callout>;
  return (
    <div className="overflow-x-auto rounded-ctl border border-line bg-white">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <caption className="sr-only">Decisions made by reviewers</caption>
        <thead>
          <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-ink-3">
            <th scope="col" className="px-4 py-2 font-semibold">Pair</th>
            <th scope="col" className="px-3 py-2 font-semibold">Decision</th>
            <th scope="col" className="px-3 py-2 font-semibold">By (demo persona)</th>
            <th scope="col" className="px-3 py-2 font-semibold">When</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => {
            const item = master.reviews[d.id];
            const hs = humanState(master, d);
            const pill = HUMAN_PILL[hs];
            const last = item.status === "rejected" ? item.rejection : item.approvals[item.approvals.length - 1];
            return (
              <tr key={d.id} className="border-b border-line last:border-b-0 hover:bg-blue-50/40">
                <td className="px-4 py-2.5 align-top">
                  <Link href={`/review?d=${encodeURIComponent(d.id)}`} className="block text-ink no-underline hover:text-ink">{pairText(master, d)}</Link>
                </td>
                <td className="px-3 py-2.5 align-top">
                  <StatusPill kind={pill.kind} label={pill.label} />
                  {item.rejection && <div className="mt-1 text-xs text-ink-2">{reasonLabel(item.rejection.reason_code)}</div>}
                </td>
                <td className="px-3 py-2.5 align-top">
                  {item.status === "rejected" ? item.rejection?.actor : item.approvals.map((a) => a.actor).join(" + ")}
                </td>
                <td className="px-3 py-2.5 align-top text-ink-2">{formatWhen(last?.at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SHOW = 150;

function EventRow({ e }: { e: AuditEvent }) {
  const reviewer = REVIEWER_ACTIONS.has(e.action);
  return (
    <tr className={`border-b border-line last:border-b-0 ${reviewer ? "bg-blue-50/60" : ""}`}>
      <td className="px-3 py-1.5 align-top font-mono text-xs">#{e.seq}</td>
      <td className="px-3 py-1.5 align-top text-xs text-ink-2 whitespace-nowrap">{formatWhen(e.ts)}</td>
      <td className="px-3 py-1.5 align-top text-xs">{e.actor}</td>
      <td className="px-3 py-1.5 align-top text-xs">
        <span className="font-semibold">{actionWords(e.action)}</span>
        <span className="block font-mono text-ink-3">{e.action}</span>
      </td>
      <td className="px-3 py-1.5 align-top font-mono text-xs break-all">{e.entity_id}</td>
      <td className="px-3 py-1.5 align-top text-xs text-ink-2 break-words">{payloadText(e.payload)}</td>
    </tr>
  );
}

function EventTable({ events }: { events: AuditEvent[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-ink-3">
            <th scope="col" className="px-3 py-2 font-semibold">Seq</th>
            <th scope="col" className="px-3 py-2 font-semibold">Time</th>
            <th scope="col" className="px-3 py-2 font-semibold">Actor</th>
            <th scope="col" className="px-3 py-2 font-semibold">Action</th>
            <th scope="col" className="px-3 py-2 font-semibold">Entity</th>
            <th scope="col" className="px-3 py-2 font-semibold">Details</th>
          </tr>
        </thead>
        <tbody>{events.map((e) => <EventRow key={e.seq} e={e} />)}</tbody>
      </table>
    </div>
  );
}

function AuditTab({ master }: { master: MasterState }) {
  const events = master.audit;
  const groups = useMemo(() => groupAudit(events), [events]);
  const [shown, setShown] = useState(SHOW);
  const chain = useMemo(() => verifyChain(events), [events]);
  const reviewerSeqs = events.filter((e) => REVIEWER_ACTIONS.has(e.action)).map((e) => e.seq);
  const [verified, setVerified] = useState<string | null>(null);
  const [seqText, setSeqText] = useState(String(reviewerSeqs[reviewerSeqs.length - 1] ?? Math.min(5, events.length)));
  const [tamper, setTamper] = useState<{ seq: number; broken: number | null; ok: boolean; before: string; after: string } | null>(null);

  const seq = Number.parseInt(seqText, 10);
  const validSeq = Number.isInteger(seq) && seq >= 1 && seq <= events.length;

  const runTamper = () => {
    if (!validSeq) return;
    const copy = tamperedCopy(events, seq); // a COPY: the real chain is never touched
    const res = verifyChain(copy);
    const src = events.find((e) => e.seq === seq)!;
    const alt = copy.find((e) => e.seq === seq)!;
    setTamper({ seq, broken: res.broken_at, ok: res.ok, before: payloadText(src.payload), after: payloadText(alt.payload) });
  };

  const visible = groups.slice(0, shown);

  return (
    <div className="space-y-5">
      <section className="rounded-ctl border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="text-lg">Local demonstration audit trail <span className="text-sm font-normal text-ink-3">(this browser only)</span></h2>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
            {chain.ok ? (
              <><ShieldIcon size={16} className="text-teal-500" /><span className="text-teal-700" data-testid="chain-status">Chain intact · {events.length.toLocaleString("en-IN")} events</span></>
            ) : (
              <span className="text-red-700" data-testid="chain-status">Chain broken at event #{chain.broken_at}</span>
            )}
          </span>
        </div>
        <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
          <div className="space-y-2 text-sm text-ink">
            <div className="eyebrow">What this trail records</div>
            <p>
              Every decision the rules make, every approval or rejection a reviewer gives, and every national code created, attached or merged. Each event carries the fingerprint of the one before it, so changing any past event breaks the chain from that point on.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-ctl border border-line bg-line sm:grid-cols-2">
            <div className="bg-white p-3">
              <div className="eyebrow text-blue-700">Current demo</div>
              <p className="mt-1 text-sm">The trail lives in this browser tab. It is reproduced from your clicks when you reload the sample.</p>
            </div>
            <div className="bg-white p-3">
              <div className="eyebrow">Future pilot</div>
              <p className="mt-1 text-sm">In a pilot, this ledger is stored server-side with role-based access.</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4 border-t border-line px-5 py-4">
          <div className="space-y-1">
            <Button variant="secondary" onClick={() => setVerified(verifyChain(events).ok ? `Chain intact · ${events.length.toLocaleString("en-IN")} events` : `Chain broken at event #${verifyChain(events).broken_at}`)}>
              <CheckIcon size={14} /> Verify chain
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm font-semibold text-ink">
              Tamper test: event number
              <input
                type="number"
                min={1}
                max={events.length}
                value={seqText}
                onChange={(e) => setSeqText(e.target.value)}
                className="ml-2 h-9 w-24 rounded-ctl border border-line-strong bg-white px-2 font-mono text-sm"
              />
            </label>
            <Button variant="secondary" onClick={runTamper} disabled={!validSeq}>Tamper test</Button>
          </div>
        </div>
        {verified && (
          <div className="px-5 pb-4" role="status">
            <Callout tone="good">{verified}</Callout>
          </div>
        )}
        {tamper && (
          <div className="px-5 pb-4" role="status" data-testid="tamper-result">
            <Callout tone="info" title={`The chain pinpoints event #${tamper.broken ?? "none"}`}>
              This is a demonstration: we changed event #{tamper.seq} in a copy of the log, and the chain pinpoints it.
              <span className="mt-2 block text-xs text-ink-2">
                Check on the copy: {tamper.ok ? "no break found" : `broken at event #${tamper.broken}`}. Before: {tamper.before || "(empty)"} · After: {tamper.after}.
                The real trail was not touched and still reads: Chain intact · {events.length.toLocaleString("en-IN")} events.
              </span>
            </Callout>
          </div>
        )}
      </section>

      <section aria-labelledby="events-h" className="rounded-ctl border border-line bg-white">
        <div className="border-b border-line px-5 py-3">
          <h2 id="events-h" className="text-lg">Events</h2>
          <p className="text-xs text-ink-3">Reviewer events are tinted. Automatic decision records are folded away.</p>
        </div>
        <div>
          {visible.map((g, i) =>
            g.kind === "auto" ? (
              <details key={`a${i}`} className="border-b border-line">
                <summary className="cursor-pointer bg-canvas px-5 py-2.5 text-sm font-semibold text-navy">
                  {g.events.length.toLocaleString("en-IN")} automatic decision records
                  <span className="ml-2 font-normal text-ink-3">events #{g.events[0].seq} to #{g.events[g.events.length - 1].seq}</span>
                </summary>
                <AutoList events={g.events} />
              </details>
            ) : (
              <EventTable key={`e${i}`} events={g.events} />
            ),
          )}
        </div>
        {groups.length > shown && (
          <div className="border-t border-line px-5 py-3">
            <Button variant="secondary" onClick={() => setShown(shown + SHOW)}>Show more events</Button>
          </div>
        )}
      </section>
    </div>
  );
}

function AutoList({ events }: { events: AuditEvent[] }) {
  const [n, setN] = useState(100);
  return (
    <div>
      <EventTable events={events.slice(0, n)} />
      {events.length > n && (
        <div className="border-t border-line px-5 py-3">
          <Button variant="quiet" onClick={() => setN(n + 200)}>Show more of these {events.length.toLocaleString("en-IN")} records</Button>
        </div>
      )}
    </div>
  );
}
