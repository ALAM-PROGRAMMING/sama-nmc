/** Standalone helpers mirroring pipeline.standardise and evaluator.evaluate_pair (no blocking, no corpus). */
import { classify } from "./classify";
import { assignTier, buildPair, zone, type Pair } from "./decide";
import { extract, type RecAttrs } from "./extract";
import { applyPass2, normalizeRecord, type NormRecord } from "./normalize";
import { baselineScore, gateFor, pairFeatures, q6 } from "./score";
import { TextModel, textModelFor } from "./textmodel";
import type { ConfigAsset, EngineAssets, RawRecord } from "./types";

export function standardiseOne(raw: RawRecord, cfg: ConfigAsset): { norm: NormRecord; rec: RecAttrs } {
  let norm = normalizeRecord(raw, cfg);
  const cls = classify(norm.norm_text, cfg);
  norm = applyPass2(norm, cls.class_code, cfg);
  return { norm, rec: assignTier(extract(raw, norm, cls, cfg), cfg) };
}

/** Decide ONE pair on its own: same features, frozen gate and zone as a run. `left.record_id` must sort before `right.record_id`. */
export function evaluatePair(left: RawRecord, right: RawRecord, assets: EngineAssets): Pair {
  const cfg = assets.config;
  const gate = gateFor(assets.gate);
  const model = textModelFor(assets.textModel);
  const l = standardiseOne(left, cfg);
  const r = standardiseOne(right, cfg);
  const p = buildPair(l.rec, r.rec, cfg, ["direct"]);
  const cos = TextModel.cosine(model.vector(l.norm.norm_text), model.vector(r.norm.norm_text));
  p.features = pairFeatures(p.comparison, l.rec, r.rec, l.norm.norm_text, r.norm.norm_text, cos, l.norm.uom_norm, r.norm.uom_norm);
  p.baseline_score = q6(baselineScore(p.features));
  p.gate_score = q6(gate.score(p.features));
  [p.zone, p.zone_step, p.zone_reason] = zone(p, gate.thrE, gate.rejectThr, cfg);
  return p;
}
