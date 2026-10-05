/**
 * SAMA-NMC engine contract.
 *
 * The browser engine (src/engine) is an implementation of the SAME frozen semantics as the Python
 * reference (backend/sama). JSON field names are deliberately snake_case and identical to the Python
 * models, so a run produced by either implementation can be deep-compared for parity.
 *
 * Python reference producer: backend/sama/runview.py (build_run_output).
 * NEVER add browser-only decision logic. If a field changes here, change runview.py and the parity
 * fixtures in the same commit.
 */

export type Zone = "AUTO_MERGE" | "REVIEW" | "REJECT";
export type State = "agree" | "conflict" | "less_specific" | "left_missing" | "right_missing" | "both_missing";
export type Tier = "R" | "E";
export type SanityType = "not_allowed" | "out_of_range" | "multi_value" | "internal_conflict";
export type RuleId = "R-01" | "R-02" | "R-03" | "R-04" | "R-05" | "R-06" | "R-07" | "R-08" | "R-09";

/** One validated row of the SAMA-NMC evaluator CSV. */
export interface RawRecord {
  record_id: string; // `${cpse}:${matnr}`, unique within a run
  cpse: string;
  matnr: string;
  maktx: string;
  long_text: string;
  meins: string;
  characteristics: Record<string, string>;
  mfr: string;
  mpn: string;
  last_po_price: number | null;
  annual_qty: number | null;
}

export interface Transform { rule_id: string; before: string; after: string }

export interface Attribute {
  value: string | null; // canonical value; null when read but not recognised (then raw_value is shown, compare treats it as missing)
  raw_value: string | null;
  designation: string | null; // size-dependent designation, e.g. "STD"
  resolved: number | null; // table-resolved physical value, e.g. wall_mm
  source: "char" | "text" | "llm";
  rule_id: string;
  confidence: number;
  span: [number, number] | null; // token indices [start, end) in the pass-2 normalized text
}

export interface SanityFlag { type: SanityType; prop: string; detail: string }
export interface Residuals { ignorable: string[]; reference: string[]; unknown: string[]; risk: string[] }

export interface CompareRow {
  property: string;
  critical: boolean;
  left: string | null;
  right: string | null;
  state: State;
  via: "size_table" | "both_family" | null;
  ancestor_chain: string[];
}

export interface ResidualSide { left_only: string[]; right_only: string[] }
export interface ResidualDiff { unknown: ResidualSide; reference: ResidualSide }
export interface RuleOutcome { id: RuleId; fired: boolean; detail: string }

/** Record status in the Material Master view. */
export type RecordStatus = "VERIFIED" | "REVIEW" | "UNIQUE";

export interface RecordView {
  id: string;
  cpse: string;
  matnr: string;
  raw: string; // maktx as written (long_text, if any, is appended for normalization only)
  normalized: string; // pass-2 normalized text
  transforms: Transform[];
  class_code: string; // "1201", ... or "9999" (GENERIC)
  class_name: string; // national name, e.g. "FLANGE, WELD NECK"; "GENERIC" for 9999
  generic: boolean;
  tier: Tier;
  tier_reasons: string[];
  attributes: Record<string, Attribute>;
  residuals: Residuals;
  sanity_flags: SanityFlag[];
  mfr: string;
  mpn: string;
  mfr_norm: string;
  mpn_norm: string;
  uom: string; // normalized unit of measure
  price: number | null;
  qty: number | null;
  status: RecordStatus;
  nmc: string | null; // NMC code once the record has an identity; null while pending review
}

/** What the evaluator sees for a decision. `lookalike` = REJECT worth showing (see summary rules). */
export type DecisionKind = "verified" | "review" | "lookalike";

export interface Decision {
  id: string; // `${left}~${right}`, left < right (string order)
  left: string; // record ids
  right: string;
  class_code: string;
  tier: Tier;
  zone: Zone;
  zone_step: number; // 1..9, the step of the nine-step zone order that decided
  reason: string; // plain engine reason (rule detail or step wording)
  kind: DecisionKind;
  comparison: CompareRow[];
  residual_diff: ResidualDiff;
  rules: RuleOutcome[]; // all nine, fired or not
  features: Record<string, number>;
  gate_score: number; // 6 decimals
  baseline_score: number; // the ordinary text-similarity matcher's score, 6 decimals
  baseline_zone: "AUTO_MERGE" | "REVIEW"; // what the ordinary matcher would do with this pair
  blockers: string[];
}

export interface NmcEntry {
  code: string; // NMC:CCCC-NNNNNNN-K
  class_code: string;
  serial: string;
  check_char: string;
  kind: "cluster" | "singleton";
  members: string[]; // record ids
  golden: { attributes: Record<string, string | null>; conflicts: Record<string, string[]> };
  short_text: string;
  long_text: string;
}

export interface Summary {
  records: number;
  candidate_pairs: number; // every pair the blockers produced and the engine compared
  auto: number; // AUTO_MERGE decisions
  review: number; // REVIEW decisions
  reject: number; // look-alike REJECT decisions shown (kind === "lookalike")
  filtered: number; // candidate pairs not shown: unrelated / clearly different (never merged)
  groups: number; // verified clusters
  unique: number; // records with no match (singleton identity)
  pending: number; // records waiting on an open review item (no NMC yet)
  generic_records: number;
  nmcs: number;
  by_class: Record<string, number>;
}

/** Fuzzy-matcher comparison on the SAME candidate pairs (decision safety, not retrieval). */
export interface FuzzyComparison {
  t_base: number;
  fuzzy_auto: number; // pairs an ordinary matcher would auto-merge
  both_auto: number; // ... that SAMA also auto-merges
  stopped_by_sama: number; // ... that SAMA sends to review or rejects
  stopped_ids: string[]; // decision ids (all have full detail in `decisions`)
  answer_key: { pairs_with_truth: number; fuzzy_wrong: number; sama_wrong: number } | null; // sample only
}

export interface AuditEvent {
  seq: number;
  ts: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, string | number | boolean>; // strings / ints / booleans only (no floats)
  prev_hash: string;
  hash: string;
}

export interface RunOutput {
  schema: "sama-run/1";
  run_id: string;
  scope: "sample" | "upload";
  started_at: string;
  finished_at: string;
  config_version: string;
  config_status: Record<string, string>;
  gate_model: string; // e.g. "gate_v2"
  text_model: string; // e.g. "text_model_v2"
  thresholds: { thr_E: number | null; reject_thr: number; t_base: number };
  summary: Summary;
  records: RecordView[]; // input order
  decisions: Decision[]; // sorted by id
  nmcs: NmcEntry[]; // mint order: verified clusters by first member, then singletons by record id
  fuzzy: FuzzyComparison;
  audit: AuditEvent[];
  warnings: string[];
}

/** Engine progress for the six-stage story. */
export interface RunProgress {
  stage: 0 | 1 | 2 | 3 | 4 | 5;
  label: string;
  done: number;
  total: number;
}

export const STAGE_LABELS = [
  "Understanding records",
  "Finding candidates",
  "Comparing attributes",
  "Applying safety rules",
  "Preparing decisions",
  "Building identity and evidence",
] as const;

/** Frozen artifacts loaded from /engine/*.json (exported by bench/export_assets.py). */
export interface GateAsset {
  version: string;
  frozen: true;
  features: string[];
  feature_scaling: Record<string, number>;
  coef: number[];
  intercept: number;
  thr_E: number | null;
  reject_thr: number;
  t_base: number;
  calibration: Record<string, unknown>;
}

export interface TextModelAsset {
  meta: Record<string, unknown>;
  n_buckets: number;
  default_idf: number;
  idf: Record<string, number>;
}

export interface ClassTemplate {
  class_code: string;
  noun: string;
  modifier: string | null;
  national_name: string;
  tier_default: Tier;
  status: string;
  head_patterns: string[];
  properties: Array<{
    name: string;
    critical: boolean;
    extractor: string;
    allowed?: string[];
    hierarchy?: string;
    resolver?: string;
  }>;
  short_text_template: string;
  long_text_template: string;
}

export interface ConfigAsset {
  version: string;
  status: Record<string, string>;
  tables: Record<string, any>;
  classes: Record<string, ClassTemplate>;
}

export interface EngineAssets {
  config: ConfigAsset;
  textModel: TextModelAsset;
  gate: GateAsset;
}

/** CSV validation result (strict SAMA-NMC evaluator format). */
export interface CsvIssue {
  code:
    | "EMPTY_FILE"
    | "UNREADABLE"
    | "MISSING_COLUMNS"
    | "TOO_MANY_ROWS"
    | "DUPLICATE_ID"
    | "BLANK_DESCRIPTION"
    | "BAD_NUMBER"
    | "BAD_CHARACTERISTICS";
  message: string; // plain language, shown as-is
  rows?: number[]; // 1-based data row numbers (first few)
  severity: "error" | "warning";
}

export interface CsvResult {
  records: RawRecord[];
  issues: CsvIssue[];
  ok: boolean; // false when any error-severity issue exists
}

export const CSV_REQUIRED = ["cpse", "matnr", "maktx"] as const;
export const CSV_OPTIONAL = ["long_text", "meins", "mfr", "mpn", "last_po_price", "annual_qty", "characteristics"] as const;
export const CSV_MAX_ROWS = 3000;

/* ------------------------------------------------------------------------------------------------
 * Governance (maker-checker) and master-layer operations: browser implementation of PRD FR-GOV-04/09,
 * FR-NMC-07, FR-CLU-04. Reviewer clicks NEVER touch rules R-01..R-09, the frozen gate or thresholds.
 * ---------------------------------------------------------------------------------------------- */

export type Actor = "Demo analyst" | "Demo engineer"; // role personas, never invented people

export interface ReviewApproval { actor: Actor; at: string }

export interface ReviewItem {
  decision_id: string;
  status: "open" | "approved" | "rejected";
  approvals: ReviewApproval[];
  approvals_required: 1 | 2; // Tier R needs two different actors, at least one engineer
  rejection: { actor: Actor; at: string; reason_code: ReasonCode } | null;
  /** set when approved but the membership check blocked the identity change (FR-CLU-04, I-19) */
  blocked: { reason: string; offending: { left: string; right: string; rule: RuleId } } | null;
}

export type ReasonCode =
  | "CRIT_CONFLICT"
  | "LESS_SPECIFIC_UNRESOLVED"
  | "RESIDUAL_DIFFERENCE"
  | "INSUFFICIENT_INFO"
  | "DIFFERENT_MFR_PART"
  | "WRONG_CLASS"
  | "OTHER";

/** Mutable-by-replacement session state layered on top of an immutable RunOutput. */
export interface MasterState {
  run: RunOutput;
  reviews: Record<string, ReviewItem>; // by decision id, for every kind === "review" decision
  nmcs: NmcEntry[]; // current registry (starts equal to run.nmcs)
  retired: Array<{ code: string; superseded_by: string }>;
  record_nmc: Record<string, string | null>; // current identity per record id
  approved_pairs: string[]; // decision ids a reviewer approved
  audit: AuditEvent[]; // run events + governance events, one continuous chain
}

/* ------------------------------------------------------------------------------------------------
 * Evidence Certificate (schema 5.0): "why should I trust this decision?"
 * ---------------------------------------------------------------------------------------------- */

export interface CertificateRecord {
  id: string;
  cpse: string;
  matnr: string;
  raw: string;
  normalized: string;
  class_code: string;
  class_name: string;
  tier: Tier;
  attributes: Record<string, Attribute>;
  residuals: Residuals;
  sanity_flags: SanityFlag[];
  mfr: string;
  mpn: string;
}

export interface EvidenceCertificate {
  certificate_id: string;
  schema_version: "5.0";
  kind: "pair";
  issued_at: string; // real browser time of issue
  data_label: "DEMO SAMPLE DATA" | "UPLOADED DATA (processed locally in this browser)";
  evidence_scope: string; // e.g. "sample run", "uploaded run"
  run_id: string;
  config_version: string;
  config_status: Record<string, string>; // tables used -> unverified | draft | reviewed
  gate_model: string;
  text_model: string;
  records: [CertificateRecord, CertificateRecord];
  comparison: CompareRow[];
  residual_diff: ResidualDiff;
  rules: RuleOutcome[];
  scores: { gate_score: number; baseline_score: number; thr_E: number | null; reject_thr: number; t_base: number; top_features: Array<[string, number]> };
  tier: { value: Tier; reasons: string[] };
  decision: {
    zone: Zone;
    zone_step: number;
    reason: string;
    plain_reason: string;
    status: "approved" | "rejected" | "pending_review";
    approvals_required: 1 | 2;
    approvals: Array<{ actor: Actor | "SAMA-NMC rules (automatic)"; role: string; at: string }>;
  };
  identity: { nmc: string | null; crosswalk: Array<{ cpse: string; matnr: string }> };
  measured_precision: Array<{ evidence_scope: string; n: number | null; false_merges: number | null; upper_bound_95: number | null; note?: string }>;
  limitations: string[];
  audit: { seq: number; hash: string; note: string } | null;
}

/** Offline benchmark results (frontend/public/data/benchmark.json), exported by bench/export_assets.py. */
export interface BenchmarkAsset {
  generated_by: string;
  config_version: string;
  gate: string;
  scope_note: string;
  synthetic: BenchmarkScope;
  unseen_noise: BenchmarkScope;
  examples: Array<{
    left_raw: string; right_raw: string; left_cpse: string; right_cpse: string; pair_type: string;
    baseline_score: number; baseline_zone: string; sama_zone: Zone; sama_step: number; sama_reason: string;
    comparison: CompareRow[];
  }>;
}

export interface BenchmarkScope {
  n_pairs: number;
  n_records: number;
  modes: Record<"sama" | "baseline" | "model_only", {
    auto_correct: number; auto_wrong: number; review: number; reject: number; reject_true_match: number;
    auto_precision: number | null; upper_bound_95: number | null; total_recall: number | null;
  }>;
  by_pair_type: Record<string, Record<string, number>>;
  blocking: { true_pairs: number; found: number; recall: number | null };
  safety: Record<string, number | boolean>;
  threshold?: Record<string, unknown>;
}

/* ------------------------------------------------------------------------------------------------
 * Additive exports (browser master layer): result of one reviewer action.
 * ---------------------------------------------------------------------------------------------- */

export interface ReviewOutcome {
  ok: boolean;
  error?: string; // plain-language reason when ok is false (state unchanged)
  status: ReviewItem["status"]; // status of the review item after the action
  message: string; // plain-language summary for the reviewer
  events: AuditEvent[]; // audit events appended by this action
  nmc?: { action: "minted" | "attached" | "merged" | "singleton" | "none"; code: string | null; members: string[]; retired?: string[] };
  blocked?: { reason: string; offending: { left: string; right: string; rule: RuleId } };
}
