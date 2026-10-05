/**
 * Tier, six-state compare, rules R-01..R-09 and the nine-step zone: port of backend/sama/decide.py.
 * This module carries the safety. Nothing here reads embeddings or model scores except `zone`, which
 * reads the frozen gate score at steps 5 and 8 only. Compare and rules work on the minimal
 * `RecordLike` interface, so they run on engine-internal records and on RecordView alike.
 */
import type { Attribute, CompareRow, ConfigAsset, ResidualDiff, ResidualSide, RuleOutcome, Tier, Zone } from "./types";
import { isAncestor, type RecordLike, type RecAttrs } from "./extract";
import { sortedStrings } from "./pyre";

export const GENERIC = "9999";
const HIGH_CLASSES = ["CL600", "CL900", "CL1500", "CL2500"];

export interface Pair {
  left_id: string;
  right_id: string;
  class_code: string;
  tier: Tier;
  blockers: string[];
  comparison: CompareRow[];
  residual_diff: ResidualDiff;
  rules: RuleOutcome[];
  features: Record<string, number>;
  gate_score: number | null;
  baseline_score: number | null;
  zone: Zone | null;
  zone_step: number | null;
  zone_reason: string;
}

export const pairFired = (p: { rules: RuleOutcome[] }, id: string): boolean => p.rules.some((r) => r.id === id && r.fired);

// ---------------------------------------------------------------- tier
export function assignTier(rec: RecAttrs, cfg: ConfigAsset): RecAttrs {
  const tmpl = cfg.classes[rec.class_code];
  let tier: Tier = tmpl ? tmpl.tier_default : "R";
  let reasons = [`class ${rec.class_code} default ${tier}`];
  const pc = rec.attributes["pressure_class"];
  if (pc && pc.value !== null && HIGH_CLASSES.includes(pc.value)) {
    tier = "R";
    reasons = [...reasons, `T-01 pressure class ${pc.value}`];
  }
  if (rec.residuals.risk.length) {
    tier = "R";
    reasons = [...reasons, `T-02 risk word ${rec.residuals.risk.join(", ")}`];
  }
  if (rec.class_code === GENERIC) {
    tier = "R";
    reasons = [...reasons, "T-03 GENERIC class"];
  }
  return { ...rec, tier, tier_reasons: reasons };
}

export function pairTier(a: { tier: Tier }, b: { tier: Tier }): Tier {
  return a.tier === "R" || b.tier === "R" ? "R" : "E"; // FR-CLS-04
}

// ---------------------------------------------------------------- compare
const usable = (a: Attribute | undefined | null): Attribute | null => (a && a.value !== null ? a : null);

const row = (prop: string, critical: boolean, left: string | null, right: string | null, state: CompareRow["state"], via: CompareRow["via"] = null, chain: string[] = []): CompareRow => ({
  property: prop, critical, left, right, state, via, ancestor_chain: chain,
});

export function compareProp(prop: { name: string; critical?: boolean; resolver?: string; hierarchy?: string }, a0: Attribute | undefined | null, b0: Attribute | undefined | null, cfg: ConfigAsset): CompareRow {
  const name = prop.name;
  const critical = !!prop.critical;
  const a = usable(a0);
  const b = usable(b0);
  const shownL = a ? a.value : null;
  const shownR = b ? b.value : null;
  let via: CompareRow["via"] = null;
  let va: string | number | null;
  let vb: string | number | null;
  if (prop.resolver) {
    if (a && b && a.designation === b.designation) return row(name, critical, shownL, shownR, "agree");
    va = a ? a.resolved : null;
    vb = b ? b.resolved : null;
    via = "size_table";
  } else {
    va = a ? a.value : null;
    vb = b ? b.value : null;
  }
  if (va === null && vb === null) return row(name, critical, shownL, shownR, "both_missing");
  if (va === null) return row(name, critical, shownL, shownR, "left_missing");
  if (vb === null) return row(name, critical, shownL, shownR, "right_missing");
  const h = prop.hierarchy;
  if (va === vb) {
    const tree = h ? ((cfg.tables.hierarchies[h] ?? {}) as Record<string, string[]>) : null;
    if (h && tree && Object.prototype.hasOwnProperty.call(tree, va as string) && tree[va as string].length) {
      // Both records state only a family: agreement on the family is not evidence of identity (SC-01).
      return row(name, critical, shownL, shownR, "less_specific", "both_family", [va as string]);
    }
    return row(name, critical, shownL, shownR, "agree", via);
  }
  if (h && isAncestor(cfg, h, va as string, vb as string)) return row(name, critical, shownL, shownR, "less_specific", null, [va as string, vb as string]);
  if (h && isAncestor(cfg, h, vb as string, va as string)) return row(name, critical, shownL, shownR, "less_specific", null, [vb as string, va as string]);
  return row(name, critical, shownL, shownR, "conflict", via); // both recognised, unrelated
}

function setMinus(x: string[], y: string[]): string[] {
  const ys = new Set(y);
  return [...new Set(x)].filter((v) => !ys.has(v));
}

export function residualDiff(a: RecordLike, b: RecordLike): ResidualDiff {
  const side = (x: string[], y: string[]): ResidualSide => ({ left_only: sortedStrings(setMinus(x, y)), right_only: sortedStrings(setMinus(y, x)) });
  return { unknown: side(a.residuals.unknown, b.residuals.unknown), reference: side(a.residuals.reference, b.residuals.reference) };
}

export function compareRecords(a: RecordLike, b: RecordLike, cfg: ConfigAsset): CompareRow[] {
  const tmpl = cfg.classes[a.class_code];
  if (!tmpl || a.class_code !== b.class_code) return [];
  return tmpl.properties.map((p) => compareProp(p, a.attributes[p.name], b.attributes[p.name], cfg));
}

// ---------------------------------------------------------------- rules
export function evaluateRules(a: RecordLike, b: RecordLike, rows: CompareRow[], diff: ResidualDiff, cfg: ConfigAsset): RuleOutcome[] {
  const crit = rows.filter((r) => r.critical);
  const conflicts = crit.filter((r) => r.state === "conflict").map((r) => r.property);
  const less = crit.filter((r) => r.state === "less_specific").map((r) => r.property);
  const missing = crit.filter((r) => r.state.endsWith("missing")).map((r) => r.property);
  const resL = [...diff.unknown.left_only, ...diff.reference.left_only];
  const resR = [...diff.unknown.right_only, ...diff.reference.right_only];
  const risk = sortedStrings(new Set([...a.residuals.risk, ...b.residuals.risk]));
  const sanity = [...a.sanity_flags, ...b.sanity_flags].map((f) => `${f.type}:${f.prop}`);
  const sameMpn = !!(a.mfr_norm && b.mfr_norm && a.mpn_norm && b.mpn_norm && a.mfr_norm === b.mfr_norm && a.mpn_norm === b.mpn_norm);
  const diffMpn = !!(a.mfr_norm && a.mfr_norm === b.mfr_norm && a.mpn_norm && b.mpn_norm && a.mpn_norm !== b.mpn_norm);
  const viaTable = crit.filter((r) => r.state === "agree" && r.via === "size_table").map((r) => r.property);
  const r09 = viaTable.length > 0 && cfg.status["schedules"] !== "reviewed";
  const out = (id: RuleOutcome["id"], fired: boolean, detail: string): RuleOutcome => ({ id, fired, detail: fired ? detail : "" });
  return [
    out("R-01", conflicts.length > 0, `critical conflict: ${conflicts.join(", ")}`),
    out("R-02", less.length > 0, `less specific: ${less.join(", ")}`),
    out("R-03", missing.length > 0, `critical missing: ${missing.join(", ")}`),
    out("R-04", resL.length > 0 || resR.length > 0, `unexplained tokens: ${resL.join(" ") || "—"} | ${resR.join(" ") || "—"}`),
    out("R-05", risk.length > 0, `risk word: ${risk.join(", ")}`),
    out("R-06", sanity.length > 0, `sanity flag: ${sanity.join(", ")}`),
    out("R-07", sameMpn, `same manufacturer + part number ${a.mpn_norm}`),
    out("R-08", diffMpn, `same manufacturer, different part numbers ${a.mpn_norm} / ${b.mpn_norm}`),
    out("R-09", r09, `agreement via unreviewed size table: ${viaTable.join(", ")}`),
  ];
}

// ---------------------------------------------------------------- zone
export const STEP_WORDS: Record<number, string> = {
  1: "same part number but conflicting attributes → review (data-quality issue)",
  2: "critical conflict → reject",
  3: "risk word or sanity flag → review",
  4: "qualifying manufacturer part-number match",
  5: "low evidence → reject (logged, sampleable)",
  6: "engineered item (Tier R) → engineer review",
  7: "review cap",
  8: "every critical attribute agrees and gate score clears the measured threshold → auto-merge",
  9: "below auto threshold → review",
};

type ZoneInput = Pick<Pair, "class_code" | "tier" | "comparison" | "rules" | "gate_score">;
export type ZoneResult = [Zone, number, string];

function downgradeIfUnreviewed(z: Zone, step: number, why: string, cfg: ConfigAsset): ZoneResult {
  if (cfg.tables.tiers["auto_merge_requires_reviewed_config"]) {
    if (Object.entries(cfg.status).some(([k, s]) => !k.startsWith("class:") && s !== "reviewed")) {
      return ["REVIEW", step, why + " — downgraded: decision uses unreviewed tables (NFR-12)"];
    }
  }
  return [z, step, why];
}

export function zone(p: ZoneInput, thrE: number, rejectThr: number, cfg: ConfigAsset): ZoneResult {
  const f = (id: string) => pairFired(p, id);
  const detail: Record<string, string> = {};
  for (const r of p.rules) if (r.fired) detail[r.id] = r.detail || r.id;
  if (f("R-01") && f("R-07")) return ["REVIEW", 1, STEP_WORDS[1]];
  if (f("R-01")) return ["REJECT", 2, detail["R-01"]];
  if (f("R-05") || f("R-06")) return ["REVIEW", 3, ["R-05", "R-06"].filter((r) => r in detail).map((r) => detail[r]).join("; ")];
  if (f("R-07")) {
    if (p.class_code === GENERIC) return ["REVIEW", 4, "part-number match in GENERIC class → review (no template to check conflicts)"];
    return downgradeIfUnreviewed("AUTO_MERGE", 4, STEP_WORDS[4], cfg);
  }
  const crit = p.comparison.filter((r) => r.critical);
  if (p.gate_score !== null && p.gate_score < rejectThr && !crit.some((r) => r.state === "agree" || r.state === "less_specific")) {
    return ["REJECT", 5, STEP_WORDS[5]];
  }
  if (p.tier === "R" || p.class_code === GENERIC) return ["REVIEW", 6, STEP_WORDS[6]]; // I-08
  for (const rid of ["R-02", "R-03", "R-04", "R-08", "R-09"]) if (f(rid)) return ["REVIEW", 7, detail[rid]];
  if (p.gate_score !== null && p.gate_score >= thrE) return downgradeIfUnreviewed("AUTO_MERGE", 8, STEP_WORDS[8], cfg);
  return ["REVIEW", 9, STEP_WORDS[9]];
}

export function qualifyingMpn(p: { rules: RuleOutcome[]; class_code: string }): boolean {
  return pairFired(p, "R-07") && p.class_code !== GENERIC && !(pairFired(p, "R-01") || pairFired(p, "R-05") || pairFired(p, "R-06"));
}

export function buildPair(a: RecAttrs, b: RecAttrs, cfg: ConfigAsset, blockers: string[] = []): Pair {
  const rows = compareRecords(a, b, cfg);
  const diff = residualDiff(a, b);
  return {
    left_id: a.record_id, right_id: b.record_id, class_code: a.class_code, tier: pairTier(a, b), blockers, comparison: rows,
    residual_diff: diff, rules: evaluateRules(a, b, rows, diff, cfg), features: {}, gate_score: null, baseline_score: null,
    zone: null, zone_step: null, zone_reason: "",
  };
}
