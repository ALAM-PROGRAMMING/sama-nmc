import Link from "next/link";
import { ruleTitle } from "@/engine/explain";
import type { RuleId } from "@/engine/types";
import { ButtonLink } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { HonestyBadge } from "@/components/HonestyBadge";
import { CheckIcon, CrossIcon, PlayIcon } from "@/components/Icons";
import { Panel } from "@/components/Panel";

const CURRENT = [
  "Runs locally in your browser. Nothing you load is sent to a server.",
  "Synthetic sample data: three demo companies, not real organisations.",
  "A demo audit trail: a tamper-evident chain kept in this browser tab only.",
  "Engineering tables are unverified drafts that no engineer has reviewed.",
];
const FUTURE = [
  "On-premise deployment inside the organisation.",
  "Engineering tables reviewed and signed off by engineers.",
  "SAP integration, to read materials and write identities back.",
  "Larger data volumes than this demo accepts (3,000 rows).",
  "Role-based access for analysts, engineers and administrators.",
  "A server-side ledger that keeps decisions permanently.",
];

const STEPS = [
  { t: "Understand", d: "Each description is read and cleaned up: abbreviations are expanded and the material class is found. Size, pressure class, material, face and other attributes are pulled out of the text." },
  { t: "Compare every attribute", d: "Two records are compared attribute by attribute. Each one is SAME, DIFFERENT, TOO VAGUE or MISSING. A missing value is never guessed." },
  { t: "Safety rules", d: "Nine fixed rules (below) look for anything that makes a merge unsafe. A critical difference blocks the merge. Anything vague, missing or risky goes to an engineer." },
  { t: "Gate score", d: "A frozen scoring model rates pairs the rules leave open. A very low score is rejected, and only a standard (Tier E) pair with a high score can become verified. It can never override a rule." },
  { t: "Engineer approval", d: "Engineered items (Tier R) and every doubtful pair wait for a person. Tier R needs two approvals, one from an engineer. Every decision is written to the audit trail." },
];

const RULES: Array<{ id: RuleId; effect: string }> = [
  { id: "R-01", effect: "Blocks the merge. These are different items." },
  { id: "R-02", effect: "Sent to an engineer. One record only gives the family, not the exact grade." },
  { id: "R-03", effect: "Sent to an engineer. The system does not guess a missing value." },
  { id: "R-04", effect: "Sent to an engineer. Unexplained words could change what the item is." },
  { id: "R-05", effect: "Always sent to an engineer. A risk word signals critical service." },
  { id: "R-06", effect: "Sent to an engineer. A value was read that the system does not recognise." },
  { id: "R-07", effect: "Strong proof of the same item. Can be verified without a person, unless another rule objects." },
  { id: "R-08", effect: "Sent to an engineer. A small suffix can mean a different product." },
  { id: "R-09", effect: "Sent to an engineer until the size table is verified." },
];

const GLOSSARY: Array<[string, string]> = [
  ["CPSE", "Central Public Sector Enterprise: a government-owned company, such as CPCL."],
  ["NMC", "National Material Code: one permanent national identity for a material. Format NMC:CCCC-NNNNNNN-K, with a check digit."],
  ["Crosswalk", "The list that links each company's own legacy code to the one NMC. Nothing is renumbered or erased."],
  ["Tier R / Tier E", "Tier R is an engineered item: a person always checks it, with two approvals. Tier E is a standard item: one approval is enough when a person is needed."],
  ["GENERIC", "A material outside the currently templated classes. GENERIC items are review only and are never auto-merged."],
  ["Look-alike", "Two records that read almost the same but are different items, for example Class 150 and Class 300. SAMA-NMC refuses to merge them."],
  ["Trap twin", "A pair built on purpose to look identical while one critical detail differs. The benchmark uses them to test whether a matcher is fooled."],
];

const NOT = [
  "No live SAP connection. The demo reads a CSV file only.",
  "No real CPSE data. The sample is synthetic and the benchmark is generated.",
  "The benchmark numbers are measurements on synthetic data, not a promise for real data.",
  "The engineering tables are unverified drafts. Decisions that depend on them are sent to review.",
  "The audit trail lives in your browser tab and disappears when it closes. It is a demonstration, not a legal record.",
];

export function AboutView() {
  return (
    <div className="max-w-[1000px] space-y-8">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px]">About this demo</h1>
          <HonestyBadge kind="DEMO" />
        </div>
        <p className="mt-2 max-w-[720px] text-[17px] text-ink-2">
          SAMA-NMC links the different codes that CPSEs use for the same material to one national identity, and it is built to stop a wrong merge before it happens. Smart India Hackathon SIH26099, MoPNG / CPCL.
        </p>
        <p className="mt-4 font-cond text-[24px] font-semibold leading-snug text-navy">AI proposes. Rules constrain. Engineers approve. The ledger remembers.</p>
      </div>

      <section aria-labelledby="cf-h" className="space-y-3">
        <h2 id="cf-h" className="text-xl">Current demo and future pilot</h2>
        <div className="grid gap-px overflow-hidden rounded-ctl border border-line bg-line md:grid-cols-2">
          <div className="bg-white p-5">
            <div className="eyebrow text-blue-700">Current demo</div>
            <ul className="m-0 mt-3 list-none space-y-2 p-0 text-sm text-ink">
              {CURRENT.map((t) => (
                <li key={t} className="flex gap-2"><CheckIcon size={15} className="mt-0.5 shrink-0 text-blue-600" />{t}</li>
              ))}
            </ul>
          </div>
          <div className="bg-canvas p-5">
            <div className="eyebrow">Future pilot</div>
            <ul className="m-0 mt-3 list-none space-y-2 p-0 text-sm text-ink">
              {FUTURE.map((t) => (
                <li key={t} className="flex gap-2"><span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-dashed border-ink-3" aria-hidden="true" />{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="how-h" className="space-y-3">
        <h2 id="how-h" className="text-xl">How decisions are made</h2>
        <ol className="m-0 grid list-none gap-px overflow-hidden rounded-ctl border border-line bg-line p-0 md:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.t} className="bg-white p-4">
              <span className="flex h-7 w-7 items-center justify-center rounded-tbl bg-navy font-cond text-base font-bold text-white">{i + 1}</span>
              <h3 className="mt-2.5 text-lg leading-tight">{s.t}</h3>
              <p className="mt-1.5 text-sm text-ink-2">{s.d}</p>
            </li>
          ))}
        </ol>

        <Panel title="The nine safety rules" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <caption className="sr-only">The nine safety rules and what each one does</caption>
              <thead>
                <tr className="border-b border-line-strong bg-canvas text-xs text-ink-2">
                  <th scope="col" className="w-20 px-5 py-2 font-semibold">Rule</th>
                  <th scope="col" className="w-[260px] px-3 py-2 font-semibold">In plain words</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Effect</th>
                </tr>
              </thead>
              <tbody>
                {RULES.map((r) => (
                  <tr key={r.id} className="border-b border-line align-top last:border-b-0">
                    <td className="px-5 py-2.5 font-mono text-xs font-semibold text-ink-2">{r.id}</td>
                    <td className="px-3 py-2.5 font-semibold text-ink">{ruleTitle(r.id)}</td>
                    <td className="px-3 py-2.5 text-ink-2">{r.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <section aria-labelledby="gl-h" className="space-y-3">
        <h2 id="gl-h" className="text-xl">Glossary</h2>
        <dl className="m-0 grid gap-px overflow-hidden rounded-ctl border border-line bg-line sm:grid-cols-2">
          {GLOSSARY.map(([t, d]) => (
            <div key={t} className="bg-white px-4 py-3">
              <dt className="font-semibold text-navy">{t}</dt>
              <dd className="m-0 mt-0.5 text-sm text-ink-2">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="not-h" className="space-y-3">
        <h2 id="not-h" className="text-xl">What SAMA-NMC does not claim</h2>
        <Callout tone="attention">
          <ul className="m-0 list-none space-y-1.5 p-0">
            {NOT.map((t) => (
              <li key={t} className="flex gap-2"><CrossIcon size={15} className="mt-0.5 shrink-0 text-orange-500" />{t}</li>
            ))}
          </ul>
        </Callout>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <ButtonLink href="/sample" size="lg"><PlayIcon size={14} /> Try with sample data</ButtonLink>
        <ButtonLink href="/upload" variant="secondary" size="lg">Upload your CSV</ButtonLink>
        <Link href="/analytics" className="text-sm font-semibold">See the benchmark</Link>
      </div>
    </div>
  );
}
