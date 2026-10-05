"use client";
import Link from "next/link";
import { useState } from "react";
import { attributeLabel, explainDecision, prettyValue, ruleSentence, ruleTitle, stateTone, stateWord } from "@/engine/explain";
import type { CompareRow, Decision, MasterState, RecordView, RuleId } from "@/engine/types";
import { CheckIcon, ChevronIcon, CircleIcon, CrossIcon, FlagIcon, LockIcon, PendingIcon } from "@/components/Icons";
import { NmcCode } from "@/components/NmcCode";
import { decidingRules, outcomeWord, POLICY_TITLE, stepWords } from "@/lib/review";

// ------------------------------------------------------------------ record cards
export function RecordCard({ label, rec, nmc }: { label: string; rec: RecordView; nmc: string | null }) {
  return (
    <section aria-label={`${label}: ${rec.cpse}`} className="min-w-0 rounded-ctl border border-line bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 border-b border-line px-4 py-2.5">
        <h2 className="text-lg leading-tight">
          <span className="eyebrow mr-2 align-middle">{label}</span>
          {rec.cpse}
        </h2>
        <span className="text-xs text-ink-3">{rec.class_code === "9999" ? "GENERIC" : rec.class_name}</span>
      </div>
      <dl className="m-0 space-y-3 px-4 py-3 text-sm">
        <div>
          <dt className="eyebrow">Legacy code</dt>
          <dd className="m-0 mt-0.5 font-mono text-[15px] font-medium text-ink">{rec.matnr}</dd>
        </div>
        <div>
          <dt className="eyebrow">Description as written</dt>
          <dd className="m-0 mt-0.5 break-words text-[15px] font-medium text-ink">{rec.raw}</dd>
        </div>
        <div>
          <dt className="eyebrow">How the system read it</dt>
          <dd className="m-0 mt-0.5 break-words font-mono text-xs text-ink-2">{rec.normalized}</dd>
        </div>
        {(rec.mfr || rec.mpn) && (
          <div>
            <dt className="eyebrow">Manufacturer</dt>
            <dd className="m-0 mt-0.5 text-ink-2">
              {rec.mfr || "not stated"}
              {rec.mpn && <> · part no. <span className="font-mono">{rec.mpn}</span></>}
            </dd>
          </div>
        )}
        <div>
          <dt className="eyebrow">National code now</dt>
          <dd className="m-0 mt-0.5">
            {nmc ? (
              <Link href={`/registry?code=${encodeURIComponent(nmc)}`} className="no-underline hover:underline">
                <NmcCode code={nmc} size="sm" />
              </Link>
            ) : (
              <span className="text-ink-3">None yet. Waiting on an open review.</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ------------------------------------------------------------------ attribute table
function StateCell({ row }: { row: CompareRow }) {
  const tone = stateTone(row.state);
  const word = stateWord(row.state);
  const icon =
    tone === "same" ? <CheckIcon size={16} className="text-teal-500" />
    : tone === "different" ? <CrossIcon size={16} className="text-red-500" />
    : tone === "vague" ? <FlagIcon size={16} className="text-orange-500" />
    : tone === "missing" ? <PendingIcon size={16} className="text-orange-500" />
    : <CircleIcon size={16} className="text-ink-3" />;
  const color = tone === "same" ? "text-teal-700" : tone === "different" ? "text-red-700" : tone === "vague" || tone === "missing" ? "text-amber-800" : "text-ink-3";
  const chain = row.ancestor_chain ?? [];
  let note: string | null = null;
  if (row.state === "less_specific") {
    if (row.via === "both_family") note = "both state only the family";
    else if (chain.length > 1) note = `${chain[0]} is the family of ${chain[chain.length - 1]}`;
  }
  if (row.via === "size_table") note = "via size table";
  return (
    <div title={`engine state: ${row.state}`}>
      <span className={`inline-flex items-center gap-1.5 text-xs font-bold tracking-wide ${color}`}>
        {icon}
        {word}
      </span>
      {note && <div className="mt-0.5 text-xs font-normal text-ink-3">{note}</div>}
    </div>
  );
}

export function AttributeTable({ d, a, b }: { d: Decision; a: RecordView; b: RecordView }) {
  const val = (prop: string, v: string | null) =>
    v === null || v === "" ? <span className="italic text-ink-3">not stated</span> : <>{prettyValue(prop, v)}</>;
  return (
    <section aria-labelledby="attr-h" className="rounded-ctl border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 id="attr-h" className="text-lg">Attribute by attribute</h2>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
          <LockIcon size={14} className="text-navy" /> critical: a difference here means a different item
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-ink-3">
              <th scope="col" className="px-4 py-2 font-semibold">Attribute</th>
              <th scope="col" className="px-3 py-2 font-semibold">Record A · {a.cpse}</th>
              <th scope="col" className="px-3 py-2 font-semibold">Record B · {b.cpse}</th>
              <th scope="col" className="px-3 py-2 font-semibold">State</th>
            </tr>
          </thead>
          <tbody>
            {d.comparison.map((r) => {
              const tone = stateTone(r.state);
              const exception = tone === "different" || tone === "vague" || tone === "missing";
              const bar = !exception ? "border-l-transparent" : tone === "different" ? "border-l-red-500 bg-red-50" : "border-l-orange-500 bg-amber-50";
              const recede = tone === "same" || tone === "neutral";
              return (
                <tr key={r.property} className={`border-b border-line border-l-4 last:border-b-0 ${bar} ${!r.critical && !exception ? "bg-canvas" : ""}`}>
                  <th scope="row" className="px-4 py-2.5 text-left align-top font-semibold">
                    <span className={`inline-flex items-center gap-1.5 ${recede || !r.critical ? "text-ink-2" : "text-ink"}`}>
                      {r.critical ? (
                        <>
                          <LockIcon size={14} className="text-navy" aria-hidden="true" />
                          <span className="sr-only">Critical attribute: </span>
                        </>
                      ) : (
                        <span className="w-[14px]" aria-hidden="true" />
                      )}
                      {attributeLabel(r.property)}
                    </span>
                    {!r.critical && <span className="ml-5 block text-xs font-normal text-ink-3">not critical</span>}
                  </th>
                  <td className={`px-3 py-2.5 align-top ${recede ? "text-ink-3" : "font-semibold text-ink"}`}>{val(r.property, r.left)}</td>
                  <td className={`px-3 py-2.5 align-top ${recede ? "text-ink-3" : "font-semibold text-ink"}`}>{val(r.property, r.right)}</td>
                  <td className="px-3 py-2.5 align-top"><StateCell row={r} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ why panel
export function RuleChip({ id }: { id: RuleId }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-tbl border border-navy bg-navy px-2 py-0.5 text-sm font-semibold text-white">
      <span className="font-mono">{id}</span>
      <span aria-hidden="true">·</span>
      {ruleTitle(id)}
    </span>
  );
}

export function WhyPanel({ d }: { d: Decision }) {
  const ex = explainDecision(d);
  const deciding = decidingRules(d);
  const [open, setOpen] = useState<RuleId | null>(null);
  const outcome = outcomeWord(d.zone);
  const ocolor = d.zone === "AUTO_MERGE" ? "border-teal-200 bg-teal-50 text-teal-700" : d.zone === "REVIEW" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700";
  const oicon = d.zone === "AUTO_MERGE" ? <CheckIcon size={14} className="text-teal-500" /> : d.zone === "REVIEW" ? <FlagIcon size={14} className="text-orange-500" /> : <CrossIcon size={14} className="text-red-500" />;
  const aheadOfBaseline = d.baseline_zone === "AUTO_MERGE" && d.zone !== "AUTO_MERGE";
  return (
    <section aria-labelledby="why-h" className="rounded-ctl border border-line border-l-4 border-l-navy bg-white">
      <div className="border-b border-line px-4 py-2.5">
        <h2 id="why-h" className="text-lg">Why the system decided this</h2>
      </div>
      <div className="space-y-4 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-1">Deciding rule</span>
          {deciding.length ? (
            deciding.map((id) => <RuleChip key={id} id={id} />)
          ) : (
            <span className="inline-flex items-center rounded-tbl border border-navy bg-navy px-2 py-0.5 text-sm font-semibold text-white">
              Step {d.zone_step} · {POLICY_TITLE[d.zone_step] ?? "Safety policy"}
            </span>
          )}
          <span className={`inline-flex items-center gap-1.5 rounded-tbl border px-2 py-0.5 text-xs font-bold tracking-wide ${ocolor}`} aria-label={`Outcome: ${outcome}`}>
            {oicon}
            <span className="font-normal">Outcome</span> {outcome}
          </span>
        </div>
        <p className="text-sm text-ink-2">
          <span className="font-semibold text-ink">Zone step {d.zone_step} of 9.</span> {stepWords(d.zone_step)}
        </p>
        <ul className="m-0 list-none space-y-2 p-0 text-[15px] text-ink">
          {ex.bullets.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-navy" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
        {aheadOfBaseline && (
          <p className="rounded-ctl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-ink">
            An ordinary text-similarity matcher scores this pair {d.baseline_score.toFixed(3)} and would auto-merge it. The safety rules stopped it.{" "}
            <span className="text-ink-3">(Model scores; rules decide.)</span>
          </p>
        )}
        <div className="pt-1">
          <div className="eyebrow mb-2">The nine safety rules for this pair</div>
          <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-3">
            {d.rules.map((r) => {
              const isOpen = open === r.id;
              return (
                <li key={r.id} className="min-w-0">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : r.id)}
                    className={`flex w-full items-start gap-2 rounded-ctl border px-2.5 py-2 text-left text-xs ${
                      r.fired ? "border-navy bg-blue-50 text-ink" : "border-line bg-white text-ink-3 hover:bg-canvas"
                    }`}
                  >
                    <ChevronIcon size={12} className={`mt-0.5 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    <span className="min-w-0">
                      <span className="block font-mono font-semibold">
                        {r.id} <span className={r.fired ? "font-sans text-navy" : "font-sans"}>{r.fired ? "FIRED" : "clear"}</span>
                      </span>
                      <span className="block font-sans">{ruleTitle(r.id)}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <p className="mt-1 rounded-ctl bg-canvas px-2.5 py-2 text-xs text-ink-2">
                      {r.fired ? ruleSentence(r, d) : `${ruleTitle(r.id)} did not apply to this pair.`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function identityOf(master: MasterState, d: Decision): { code: string | null; members: RecordView[] } {
  const nl = master.record_nmc[d.left] ?? null;
  const nr = master.record_nmc[d.right] ?? null;
  const code = nl !== null && nl === nr ? nl : null;
  const entry = code ? master.nmcs.find((n) => n.code === code) : undefined;
  const byId = new Map(master.run.records.map((r) => [r.id, r]));
  return { code, members: entry ? entry.members.map((m) => byId.get(m)).filter((x): x is RecordView => !!x) : [] };
}
