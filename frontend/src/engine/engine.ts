/**
 * The SAMA-NMC decision engine in TypeScript: mirrors backend/sama evaluator.evaluate +
 * pipeline.mint_master_layer + runview.build_run_output. Behaviourally identical to the Python
 * reference (see PARITY.md). Pure functions, no DOM globals: runs in a Web Worker or in node.
 *
 * The run is a generator; `runEngine` drives it asynchronously (cooperative yielding every ~25 ms and
 * progress for the six stages), `runEngineSync` drives it to completion in one go.
 */
import { AuditChain } from "./audit";
import { TextIndex, block } from "./block";
import { classify } from "./classify";
import { verifiedClusters } from "./cluster";
import { assignTier, buildPair, zone, type Pair } from "./decide";
import { extract, type RecAttrs } from "./extract";
import { goldenRecord, renderTexts, SerialAllocator, pyHead } from "./nmc";
import { applyPass2, normalizeRecord, type NormRecord } from "./normalize";
import { pyCmp } from "./pyre";
import { baselineScore, gateFor, pairFeatures, q6 } from "./score";
import { textModelFor } from "./textmodel";
import {
  STAGE_LABELS,
  type AuditEvent, type ConfigAsset, type Decision, type DecisionKind, type EngineAssets, type FuzzyComparison,
  type NmcEntry, type RawRecord, type RecordView, type RunOutput, type RunProgress, type Summary,
} from "./types";

export interface RunOptions {
  scope: "sample" | "upload";
  runId?: string;
  now?: () => string;
  truth?: Record<string, string>;
  onProgress?: (p: RunProgress) => void;
  /** Extra warnings to carry into the output (for example skipped CSV rows). */
  warnings?: string[];
}

type Tick = { kind: "progress"; p: RunProgress } | { kind: "yield" };

const pairKey = (a: string, b: string) => a + "\u0000" + b;

function isNearMiss(p: Pair): boolean {
  const crit = p.comparison.filter((r) => r.critical);
  const conflicts = crit.filter((r) => r.state === "conflict");
  return conflicts.length === 1 && crit.every((r) => r.state === "conflict" || r.state === "agree" || r.state === "less_specific");
}

function decisionKind(p: Pair, tBase: number): DecisionKind | null {
  if (p.zone === "AUTO_MERGE") return "verified";
  if (p.zone === "REVIEW") return "review";
  if (p.zone === "REJECT" && (isNearMiss(p) || (p.baseline_score ?? 0.0) >= tBase)) return "lookalike";
  return null;
}

const CHUNK = 200;

function* engineGen(records: RawRecord[], assets: EngineAssets, opts: RunOptions): Generator<Tick, RunOutput, void> {
  const cfg: ConfigAsset = assets.config;
  const gate = gateFor(assets.gate);
  const model = textModelFor(assets.textModel);
  const now = opts.now ?? (() => new Date().toISOString());
  const runId = opts.runId ?? "RUN-0001";
  const startedAt = now();
  const progress = (stage: RunProgress["stage"], done: number, total: number): Tick => ({
    kind: "progress",
    p: { stage, label: STAGE_LABELS[stage], done, total },
  });

  // ---- stage 0: understand records (normalize, classify, extract, tier)
  const norms = new Map<string, NormRecord>();
  const recs: RecAttrs[] = [];
  const recById = new Map<string, RecAttrs>();
  const rawById = new Map<string, RawRecord>();
  yield progress(0, 0, records.length);
  for (let i = 0; i < records.length; i++) {
    const raw = records[i];
    rawById.set(raw.record_id, raw);
    let n = normalizeRecord(raw, cfg);
    const c = classify(n.norm_text, cfg);
    n = applyPass2(n, c.class_code, cfg);
    norms.set(raw.record_id, n);
    const rec = assignTier(extract(raw, n, c, cfg), cfg);
    recs.push(rec);
    recById.set(raw.record_id, rec);
    if ((i + 1) % 50 === 0) {
      yield progress(0, i + 1, records.length);
      yield { kind: "yield" };
    }
  }
  yield progress(0, records.length, records.length);

  // ---- stage 1: candidates (frozen text model + blockers)
  yield progress(1, 0, 1);
  yield { kind: "yield" };
  const index = new TextIndex(recs.map((r) => norms.get(r.record_id)!.norm_text), model);
  yield { kind: "yield" };
  const blocked = block(recs, index, cfg);
  yield progress(1, 1, 1);

  // ---- stage 2: compare attributes, build features
  const pairs: Pair[] = [];
  const pairMap = new Map<string, Pair>();
  yield progress(2, 0, blocked.length);
  for (let k = 0; k < blocked.length; k++) {
    const { i, j, how } = blocked[k];
    const a = recs[i];
    const b = recs[j];
    const p = buildPair(a, b, cfg, how);
    p.features = pairFeatures(p.comparison, a, b, norms.get(a.record_id)!.norm_text, norms.get(b.record_id)!.norm_text, index.cos(i, j),
      norms.get(a.record_id)!.uom_norm, norms.get(b.record_id)!.uom_norm);
    p.baseline_score = q6(baselineScore(p.features));
    pairs.push(p);
    pairMap.set(pairKey(a.record_id, b.record_id), p);
    if ((k + 1) % CHUNK === 0) {
      yield progress(2, k + 1, blocked.length);
      yield { kind: "yield" };
    }
  }
  yield progress(2, blocked.length, blocked.length);

  // ---- stage 3: gate score + nine-step zone
  const zonesBaseline: Array<"AUTO_MERGE" | "REVIEW"> = [];
  yield progress(3, 0, pairs.length);
  for (let k = 0; k < pairs.length; k++) {
    const p = pairs[k];
    p.gate_score = q6(gate.score(p.features));
    [p.zone, p.zone_step, p.zone_reason] = zone(p, gate.thrE, gate.rejectThr, cfg);
    zonesBaseline.push((p.baseline_score as number) >= gate.tBase ? "AUTO_MERGE" : "REVIEW");
    if ((k + 1) % (CHUNK * 4) === 0) {
      yield progress(3, k + 1, pairs.length);
      yield { kind: "yield" };
    }
  }
  yield progress(3, pairs.length, pairs.length);

  // ---- stage 4: decisions shown to the person (presentation only; never changes a zone)
  yield progress(4, 0, pairs.length);
  const decisions: Decision[] = [];
  const keptCounts = { verified: 0, review: 0, lookalike: 0 };
  let fuzzyAuto = 0;
  let bothAuto = 0;
  const stopped: string[] = [];
  for (let k = 0; k < pairs.length; k++) {
    const p = pairs[k];
    const fzAuto = zonesBaseline[k] === "AUTO_MERGE";
    if (fzAuto) fuzzyAuto++;
    if (fzAuto && p.zone === "AUTO_MERGE") bothAuto++;
    const kind = decisionKind(p, gate.tBase);
    if (kind === null) continue;
    keptCounts[kind]++;
    const [lo, hi] = pyCmp(p.left_id, p.right_id) <= 0 ? [p.left_id, p.right_id] : [p.right_id, p.left_id];
    const d: Decision = {
      id: `${lo}~${hi}`, left: p.left_id, right: p.right_id, class_code: p.class_code, tier: p.tier, zone: p.zone!,
      zone_step: p.zone_step!, reason: p.zone_reason, kind, comparison: p.comparison, residual_diff: p.residual_diff,
      rules: p.rules, features: { ...p.features }, gate_score: p.gate_score as number, baseline_score: p.baseline_score as number,
      baseline_zone: zonesBaseline[k], blockers: [...p.blockers].sort(pyCmp),
    };
    decisions.push(d);
    if (fzAuto && p.zone !== "AUTO_MERGE") stopped.push(d.id);
  }
  yield progress(4, pairs.length, pairs.length);

  // ---- stage 5: identity (verified clustering, NMC mint) and evidence (audit)
  yield progress(5, 0, 1);
  yield { kind: "yield" };
  const getPair = (a: string, b: string): Pair => {
    const [x, y] = pyCmp(a, b) < 0 ? [a, b] : [b, a];
    const p = pairMap.get(pairKey(x, y));
    // not blocked together: rules only, evaluated on the fly
    return p ?? buildPair(recById.get(x)!, recById.get(y)!, cfg, ["verify"]);
  };
  const auto = pairs.filter((p) => p.zone === "AUTO_MERGE");
  const cr = verifiedClusters(auto, getPair, Number(cfg.tables.tiers.cluster_size_alarm));
  const pending = new Set<string>();
  for (const p of pairs) if (p.zone === "REVIEW") { pending.add(p.left_id); pending.add(p.right_id); }
  for (const b of cr.bridges) pending.add(b);
  for (const comp of cr.alarms) for (const r of comp) pending.add(r);

  const alloc = new SerialAllocator(1);
  const nmcEntries: NmcEntry[] = [];
  const nmcOf = new Map<string, string>();
  const clustered = new Set<string>();
  const entryFor = (code: string, kind: "cluster" | "singleton", members: string[], golden: NmcEntry["golden"], short: string, long: string): NmcEntry => ({
    code, class_code: code.slice(4, 8), serial: code.slice(9, 16), check_char: code.slice(-1), kind, members, golden,
    short_text: short, long_text: long,
  });
  for (const members of [...cr.clusters].sort((a, b) => pyCmp(a[0], b[0]))) {
    const mrecs = members.map((m) => recById.get(m)!);
    const code = alloc.mint(mrecs[0].class_code);
    const g = goldenRecord(mrecs, cfg);
    const [short, long] = renderTexts(mrecs[0].class_code, g, cfg);
    nmcEntries.push(entryFor(code, "cluster", members, g, short, long));
    for (const m of members) {
      nmcOf.set(m, code);
      clustered.add(m);
    }
  }
  const sortedIds = [...recById.keys()].sort(pyCmp);
  for (const rid of sortedIds) {
    if (clustered.has(rid) || pending.has(rid)) continue;
    const rec = recById.get(rid)!;
    const code = alloc.mint(rec.class_code);
    const tmpl = cfg.classes[rec.class_code];
    let entry: NmcEntry;
    if (tmpl && tmpl.properties.length) {
      const g = goldenRecord([rec], cfg);
      const [short, long] = renderTexts(rec.class_code, g, cfg);
      entry = entryFor(code, "singleton", [rid], g, short, long);
    } else {
      const raw = rawById.get(rid)!;
      entry = entryFor(code, "singleton", [rid], { attributes: {}, conflicts: {} }, pyHead(raw.maktx, 40), raw.maktx);
    }
    nmcEntries.push(entry);
    nmcOf.set(rid, code);
  }

  // ---- RunOutput
  const clusterOf = new Set<string>();
  for (const n of nmcEntries) if (n.kind === "cluster") for (const m of n.members) clusterOf.add(m);
  const views: RecordView[] = records.map((raw) => {
    const rid = raw.record_id;
    const norm = norms.get(rid)!;
    const rec = recById.get(rid)!;
    const tmpl = cfg.classes[rec.class_code];
    const status = clusterOf.has(rid) ? "VERIFIED" : pending.has(rid) ? "REVIEW" : "UNIQUE";
    const attributes: RecordView["attributes"] = {};
    for (const [k, v] of Object.entries(rec.attributes)) attributes[k] = { ...v, span: v.span ? [v.span[0], v.span[1]] : null };
    return {
      id: rid, cpse: raw.cpse, matnr: raw.matnr, raw: raw.maktx, normalized: norm.norm_text,
      transforms: norm.transforms.map((t) => ({ ...t })), class_code: rec.class_code,
      class_name: tmpl && rec.class_code !== "9999" ? tmpl.national_name : "GENERIC", generic: rec.class_code === "9999",
      tier: rec.tier, tier_reasons: [...rec.tier_reasons], attributes, residuals: structuredCloneLite(rec.residuals),
      sanity_flags: rec.sanity_flags.map((f) => ({ ...f })), mfr: raw.mfr, mpn: raw.mpn, mfr_norm: rec.mfr_norm,
      mpn_norm: rec.mpn_norm, uom: norm.uom_norm, price: raw.last_po_price, qty: raw.annual_qty, status, nmc: nmcOf.get(rid) ?? null,
    };
  });

  const statusCounts: Record<string, number> = { VERIFIED: 0, REVIEW: 0, UNIQUE: 0 };
  for (const v of views) statusCounts[v.status]++;
  const byClass: Record<string, number> = {};
  for (const v of views) byClass[v.class_code] = (byClass[v.class_code] ?? 0) + 1;
  const sortedByClass: Record<string, number> = {};
  for (const k of Object.keys(byClass).sort(pyCmp)) sortedByClass[k] = byClass[k];
  const summary: Summary = {
    records: views.length, candidate_pairs: pairs.length, auto: keptCounts.verified, review: keptCounts.review,
    reject: keptCounts.lookalike, filtered: pairs.length - (keptCounts.verified + keptCounts.review + keptCounts.lookalike),
    groups: nmcEntries.filter((n) => n.kind === "cluster").length, unique: nmcEntries.filter((n) => n.kind === "singleton").length,
    pending: statusCounts.REVIEW, generic_records: views.filter((v) => v.generic).length, nmcs: nmcEntries.length,
    by_class: sortedByClass,
  };

  let answerKey: FuzzyComparison["answer_key"] = null;
  if (opts.truth && Object.keys(opts.truth).length) {
    const truth = opts.truth;
    let n = 0, fw = 0, sw = 0;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(truth, k);
    for (let k = 0; k < pairs.length; k++) {
      const p = pairs[k];
      if (has(p.left_id) && has(p.right_id)) {
        n++;
        const same = truth[p.left_id] === truth[p.right_id];
        if (zonesBaseline[k] === "AUTO_MERGE" && !same) fw++;
        if (p.zone === "AUTO_MERGE" && !same) sw++;
      }
    }
    answerKey = { pairs_with_truth: n, fuzzy_wrong: fw, sama_wrong: sw };
  }

  // audit chain: same event sequence as runview.build_run_output
  const finishedAt = now();
  const chain = new AuditChain();
  chain.append(startedAt, "engine", "RUN_STARTED", "run", runId, { records: views.length, scope: opts.scope });
  const counts = [views.length, pairs.length, pairs.length, pairs.length, keptCounts.verified + keptCounts.review + keptCounts.lookalike, nmcEntries.length];
  STAGE_LABELS.forEach((label, i) => chain.append(startedAt, "engine", "STAGE_COMPLETED", "run", runId, { stage: i, label, count: counts[i] }));
  for (let k = 0; k < decisions.length; k++) {
    const d = decisions[k];
    const fired = d.rules.filter((r) => r.fired).map((r) => r.id).join(",");
    chain.append(finishedAt, "engine", "DECISION_RECORDED", "decision", d.id, { zone: d.zone, step: d.zone_step, kind: d.kind, rules_fired: fired });
    if ((k + 1) % 500 === 0) yield { kind: "yield" };
  }
  for (const n of nmcEntries) chain.append(finishedAt, "engine", "NMC_MINTED", "nmc", n.code, { kind: n.kind, members: n.members.length });
  chain.append(finishedAt, "engine", "RUN_FINISHED", "run", runId, {
    auto: summary.auto, review: summary.review, reject: summary.reject, filtered: summary.filtered, nmcs: summary.nmcs,
  });

  const tm = assets.textModel.meta as { version?: number };
  const fuzzy: FuzzyComparison = {
    t_base: gate.tBase, fuzzy_auto: fuzzyAuto, both_auto: bothAuto, stopped_by_sama: fuzzyAuto - bothAuto,
    stopped_ids: stopped.sort(pyCmp), answer_key: answerKey,
  };
  yield progress(5, 1, 1);
  const out: RunOutput = {
    schema: "sama-run/1", run_id: runId, scope: opts.scope, started_at: startedAt, finished_at: finishedAt,
    config_version: cfg.version, config_status: { ...cfg.status }, gate_model: gate.version, text_model: `text_model_v${tm.version ?? 1}`,
    thresholds: { thr_E: Number.isFinite(gate.thrE) ? gate.thrE : null, reject_thr: gate.rejectThr, t_base: gate.tBase },
    summary, records: views, decisions, nmcs: nmcEntries, fuzzy, audit: chain.events as AuditEvent[], warnings: [...(opts.warnings ?? [])],
  };
  return out;
}

function structuredCloneLite(r: RecordView["residuals"]): RecordView["residuals"] {
  return { ignorable: [...r.ignorable], reference: [...r.reference], unknown: [...r.unknown], risk: [...r.risk] };
}

/** Synchronous run (tests, small inputs). */
export function runEngineSync(records: RawRecord[], assets: EngineAssets, opts: RunOptions): RunOutput {
  const gen = engineGen(records, assets, opts);
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (r.value.kind === "progress") opts.onProgress?.(r.value.p);
  }
}

/** Asynchronous run: yields to the event loop about every 25 ms so a worker stays responsive. */
export async function runEngine(records: RawRecord[], assets: EngineAssets, opts: RunOptions): Promise<RunOutput> {
  const gen = engineGen(records, assets, opts);
  let last = Date.now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (r.value.kind === "progress") opts.onProgress?.(r.value.p);
    if (Date.now() - last > 25) {
      await new Promise<void>((res) => setTimeout(res, 0));
      last = Date.now();
    }
  }
}
