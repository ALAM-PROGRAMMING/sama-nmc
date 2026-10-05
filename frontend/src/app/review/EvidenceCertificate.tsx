"use client";
import { useMemo, useState, type ReactNode } from "react";
import { attributeLabel, prettyValue, ruleTitle, stateWord } from "@/engine/explain";
import { buildCertificate } from "@/engine/certificate";
import type { CertificateRecord, EvidenceCertificate as Cert, MasterState } from "@/engine/types";
import { Button } from "@/components/Button";
import { DownloadIcon, FileIcon } from "@/components/Icons";
import { HonestyBadge } from "@/components/HonestyBadge";
import { NmcCode } from "@/components/NmcCode";
import { certificateIdFor, formatWhen } from "@/lib/review";
import { fmtPct, fmtScore } from "@/lib/format";
import { useBenchmark } from "@/lib/useBenchmark";

const STATUS_WORD: Record<Cert["decision"]["status"], string> = { approved: "Approved", rejected: "Rejected", pending_review: "Pending review" };
const ZONE_WORD: Record<Cert["decision"]["zone"], string> = { AUTO_MERGE: "AUTO (verified)", REVIEW: "REVIEW", REJECT: "REJECT" };
const SCOPE_WORD: Record<string, string> = { synthetic: "Synthetic", unseen_noise: "Unseen noise", real_labelled: "Real-labelled" };

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`cert-h${n}`} className="break-inside-avoid border-t border-line px-5 py-4 first:border-t-0">
      <h3 id={`cert-h${n}`} className="text-base">
        <span className="mr-2 font-mono text-sm text-ink-3">{n}.</span>
        {title}
      </h3>
      <div className="mt-2 text-sm text-ink">{children}</div>
    </section>
  );
}

const mono = "font-mono text-xs break-all";

function tokenSpan(rec: CertificateRecord, span: [number, number] | null): string {
  if (!span) return "no span";
  const toks = rec.normalized.split(/\s+/).filter(Boolean);
  return `tokens ${span[0] + 1}–${span[1]}: "${toks.slice(span[0], span[1]).join(" ")}"`;
}

function RecordAttributes({ rec, label }: { rec: CertificateRecord; label: string }) {
  const rows = Object.entries(rec.attributes);
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold text-ink-2">{label} · {rec.id}</div>
      {rows.length === 0 ? (
        <p className="mt-1 text-ink-3">No attributes were read from this record.</p>
      ) : (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line text-ink-3">
                <th scope="col" className="py-1 pr-3 font-semibold">Attribute</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Value</th>
                <th scope="col" className="py-1 pr-3 font-semibold">As written</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Rule</th>
                <th scope="col" className="py-1 font-semibold">Where in the text</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, a]) => (
                <tr key={k} className="border-b border-line last:border-b-0">
                  <th scope="row" className="py-1 pr-3 text-left font-semibold">{attributeLabel(k)}</th>
                  <td className="py-1 pr-3">{a.value ? prettyValue(k, a.value) : "not recognised"}</td>
                  <td className="py-1 pr-3 font-mono">{a.raw_value ?? "—"}</td>
                  <td className="py-1 pr-3 font-mono">{a.rule_id}</td>
                  <td className="py-1 font-mono">{tokenSpan(rec, a.span)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function download(cert: Cert) {
  const blob = new Blob([JSON.stringify(cert, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${cert.certificate_id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function EvidenceCertificate({ master, decisionId, onClose }: { master: MasterState; decisionId: string; onClose: () => void }) {
  const benchmark = useBenchmark();
  // the issue time is the moment the certificate is opened; it stays put while the page stays open
  const [issued] = useState(() => ({ id: certificateIdFor(decisionId), now: new Date().toISOString() }));
  const cert = useMemo(
    () => buildCertificate(master, decisionId, { now: issued.now, certificate_id: issued.id, benchmark: benchmark ?? null }),
    [master, decisionId, issued, benchmark],
  );
  const [a, b] = cert.records;
  const demo = cert.data_label === "DEMO SAMPLE DATA";
  const tables = Object.entries(cert.config_status);

  return (
    <section id="evidence" aria-labelledby="cert-title" className="cert-sheet rounded-ctl border-2 border-navy bg-white scroll-mt-28">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-canvas px-5 py-4">
        <div className="min-w-0">
          <div className="eyebrow">Evidence certificate</div>
          <h2 id="cert-title" className="mt-0.5 text-2xl">Why should I trust this decision?</h2>
          <div className="mt-1 font-mono text-xs text-ink-2">{cert.certificate_id} · schema {cert.schema_version} · run {cert.run_id}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`hatch-grey inline-flex items-center rounded-tbl border border-dashed border-ink-3 bg-white px-1.5 py-px font-mono text-xs font-medium uppercase tracking-wide text-ink-2`}
              data-testid="data-label"
            >
              {demo ? "DEMO SAMPLE DATA" : "UPLOADED DATA (processed locally in this browser)"}
            </span>
            <span className="text-xs text-ink-3">Issued {formatWhen(cert.issued_at)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="secondary" onClick={() => download(cert)}><DownloadIcon size={14} /> Download certificate (JSON)</Button>
          <Button variant="secondary" onClick={() => window.print()}><FileIcon size={14} /> Print</Button>
          <Button variant="quiet" onClick={onClose}>Hide evidence</Button>
        </div>
      </header>

      <Section n={1} title="Verdict">
        <dl className="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div><dt className="eyebrow">Zone</dt><dd className="m-0 font-semibold">{ZONE_WORD[cert.decision.zone]} · step {cert.decision.zone_step} of 9</dd></div>
          <div><dt className="eyebrow">Status</dt><dd className="m-0 font-semibold">{STATUS_WORD[cert.decision.status]}</dd></div>
          <div className="sm:col-span-2"><dt className="eyebrow">Plain reason</dt><dd className="m-0">{cert.decision.plain_reason}</dd></div>
          <div className="sm:col-span-2"><dt className="eyebrow">Engine detail</dt><dd className="m-0 text-ink-2">{cert.decision.reason}</dd></div>
          <div className="sm:col-span-2">
            <dt className="eyebrow">Approved by ({cert.decision.approvals.length} of {cert.decision.approvals_required} needed)</dt>
            <dd className="m-0">
              {cert.decision.approvals.length === 0 ? (
                <span className="text-ink-2">No one has approved this yet.</span>
              ) : (
                <ul className="m-0 list-none p-0">
                  {cert.decision.approvals.map((x, i) => (
                    <li key={i}><span className="font-semibold">{x.actor}</span> <span className="text-ink-2">({x.role}) · {formatWhen(x.at)}</span></li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </Section>

      <Section n={2} title="Records">
        <div className="grid gap-3 md:grid-cols-2">
          {[a, b].map((r, i) => (
            <div key={r.id} className="min-w-0 rounded-ctl border border-line px-3 py-2">
              <div className="eyebrow">Record {i === 0 ? "A" : "B"} · {r.cpse}</div>
              <div className="mt-1 text-xs text-ink-3">Record id</div>
              <div className={mono}>{r.id}</div>
              <div className="mt-1 text-xs text-ink-3">Legacy code</div>
              <div className="font-mono text-sm">{r.matnr}</div>
              <div className="mt-1 text-xs text-ink-3">As written</div>
              <div className="break-words font-medium">{r.raw}</div>
              <div className="mt-1 text-xs text-ink-3">Normalized</div>
              <div className={mono}>{r.normalized}</div>
              <div className="mt-1 text-xs text-ink-3">Class</div>
              <div>{r.class_code} · {r.class_name}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section n={3} title="Extracted attributes">
        <p className="text-ink-2">Each value the system read, the extraction rule that read it, and where in the normalized text it came from.</p>
        <RecordAttributes rec={a} label="Record A" />
        <RecordAttributes rec={b} label="Record B" />
      </Section>

      <Section n={4} title="Attribute states">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line text-ink-3">
                <th scope="col" className="py-1 pr-3 font-semibold">Attribute</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Record A</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Record B</th>
                <th scope="col" className="py-1 font-semibold">State</th>
              </tr>
            </thead>
            <tbody>
              {cert.comparison.map((r) => (
                <tr key={r.property} className="border-b border-line last:border-b-0">
                  <th scope="row" className="py-1 pr-3 text-left font-semibold">{r.critical ? "[critical] " : ""}{attributeLabel(r.property)}</th>
                  <td className="py-1 pr-3">{r.left ? prettyValue(r.property, r.left) : "not stated"}</td>
                  <td className="py-1 pr-3">{r.right ? prettyValue(r.property, r.right) : "not stated"}</td>
                  <td className="py-1 font-semibold">{stateWord(r.state)}<span className="ml-1 font-mono font-normal text-ink-3">({r.state}{r.via ? `, via ${r.via}` : ""})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section n={5} title="Rules fired (all nine)">
        <ul className="m-0 list-none space-y-0.5 p-0">
          {cert.rules.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-2">
              <span className="font-mono font-semibold">{r.id}</span>
              <span className="w-10 font-semibold">{r.fired ? "FIRED" : "pass"}</span>
              <span className="text-ink-2">{ruleTitle(r.id)}{r.fired && r.detail ? `: ${r.detail}` : ""}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section n={6} title="Scores">
        <p className="mb-2 text-ink-2">Model scores; rules decide. A score can only send a pair to a person or confirm what the rules already allow.</p>
        <dl className="m-0 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3"><dt>Gate score ({cert.gate_model})</dt><dd className="m-0 font-mono">{fmtScore(cert.scores.gate_score, 6)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Ordinary matcher score ({cert.text_model})</dt><dd className="m-0 font-mono">{fmtScore(cert.scores.baseline_score, 6)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Auto-merge threshold</dt><dd className="m-0 font-mono">{cert.scores.thr_E === null ? "not set" : fmtScore(cert.scores.thr_E, 6)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Reject threshold</dt><dd className="m-0 font-mono">{fmtScore(cert.scores.reject_thr, 6)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Ordinary matcher threshold</dt><dd className="m-0 font-mono">{fmtScore(cert.scores.t_base, 6)}</dd></div>
        </dl>
        {cert.scores.top_features.length > 0 && (
          <div className="mt-3">
            <div className="eyebrow">Top contributing features (gate model)</div>
            <ul className="m-0 mt-1 list-none space-y-0.5 p-0 font-mono text-xs">
              {cert.scores.top_features.map(([name, c]) => (
                <li key={name}>{name}: {c > 0 ? "+" : ""}{c}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section n={7} title="Tier and reasons">
        <p><span className="font-semibold">Tier {cert.tier.value}</span> {cert.tier.value === "R" ? "(engineered item: an engineer always checks it)" : "(standard item)"}</p>
        <ul className="m-0 mt-1 list-disc pl-5 font-mono text-xs">
          {cert.tier.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </Section>

      <Section n={8} title="Identity">
        {cert.identity.nmc ? (
          <>
            <NmcCode code={cert.identity.nmc} size="lg" />
            <div className="eyebrow mt-3">Crosswalk</div>
            <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
              {cert.identity.crosswalk.map((c) => (
                <li key={`${c.cpse}:${c.matnr}`}><span className="text-ink-2">{c.cpse}</span> <span className="font-mono">{c.matnr}</span></li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-ink-2">These two records do not share a national code (NMC).</p>
        )}
      </Section>

      <Section n={9} title="Configuration and table status">
        <p className="font-mono text-xs">config {cert.config_version}</p>
        <ul className="m-0 mt-2 grid list-none gap-1 p-0 sm:grid-cols-2">
          {tables.map(([t, s]) => (
            <li key={t} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{t}</span>
              {s === "reviewed" ? <span className="text-xs font-semibold text-teal-700">reviewed</span> : <><HonestyBadge kind="UNVERIFIED TABLE" /><span className="text-xs text-ink-3">{s}</span></>}
            </li>
          ))}
        </ul>
      </Section>

      <Section n={10} title="Measured precision">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line text-ink-3">
                <th scope="col" className="py-1 pr-3 font-semibold">Evidence</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Auto-merges (n)</th>
                <th scope="col" className="py-1 pr-3 font-semibold">False merges</th>
                <th scope="col" className="py-1 font-semibold">95% upper bound</th>
              </tr>
            </thead>
            <tbody>
              {cert.measured_precision.map((m) => (
                <tr key={m.evidence_scope} className="border-b border-line last:border-b-0">
                  <th scope="row" className="py-1 pr-3 text-left font-semibold">{SCOPE_WORD[m.evidence_scope] ?? m.evidence_scope}</th>
                  {m.n === null ? (
                    <td colSpan={3} className="py-1 text-ink-3">{m.note ?? "not yet measured"}</td>
                  ) : (
                    <>
                      <td className="py-1 pr-3 font-mono">{m.n.toLocaleString("en-IN")}</td>
                      <td className="py-1 pr-3 font-mono">{m.false_merges}</td>
                      <td className="py-1 font-mono">{fmtPct(m.upper_bound_95)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-2">These are benchmark measurements on synthetic data, not production guarantees.</p>
      </Section>

      <Section n={11} title="Limitations">
        <ul className="m-0 list-disc space-y-1 pl-5">
          {cert.limitations.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </Section>

      <Section n={12} title="Audit reference">
        {cert.audit ? (
          <>
            <p>Event #{cert.audit.seq} in the local demonstration audit trail.</p>
            <div className="eyebrow mt-2">SHA-256 hash (64 characters)</div>
            <div className="mt-0.5 break-all rounded-ctl border border-line bg-canvas px-2 py-1.5 font-mono text-xs" data-testid="audit-hash">{cert.audit.hash}</div>
            <p className="mt-2 text-xs text-ink-3">{cert.audit.note}</p>
          </>
        ) : (
          <p className="text-ink-2">No audit event was found for this decision.</p>
        )}
      </Section>
    </section>
  );
}
