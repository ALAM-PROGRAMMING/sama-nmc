"use client";
import Link from "next/link";
import { useState } from "react";
import type { Decision, MasterState, ReasonCode, ReviewOutcome, RuleId } from "@/engine/types";
import { useRunStore } from "@/state/runStore";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { NmcCode } from "@/components/NmcCode";
import { PersonaSwitch } from "@/components/PersonaSwitch";
import { StatusPill } from "@/components/StatusPill";
import { decidingRules, formatWhen, humanState, HUMAN_PILL, needsEngineer, REASON_OPTIONS, reasonLabel } from "@/lib/review";
import { identityOf } from "./parts";

const SUGGESTED: Partial<Record<RuleId, ReasonCode>> = {
  "R-01": "CRIT_CONFLICT",
  "R-02": "LESS_SPECIFIC_UNRESOLVED",
  "R-03": "INSUFFICIENT_INFO",
  "R-04": "RESIDUAL_DIFFERENCE",
  "R-08": "DIFFERENT_MFR_PART",
};

const SAFETY_NOTE = "Reviewer decisions improve review prioritization. Safety rules remain fixed.";

export function ReviewActions({ master, d }: { master: MasterState; d: Decision }) {
  const actor = useRunStore((s) => s.actor);
  const setActor = useRunStore((s) => s.setActor);
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<ReasonCode>(() => SUGGESTED[decidingRules(d)[0]] ?? "OTHER");

  if (d.kind === "verified") {
    return (
      <Callout tone="good" title="Verified automatically by the rules">
        No approval is needed, so there is no Approve button. Every critical attribute agrees (or the manufacturer part number matches) and no safety rule fired.
      </Callout>
    );
  }
  if (d.kind === "lookalike") {
    return (
      <Callout tone="attention" title="Rejected by the safety rules">
        There is no Approve button on purpose. Rejected pairs are never merged, and a person cannot override a critical difference.
      </Callout>
    );
  }

  const item = master.reviews[d.id];
  if (!item) return null;
  const hstate = humanState(master, d);
  const pill = HUMAN_PILL[hstate];
  const done = item.status !== "open";
  const blocked = hstate === "blocked";
  const mine = item.approvals.some((a) => a.actor === actor);
  const other = actor === "Demo analyst" ? "Demo engineer" : "Demo analyst";
  const identity = identityOf(master, d);

  const act = (action: "approve" | "reject") => {
    const out = useRunStore.getState().review(d.id, action, action === "reject" ? reason : undefined);
    setOutcome(out);
    if (out?.ok && action === "reject") setRejecting(false);
  };

  return (
    <section aria-labelledby="act-h" className="rounded-ctl border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 id="act-h" className="text-lg">Your decision</h2>
        <PersonaSwitch />
      </div>
      <div className="space-y-4 px-4 py-4">
        <dl className="m-0 grid gap-3 sm:grid-cols-2">
          <div className="rounded-ctl border border-line bg-canvas px-3 py-2">
            <dt className="eyebrow">Engine decision (never changed)</dt>
            <dd className="m-0 mt-1 text-sm font-semibold text-ink">REVIEW · zone step {d.zone_step}</dd>
          </div>
          <div className="rounded-ctl border border-line bg-canvas px-3 py-2">
            <dt className="eyebrow">Human decision</dt>
            <dd className="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm">
              <StatusPill kind={pill.kind} label={pill.label} />
              {item.status === "rejected" && item.rejection && (
                <span className="text-ink-2">{item.rejection.actor} · {reasonLabel(item.rejection.reason_code)}</span>
              )}
            </dd>
          </div>
        </dl>

        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-semibold text-ink" data-testid="approval-progress">
              Approval {item.approvals.length} of {item.approvals_required}
            </span>
            {item.approvals_required === 2 ? (
              <span className="text-sm text-ink-2">an engineer must give the final approval</span>
            ) : (
              <span className="text-sm text-ink-2">one approval is enough for a standard item (Tier E)</span>
            )}
          </div>
          <div className="mt-2 flex gap-1.5" aria-hidden="true">
            {Array.from({ length: item.approvals_required }).map((_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${i < item.approvals.length ? "bg-navy" : "bg-line-strong"}`} />
            ))}
          </div>
          {item.approvals.length > 0 && (
            <ul className="mt-2 list-none space-y-0.5 p-0 text-sm text-ink-2">
              {item.approvals.map((a, i) => (
                <li key={i}>
                  Approved by <span className="font-semibold text-ink">{a.actor}</span> · {formatWhen(a.at)}
                </li>
              ))}
            </ul>
          )}
        </div>

        {item.status === "open" && (
          <>
            {mine && (
              <Callout tone="info" title={`${actor} has already approved this link`}>
                A second, different role has to give the next approval.{" "}
                <button type="button" onClick={() => setActor(other)} className="font-semibold text-blue-700 underline underline-offset-2">
                  Switch to {other}
                </button>
              </Callout>
            )}
            {!mine && needsEngineer(item) && item.approvals.length > 0 && actor !== "Demo engineer" && (
              <Callout tone="info" title="Waiting for an engineer">
                <button type="button" onClick={() => setActor("Demo engineer")} className="font-semibold text-blue-700 underline underline-offset-2">
                  Switch to Demo engineer
                </button>{" "}
                to give the final approval.
              </Callout>
            )}
          </>
        )}

        {(item.status === "open" || blocked) && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {item.status === "open" && <Button onClick={() => act("approve")}>Approve as {actor}</Button>}
              {!rejecting && (
                <Button variant="secondary" onClick={() => setRejecting(true)} aria-expanded={rejecting}>
                  {blocked ? "Reject this link" : "Reject"}
                </Button>
              )}
            </div>
            {rejecting && (
              <fieldset className="m-0 rounded-ctl border border-line-strong bg-canvas p-3">
                <legend className="px-1 text-sm font-semibold text-ink">Why are you rejecting this link?</legend>
                <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                  {REASON_OPTIONS.map((r) => (
                    <label key={r.code} className="flex cursor-pointer items-center gap-2 rounded-ctl border border-line bg-white px-2.5 py-1.5 text-sm has-[:checked]:border-navy has-[:checked]:bg-blue-50">
                      <input type="radio" name="reason" value={r.code} checked={reason === r.code} onChange={() => setReason(r.code)} className="accent-[#17365D]" />
                      {r.label}
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => act("reject")}>Confirm reject as {actor}</Button>
                  <Button variant="quiet" onClick={() => setRejecting(false)}>Cancel</Button>
                </div>
              </fieldset>
            )}
          </div>
        )}

        {outcome && !outcome.blocked && (
          <div role="status">
            <Callout tone={outcome.ok ? (outcome.blocked ? "attention" : "info") : "attention"} title={outcome.ok ? undefined : "That did not go through"}>
              {outcome.ok ? outcome.message : outcome.error ?? outcome.message}
            </Callout>
          </div>
        )}

        {blocked && item.blocked && (
          <Callout tone="attention" title="Approved, but the system refused to join these records">
            Each link looked fine on its own, but joining them would put two different grades under one national code. The system refuses; an engineer can reject the link.
            <span className="mt-2 block text-xs text-ink-2">
              Safety check ({item.blocked.offending.rule}): {item.blocked.reason}
            </span>
          </Callout>
        )}

        {item.status === "approved" && !blocked && (
          <div className="rounded-ctl border border-teal-200 bg-teal-50 px-4 py-3" data-testid="identity-result">
            {identity.code ? (
              <>
                <div className="text-sm font-semibold text-teal-700">These records now share NMC:</div>
                <div className="mt-1"><NmcCode code={identity.code} size="lg" /></div>
                <div className="eyebrow mt-3">Crosswalk: legacy code to national code</div>
                <ul className="mt-1 list-none space-y-0.5 p-0 text-sm">
                  {identity.members.map((m) => (
                    <li key={m.id}>
                      <span className="text-ink-2">{m.cpse}</span> <span className="font-mono">{m.matnr}</span> <span aria-hidden="true">→</span> <span className="font-mono">{identity.code}</span>
                    </li>
                  ))}
                </ul>
                <Link href={`/registry?code=${encodeURIComponent(identity.code)}`} className="mt-3 inline-block text-sm font-semibold">
                  See in NMC Registry
                </Link>
              </>
            ) : (
              <div className="text-sm text-ink-2">Approved. No identity change was needed.</div>
            )}
          </div>
        )}

        {done && item.status === "rejected" && (
          <p className="text-sm text-ink-2">
            Rejected: these records stay separate{item.rejection ? ` (${reasonLabel(item.rejection.reason_code)}, ${formatWhen(item.rejection.at)})` : ""}.
          </p>
        )}

        <p className="text-xs text-ink-3">{SAFETY_NOTE}</p>
      </div>
    </section>
  );
}
