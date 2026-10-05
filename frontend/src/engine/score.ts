/** Pair features, baseline score and the frozen gate scorer: port of backend/sama/score.py and evaluator.FrozenGate. */
import type { CompareRow, GateAsset } from "./types";
import { tokenSetRatio } from "./fuzzy";

/** Round to 6 decimals with plain IEEE arithmetic (identical in Python and here). Never Math.round. */
export function q6(x: number): number {
  return Math.floor(x * 1e6 + 0.5) / 1e6;
}

export const FEATURES = [
  "n_crit_agree", "n_crit_conflict", "n_crit_less", "n_crit_missing", "n_noncrit_agree", "n_noncrit_conflict",
  "tfidf_cos", "token_set_ratio", "mfr_eq", "mpn_eq", "uom_compat", "same_cpse",
] as const;

export function pairFeatures(
  comparison: CompareRow[],
  a: { record_id: string; mfr_norm: string; mpn_norm: string },
  b: { record_id: string; mfr_norm: string; mpn_norm: string },
  textA: string,
  textB: string,
  tfidfCos: number,
  uomA: string,
  uomB: string,
): Record<string, number> {
  const crit = comparison.filter((r) => r.critical);
  const non = comparison.filter((r) => !r.critical);
  const count = (rows: CompareRow[], f: (r: CompareRow) => boolean) => rows.reduce((n, r) => n + (f(r) ? 1 : 0), 0);
  return {
    n_crit_agree: count(crit, (r) => r.state === "agree"),
    n_crit_conflict: count(crit, (r) => r.state === "conflict"),
    n_crit_less: count(crit, (r) => r.state === "less_specific"),
    n_crit_missing: count(crit, (r) => r.state.endsWith("missing")),
    n_noncrit_agree: count(non, (r) => r.state === "agree"),
    n_noncrit_conflict: count(non, (r) => r.state === "conflict"),
    tfidf_cos: q6(tfidfCos),
    token_set_ratio: tokenSetRatio(textA, textB),
    mfr_eq: a.mfr_norm && a.mfr_norm === b.mfr_norm ? 1 : 0,
    mpn_eq: a.mpn_norm && a.mpn_norm === b.mpn_norm ? 1 : 0,
    uom_compat: !uomA || !uomB || uomA === uomB ? 1 : 0,
    same_cpse: a.record_id.split(":")[0] === b.record_id.split(":")[0] ? 1 : 0,
  };
}

/** The "ordinary fuzzy matcher": mean of char TF-IDF cosine and token_set_ratio/100. */
export function baselineScore(f: Record<string, number>): number {
  return (f["tfidf_cos"] + f["token_set_ratio"] / 100.0) / 2.0;
}

/** Logistic gate scorer read straight from gate.json. */
export class FrozenGate {
  readonly version: string;
  readonly features: string[];
  readonly scaling: Record<string, number>;
  readonly coef: number[];
  readonly intercept: number;
  readonly thrE: number;
  readonly rejectThr: number;
  readonly tBase: number;

  constructor(d: GateAsset) {
    this.version = d.version;
    this.features = d.features;
    this.scaling = d.feature_scaling ?? {};
    this.coef = d.coef;
    this.intercept = d.intercept;
    this.thrE = d.thr_E !== null && d.thr_E !== undefined ? d.thr_E : Infinity;
    this.rejectThr = d.reject_thr;
    this.tBase = d.t_base;
  }

  score(feats: Record<string, number>): number {
    let z = this.intercept;
    for (let i = 0; i < this.features.length; i++) {
      const name = this.features[i];
      const sc = Object.prototype.hasOwnProperty.call(this.scaling, name) ? this.scaling[name] : 1.0;
      z += this.coef[i] * (feats[name] / sc);
    }
    if (z >= 0) return 1.0 / (1.0 + Math.exp(-z));
    const e = Math.exp(z);
    return e / (1.0 + e);
  }
}

const gateCache = new WeakMap<GateAsset, FrozenGate>();

export function gateFor(asset: GateAsset): FrozenGate {
  let g = gateCache.get(asset);
  if (!g) {
    g = new FrozenGate(asset);
    gateCache.set(asset, g);
  }
  return g;
}
