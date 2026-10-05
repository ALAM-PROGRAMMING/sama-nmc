"use client";
import Link from "next/link";
import { useMemo } from "react";
import { attributeLabel, prettyValue } from "@/engine/explain";
import { validateNmc } from "@/engine/nmc";
import type { MasterState } from "@/engine/types";
import { crosswalkFor } from "@/lib/registry";
import { fmtMoney } from "@/lib/format";
import { parseNmc } from "@/lib/nmc";
import { computeSavings } from "@/lib/savings";
import { ButtonLink } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { HonestyBadge } from "@/components/HonestyBadge";
import { ArrowRightIcon, CheckIcon, CrossIcon } from "@/components/Icons";
import { NmcCode } from "@/components/NmcCode";
import { Panel } from "@/components/Panel";
import { Stat } from "@/components/Stat";
import { StatusPill } from "@/components/StatusPill";
import { Term } from "@/components/Tooltip";

function NotFound({ code, supersededBy }: { code: string; supersededBy: string | null }) {
  return (
    <div className="space-y-5">
      <h1 className="text-[28px]">NMC Registry</h1>
      <EmptyState
        title={supersededBy ? "This identity was retired" : "We could not find that code"}
        action={
          <>
            <ButtonLink href="/registry">See all identities</ButtonLink>
            <ButtonLink href="/materials" variant="secondary">Back to Material Master</ButtonLink>
          </>
        }
      >
        {supersededBy ? (
          <>
            <span className="font-mono">{code}</span> was retired and replaced by{" "}
            <Link href={`/registry?code=${encodeURIComponent(supersededBy)}`} className="font-mono">{supersededBy}</Link>. Retired codes are never deleted or reused.
          </>
        ) : (
          <>
            No identity in this run has the code <span className="font-mono">{code}</span>. Check the spelling, or pick one from the list. Codes belong to the run you loaded, so a code from another run will not be found.
          </>
        )}
      </EmptyState>
    </div>
  );
}

export function NmcCard({ master, code }: { master: MasterState; code: string }) {
  const nmc = master.nmcs.find((n) => n.code === code);
  const view = useMemo(() => (nmc ? crosswalkFor(master, nmc) : null), [master, nmc]);
  const lens = useMemo(() => (view ? computeSavings(view.entries.map((e) => e.record)) : null), [view]);

  if (!nmc || !view) {
    const retired = master.retired.find((r) => r.code === code);
    return <NotFound code={code} supersededBy={retired?.superseded_by ?? null} />;
  }
  const run = master.run;
  const sample = run.scope === "sample";
  const parts = parseNmc(nmc.code);
  const valid = validateNmc(nmc.code);
  const original = run.nmcs.find((n) => n.code === nmc.code);
  const changed = !original ? "Created by a reviewer" : original.members.join("|") !== nmc.members.join("|") ? "Extended by a reviewer" : null;
  const className = view.entries[0]?.record.class_name ?? nmc.class_code;
  const golden = Object.entries(nmc.golden.attributes);
  const conflicts = Object.entries(nmc.golden.conflicts);

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <Link href="/registry" className="font-semibold">&larr; All identities</Link>
        <Link href="/materials" className="font-semibold">Back to Material Master</Link>
      </nav>

      <section aria-labelledby="nmc-h" className="rounded-ctl bg-navy px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="nmc-h" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-onnavy">National Material Code</h1>
          {nmc.kind === "cluster" ? <StatusPill kind="verified" label="Verified group" /> : <StatusPill kind="unique" label="Unique" />}
          {changed && <span className="rounded-tbl border border-blue-100 bg-blue-50 px-1.5 py-px text-xs font-semibold text-blue-700">{changed}</span>}
        </div>
        <div className="mt-3">
          <NmcCode code={nmc.code} size="xl" onDark />
        </div>
        {parts && (
          <dl className="m-0 mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-10">
            {[
              ["Authority", parts.authority, "who issues it"],
              ["Class", parts.classCode, className],
              ["Permanent serial", parts.serial, "never reused"],
              ["Check", parts.check, "catches typing errors"],
            ].map(([cap, val, sub]) => (
              <div key={cap}>
                <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-onnavy">{cap}</dt>
                <dd className="m-0 mt-0.5 font-mono text-[17px] font-semibold text-white">{val}</dd>
                <dd className="m-0 text-xs text-onnavy">{sub}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-5 flex items-center gap-2 text-sm text-white" role="status">
          {valid ? <CheckIcon size={16} className="shrink-0 text-teal-200" /> : <CrossIcon size={16} className="shrink-0 text-red-200" />}
          <span>
            <strong>{valid ? "Check digit valid" : "Check digit does not match"}</strong>
            <span className="text-onnavy"> · recomputed in this browser (ISO/IEC 7064 MOD 11-2)</span>
          </span>
        </p>
      </section>

      <Panel
        title={<>NMC + OLD-CODE <Term term="crosswalk" /></>}
        aside={sample ? <HonestyBadge kind="SYNTHETIC" /> : undefined}
        bodyClassName="p-0"
      >
        <p className="border-b border-line px-5 py-3 text-sm text-ink-2">
          One national identity, {view.entries.length === 1 ? "one legacy code" : `${view.entries.length} legacy codes`} from{" "}
          {new Set(view.entries.map((e) => e.record.cpse)).size}{" "}
          <Term term="CPSE">{new Set(view.entries.map((e) => e.record.cpse)).size === 1 ? "CPSE" : "CPSEs"}</Term>. Every company keeps its own code and its own original wording.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <caption className="sr-only">Crosswalk from legacy codes to this national code</caption>
            <thead>
              <tr className="border-b border-line-strong bg-canvas text-xs text-ink-2">
                <th scope="col" className="px-5 py-2 font-semibold"><Term term="CPSE" /></th>
                <th scope="col" className="px-3 py-2 font-semibold">Legacy code</th>
                <th scope="col" className="px-3 py-2 font-semibold">Original description</th>
                <th scope="col" className="px-3 py-2 font-semibold">Relation</th>
                <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2 font-semibold">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {view.entries.map(({ record, decision, how }) => (
                <tr key={record.id} className="border-b border-line align-top last:border-b-0">
                  <td className="px-5 py-3 font-mono text-xs text-ink-2">{record.cpse}</td>
                  <td className="px-3 py-3 font-mono text-[13px] text-ink">{record.matnr}</td>
                  <td className="px-3 py-3 text-ink">{record.raw}</td>
                  <td className="px-3 py-3"><span className="rounded-tbl border border-line-strong px-1.5 py-px font-mono text-xs font-semibold text-ink-2">IDENTICAL</span></td>
                  <td className="px-3 py-3">
                    {how === "unique" ? <StatusPill kind="unique" label="Unique" /> : <StatusPill kind="verified" label={how === "approved" ? "Approved by engineer" : "Verified"} />}
                  </td>
                  <td className="px-3 py-3">
                    {decision ? (
                      <Link href={`/review?d=${encodeURIComponent(decision.id)}`} className="inline-flex items-center gap-1 text-sm font-semibold">
                        View evidence <ArrowRightIcon size={12} />
                      </Link>
                    ) : (
                      <span className="text-xs text-ink-3">{how === "unique" ? "No match needed" : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Standard description (template)">
          <div className="eyebrow">Short text <span className="font-mono normal-case tracking-normal text-ink-3">· {[...nmc.short_text].length} of 40 characters</span></div>
          <p className="mt-1 font-mono text-[15px] text-ink">{nmc.short_text}</p>
          <div className="eyebrow mt-4">Long text</div>
          <p className="mt-1 text-sm text-ink">{nmc.long_text}</p>
          <p className="mt-3 text-xs text-ink-3">Written from the template of class {nmc.class_code} ({className}); the wording comes from the attributes on the right.</p>
        </Panel>
        <Panel title="Golden record (agreed attributes)">
          {golden.length === 0 ? (
            <p className="text-sm text-ink-2">This class has no attribute template yet, so there are no agreed attributes to show.</p>
          ) : (
            <dl className="m-0 divide-y divide-line">
              {golden.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
                  <dt className="text-ink-2">{attributeLabel(k)}</dt>
                  <dd className="m-0 text-right font-mono text-[13px] text-ink">{prettyValue(k, v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {conflicts.length > 0 && (
            <p className="mt-3 text-xs text-ink-3">
              Values that differed between members: {conflicts.map(([k, vs]) => `${attributeLabel(k)} (${vs.join(", ")})`).join("; ")}.
            </p>
          )}
        </Panel>
      </div>

      <Panel title="Evidence for this identity" bodyClassName="p-0">
        {view.evidence.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-2">
            {nmc.kind === "singleton" ? "This record matched no other record, so there is no pair to verify. It carries its own identity." : "No pair evidence is stored for this identity."}
          </p>
        ) : (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {view.evidence.map(({ decision, how }) => (
              <li key={decision.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5">
                <StatusPill kind="verified" label={how === "approved" ? "Approved by engineer" : "Verified"} />
                <span className="min-w-0 flex-1 font-mono text-xs text-ink-2">{decision.left} <span className="text-ink-3">and</span> {decision.right}</span>
                <Link href={`/review?d=${encodeURIComponent(decision.id)}`} className="inline-flex items-center gap-1 text-sm font-semibold">
                  Open the evidence <ArrowRightIcon size={12} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {lens && (
        <Panel
          title="Savings lens"
          aside={
            <span className="flex flex-wrap items-center gap-1.5">
              <HonestyBadge kind="ILLUSTRATIVE" />
              {sample ? <HonestyBadge kind="SYNTHETIC" /> : <span className="text-xs font-semibold text-ink-2">from your file</span>}
            </span>
          }
          bodyClassName="p-0"
        >
          <p className="border-b border-line px-5 py-3 text-sm text-ink-2">
            The same item, bought by different companies at different prices. This is a way of looking at the spread, not a forecast.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <caption className="sr-only">Prices per CPSE for this identity</caption>
              <thead>
                <tr className="border-b border-line-strong bg-canvas text-xs text-ink-2">
                  <th scope="col" className="px-5 py-2 font-semibold">CPSE</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Legacy code</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Last PO price</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Unit</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Annual qty</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Above lowest × qty</th>
                </tr>
              </thead>
              <tbody>
                {lens.rows.map((r) => (
                  <tr key={r.id} className={`border-b border-line align-top last:border-b-0 ${r.included ? "" : "text-ink-3"}`}>
                    <td className="px-5 py-2.5 font-mono text-xs">{r.cpse}</td>
                    <td className="px-3 py-2.5 font-mono text-[13px]">{r.matnr}</td>
                    <td className={`px-3 py-2.5 text-right tnum ${r.included ? "" : "line-through"}`}>{r.price === null ? "—" : fmtMoney(r.price)}</td>
                    <td className={`px-3 py-2.5 ${r.included ? "" : "line-through"}`}>{r.uom || "—"}</td>
                    <td className={`px-3 py-2.5 text-right tnum ${r.included ? "" : "line-through"}`}>{r.qty === null ? "—" : fmtMoney(r.qty)}</td>
                    <td className="px-3 py-2.5 text-right tnum">
                      {r.included ? (r.opportunity === null ? <span className="text-ink-3">no quantity</span> : fmtMoney(r.opportunity)) : <span className="text-xs">Left out: {r.reason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-4 sm:divide-y-0">
            <Stat value={fmtMoney(lens.min)} label="Lowest price" note={`per ${lens.basisUom}`} />
            <Stat value={fmtMoney(lens.max)} label="Highest price" note={`per ${lens.basisUom}`} />
            <Stat value={fmtMoney(lens.spread)} label="Spread" note={`${(lens.spreadPct * 100).toFixed(1)}% above the lowest`} />
            <Stat value={lens.pooledQty === null ? "—" : fmtMoney(lens.pooledQty)} label="Pooled annual quantity" note={lens.pooledQty === null ? "no quantity in the file" : lens.basisUom} />
          </div>
          <div className="border-t border-line bg-amber-50 px-5 py-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm font-semibold text-amber-800">Illustrative opportunity</span>
              <span className="font-cond text-[28px] font-bold leading-none text-navy tnum">{lens.opportunity === null ? "—" : fmtMoney(lens.opportunity)}</span>
              <span className="text-xs text-ink-2">per year, in the price unit of the file (no currency conversion)</span>
            </div>
            <p className="mt-2 font-mono text-[13px] text-ink">Σ (price − lowest price) × annual quantity, over the rows that share the unit {lens.basisUom}</p>
            <ul className="m-0 mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-2">
              <li>Only rows with a price and the same unit of measure are compared; the others are struck through above.</li>
              <li>It assumes every buyer could pay the lowest price listed here, at today&apos;s quantities. That is not guaranteed.</li>
              <li>Freight, volume discounts, delivery and quality differences are not included.</li>
              <li>{sample ? "Prices and quantities are synthetic demo values." : "Prices and quantities come from your file."}</li>
            </ul>
          </div>
        </Panel>
      )}
    </div>
  );
}
