/**
 * Evidence Certificate (schema 5.0): "why should I trust this decision?"
 * Nothing here is fabricated: reviewers are only the role personas that actually acted (from
 * master.reviews), `issued_at` is the time the caller passes, and `audit` points at the real chain
 * event the engine wrote for this decision.
 */
import { explainDecision } from "./explain";
import { getRegisteredAssets } from "./master";
import { pyCmp } from "./pyre";
import type {
  Actor, BenchmarkAsset, CertificateRecord, ConfigAsset, Decision, EngineAssets, EvidenceCertificate, MasterState, RecordView, Tier,
} from "./types";

export interface CertificateContext {
  now: string;
  certificate_id: string;
  benchmark?: BenchmarkAsset | null;
  /** Engine assets (for the top contributing features); defaults to the registered ones. */
  assets?: EngineAssets;
}

const AUTO_ACTOR = "SAMA-NMC rules (automatic)" as const;

function certRecord(v: RecordView): CertificateRecord {
  return {
    id: v.id, cpse: v.cpse, matnr: v.matnr, raw: v.raw, normalized: v.normalized, class_code: v.class_code, class_name: v.class_name,
    tier: v.tier, attributes: v.attributes, residuals: v.residuals, sanity_flags: v.sanity_flags, mfr: v.mfr, mpn: v.mpn,
  };
}

/** Config tables that shaped this decision (mirrors the tables_used bookkeeping of the Python extractor). */
function tablesUsed(d: Decision, a: RecordView, b: RecordView): string[] {
  const used = new Set<string>(["abbreviations", "units", "risk_words", "residual_vocab", "tiers"]);
  for (const v of [a, b]) {
    if (v.mfr) used.add("manufacturers");
    for (const attr of Object.values(v.attributes)) {
      if (attr.rule_id.startsWith("X-MAT")) used.add("hierarchies");
      if (attr.designation !== null) used.add("schedules");
    }
  }
  if (d.comparison.some((r) => r.via === "size_table")) used.add("schedules");
  return [...used].sort(pyCmp);
}

function topFeatures(d: Decision, assets: EngineAssets | null | undefined): Array<[string, number]> {
  if (!assets) return [];
  const g = assets.gate;
  const rows = g.features.map((name, i) => {
    const scale = Object.prototype.hasOwnProperty.call(g.feature_scaling ?? {}, name) ? g.feature_scaling[name] : 1;
    return { name, c: g.coef[i] * ((d.features[name] ?? 0) / scale) };
  });
  rows.sort((x, y) => Math.abs(y.c) - Math.abs(x.c));
  return rows.slice(0, 4).map((r): [string, number] => [r.name, Math.round(r.c * 1000) / 1000 + 0]);
}

function roleOf(actor: Actor): string {
  return actor === "Demo engineer" ? "Engineer" : "Analyst";
}

export function buildCertificate(master: MasterState, decisionId: string, ctx: CertificateContext): EvidenceCertificate {
  const run = master.run;
  const d = run.decisions.find((x) => x.id === decisionId);
  if (!d) throw new Error(`Decision ${decisionId} is not part of this run.`);
  const a = run.records.find((r) => r.id === d.left)!;
  const b = run.records.find((r) => r.id === d.right)!;
  const assets = ctx.assets ?? getRegisteredAssets();
  const event = run.audit.find((e) => e.action === "DECISION_RECORDED" && e.entity_id === d.id) ?? master.audit.find((e) => e.action === "DECISION_RECORDED" && e.entity_id === d.id);

  // ---- decision status and who approved
  let status: EvidenceCertificate["decision"]["status"];
  let approvals: EvidenceCertificate["decision"]["approvals"] = [];
  let required: 1 | 2 = d.tier === "R" ? 2 : 1;
  if (d.zone === "AUTO_MERGE") {
    status = "approved";
    required = 1;
    approvals = [{ actor: AUTO_ACTOR, role: "Automatic (rules and verified cluster)", at: event ? event.ts : run.finished_at }];
  } else if (d.zone === "REJECT") {
    status = "rejected";
  } else {
    const item = master.reviews[d.id];
    if (item) {
      required = item.approvals_required;
      status = item.status === "approved" ? "approved" : item.status === "rejected" ? "rejected" : "pending_review";
      approvals = item.approvals.map((x) => ({ actor: x.actor, role: roleOf(x.actor), at: x.at }));
    } else {
      status = "pending_review";
    }
  }

  // ---- identity and crosswalk
  const nl = master.record_nmc[d.left] ?? null;
  const nr = master.record_nmc[d.right] ?? null;
  const nmc = nl !== null && nl === nr ? nl : null;
  const entry = nmc ? master.nmcs.find((n) => n.code === nmc) : undefined;
  const byId = new Map(run.records.map((r) => [r.id, r]));
  const crosswalk = entry ? entry.members.map((m) => ({ cpse: byId.get(m)!.cpse, matnr: byId.get(m)!.matnr })) : [];

  // ---- config status of the tables that shaped this decision
  const used = tablesUsed(d, a, b);
  const config_status: Record<string, string> = {};
  for (const t of used) config_status[t] = run.config_status[t] ?? "draft";
  const unverified = used.filter((t) => config_status[t] !== "reviewed");

  // ---- measured precision (offline benchmark, never production guarantees)
  const bm = ctx.benchmark ?? null;
  const row = (scope: "synthetic" | "unseen_noise") => {
    const s = bm ? bm[scope]?.modes?.sama : undefined;
    if (!s) return { evidence_scope: scope, n: null, false_merges: null, upper_bound_95: null, note: "benchmark results not loaded" };
    return { evidence_scope: scope, n: s.auto_correct + s.auto_wrong, false_merges: s.auto_wrong, upper_bound_95: s.upper_bound_95 };
  };
  const measured_precision = [
    row("synthetic"),
    row("unseen_noise"),
    { evidence_scope: "real_labelled", n: null, false_merges: null, upper_bound_95: null, note: "not yet measured" },
  ];

  const limitations = ["Benchmark figures are measurements on synthetic data, not production guarantees."];
  if (unverified.length) {
    limitations.push(`This decision used tables that an engineer has not reviewed yet: ${unverified.join(", ")}.`);
  }
  if (d.class_code === "9999") {
    limitations.push("GENERIC items (outside the templated classes) are never auto-merged; they can only join an identity after a person approves them.");
  }
  limitations.push("This audit trail is a local demonstration trail in this browser.");

  const tierReasons = [...new Set([...a.tier_reasons, ...b.tier_reasons])].sort(pyCmp);
  const tier: Tier = d.tier;
  return {
    certificate_id: ctx.certificate_id,
    schema_version: "5.0",
    kind: "pair",
    issued_at: ctx.now,
    data_label: run.scope === "sample" ? "DEMO SAMPLE DATA" : "UPLOADED DATA (processed locally in this browser)",
    evidence_scope: run.scope === "sample" ? "sample run" : "uploaded run",
    run_id: run.run_id,
    config_version: run.config_version,
    config_status,
    gate_model: run.gate_model,
    text_model: run.text_model,
    records: [certRecord(a), certRecord(b)],
    comparison: d.comparison,
    residual_diff: d.residual_diff,
    rules: d.rules,
    scores: {
      gate_score: d.gate_score, baseline_score: d.baseline_score, thr_E: run.thresholds.thr_E, reject_thr: run.thresholds.reject_thr,
      t_base: run.thresholds.t_base, top_features: topFeatures(d, assets),
    },
    tier: { value: tier, reasons: tierReasons },
    decision: {
      zone: d.zone, zone_step: d.zone_step, reason: d.reason, plain_reason: explainDecision(d).headline, status,
      approvals_required: required, approvals,
    },
    identity: { nmc, crosswalk },
    measured_precision,
    limitations,
    audit: event ? { seq: event.seq, hash: event.hash, note: "Chain event written when the engine decided this pair." } : null,
  };
}

export type { ConfigAsset };
