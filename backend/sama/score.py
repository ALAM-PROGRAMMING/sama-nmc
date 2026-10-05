"""Pair features, the frozen gate scorer, the ranker, Tier E threshold selection and the
baseline threshold (FR-MATCH-04/08, Architecture §7.7–7.8).

The gate scorer is trained on the synthetic train split and frozen. The ranker starts as a
copy and only ever orders the review queue. Neither is an input to rules R-01…R-09.
"""
from __future__ import annotations

import copy
import math
from dataclasses import dataclass, field

import numpy as np
from scipy.stats import beta
from sklearn.linear_model import LogisticRegression

from .contracts import CandidatePair, RecordAttributes
from .fuzzy import token_set_ratio

SEED = 7


def q6(x: float) -> float:
    """Round to 6 decimals with plain IEEE arithmetic, so Python and the browser engine give
    bit-identical results (Python's round() and Math.round() can differ on ties)."""
    return math.floor(x * 1e6 + 0.5) / 1e6
FEATURES = ("n_crit_agree", "n_crit_conflict", "n_crit_less", "n_crit_missing", "n_noncrit_agree",
            "n_noncrit_conflict", "tfidf_cos", "token_set_ratio", "mfr_eq", "mpn_eq",
            "uom_compat", "same_cpse")


def pair_features(p: CandidatePair, a: RecordAttributes, b: RecordAttributes, text_a: str, text_b: str,
                  tfidf_cos: float, uom_a: str, uom_b: str) -> dict[str, float]:
    crit = [r for r in p.comparison if r.critical]
    non = [r for r in p.comparison if not r.critical]
    return {
        "n_crit_agree": sum(r.state == "agree" for r in crit),
        "n_crit_conflict": sum(r.state == "conflict" for r in crit),
        "n_crit_less": sum(r.state == "less_specific" for r in crit),
        "n_crit_missing": sum(r.state.endswith("missing") for r in crit),
        "n_noncrit_agree": sum(r.state == "agree" for r in non),
        "n_noncrit_conflict": sum(r.state == "conflict" for r in non),
        "tfidf_cos": q6(tfidf_cos),
        "token_set_ratio": token_set_ratio(text_a, text_b),
        "mfr_eq": float(bool(a.mfr_norm) and a.mfr_norm == b.mfr_norm),
        "mpn_eq": float(bool(a.mpn_norm) and a.mpn_norm == b.mpn_norm),
        "uom_compat": float(not uom_a or not uom_b or uom_a == uom_b),
        "same_cpse": float(a.record_id.split(":")[0] == b.record_id.split(":")[0]),
    }


def baseline_score(features: dict[str, float]) -> float:
    """The 'ordinary fuzzy matcher': mean of char TF-IDF cosine and token_set_ratio/100."""
    return (features["tfidf_cos"] + features["token_set_ratio"] / 100.0) / 2.0


@dataclass
class ScoreModel:
    kind: str                       # "gate" | "ranker"
    version: int
    model: LogisticRegression
    frozen: bool
    n_synthetic: int
    n_reviewer: int = 0
    metrics: dict = field(default_factory=dict)

    @property
    def name(self) -> str:
        return f"{self.kind}_v{self.version}"

    def score(self, feats: list[dict[str, float]]) -> np.ndarray:
        X = np.array([[f[k] for k in FEATURES] for f in feats], dtype=float)
        X[:, FEATURES.index("token_set_ratio")] /= 100.0
        return self.model.predict_proba(X)[:, 1]

    def top_features(self, n: int = 4) -> list[list]:
        coefs = sorted(zip(FEATURES, self.model.coef_[0]), key=lambda kv: -abs(kv[1]))[:n]
        return [[k, round(float(v), 3)] for k, v in coefs]


def _fit(feats: list[dict[str, float]], y: list[int]) -> LogisticRegression:
    X = np.array([[f[k] for k in FEATURES] for f in feats], dtype=float)
    X[:, FEATURES.index("token_set_ratio")] /= 100.0
    return LogisticRegression(random_state=SEED, max_iter=2000, C=1.0).fit(X, np.array(y))


def train_gate(feats: list[dict[str, float]], y: list[int]) -> ScoreModel:
    return ScoreModel("gate", 2, _fit(feats, y), frozen=True, n_synthetic=len(y))


def ranker_from_gate(gate: ScoreModel) -> ScoreModel:
    return ScoreModel("ranker", 1, copy.deepcopy(gate.model), frozen=False, n_synthetic=gate.n_synthetic)


def retrain_ranker(prev: ScoreModel, syn_feats, syn_y, rev_feats, rev_y) -> ScoreModel:
    return ScoreModel("ranker", prev.version + 1, _fit(list(syn_feats) + list(rev_feats), list(syn_y) + list(rev_y)),
                      frozen=False, n_synthetic=len(syn_y), n_reviewer=len(rev_y))


# ---------------------------------------------------------------- thresholds (§7.8)
def cp_upper(e: int, n: int, conf: float = 0.95) -> float:
    """One-sided Clopper–Pearson upper bound on the error rate."""
    if n == 0:
        return 1.0
    return 1.0 if e >= n else float(beta.ppf(conf, e + 1, n - e))


def min_n_for(budget: float = 0.005, conf: float = 0.95) -> int:
    return math.ceil(math.log(1 - conf) / math.log(1 - budget))


@dataclass
class ThresholdResult:
    threshold: float
    min_n: int
    n_eligible: int
    n_above: int
    errors: int
    upper_bound_95: float | None
    stopped_reason: str

    @property
    def sufficient(self) -> bool:
        return math.isfinite(self.threshold)


def select_threshold(eligible: list[tuple[float, bool]], budget: float = 0.005, conf: float = 0.95) -> ThresholdResult:
    """`eligible` = (gate_score, is_match) for auto-eligible Tier E calibration pairs."""
    need = min_n_for(budget, conf)
    best, best_n, best_e = None, 0, 0
    reason = "reached lowest candidate"
    for t in sorted({s for s, _ in eligible}, reverse=True):
        S = [m for s, m in eligible if s >= t]
        n, e = len(S), sum(not m for m in S)
        if n < need:
            continue
        if cp_upper(e, n, conf) <= budget:
            best, best_n, best_e = t, n, e
        else:
            reason = f"bound exceeded budget at t={t:.4f}"
            break
    if best is None:
        return ThresholdResult(float("inf"), need, len(eligible), 0, 0, None,
                               f"insufficient calibration evidence: {len(eligible)} eligible < {need} required"
                               if len(eligible) < need else reason)
    return ThresholdResult(best, need, len(eligible), best_n, best_e, cp_upper(best_e, best_n, conf), reason)


def best_f1_threshold(scored: list[tuple[float, bool]]) -> tuple[float, float]:
    """Threshold maximising F1 (the baseline is shown at its best, not tuned to look bad)."""
    pos = sum(m for _, m in scored)
    best_t, best_f1 = 1.0, -1.0
    order = sorted(scored, key=lambda x: -x[0])
    tp = fp = 0
    i = 0
    while i < len(order):
        t = order[i][0]
        while i < len(order) and order[i][0] == t:
            tp += order[i][1]
            fp += not order[i][1]
            i += 1
        f1 = 2 * tp / (2 * tp + fp + (pos - tp)) if pos else 0.0
        if f1 > best_f1:
            best_t, best_f1 = t, f1
    return best_t, best_f1
