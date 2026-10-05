"""Batch pipeline orchestration (Architecture §4).

ingest → normalize → classify → normalize(2) → extract → tier → block → compare → rules →
gate score → zone (sama) | baseline | model_only on the SAME candidate pairs → verified
clustering → NMC for verified clusters and singletons. Only `sama` decisions reach the master
layer; baseline and model_only are benchmark-only outputs (I-17).

CLI: python -m sama.pipeline --data ../data/synthetic/demo --out ../data/runs/demo
"""
from __future__ import annotations

import argparse
import json
import math
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from .block import TextIndex, block
from .classify import classify
from .cluster import verified_clusters
from .config import Config, default_config
from .contracts import CandidatePair, NormRecord, RawRecord, RecordAttributes
from .decide import assign_tier, build_pair, zone, zone_baseline, zone_model_only
from .extract import extract, parse_characteristics
from .nmc import SerialAllocator, golden_record, render_texts
from .normalize import apply_pass2, normalize_record
from .textmodel import TextModel, fit_text_model
from .score import (q6, ScoreModel, ThresholdResult, baseline_score, best_f1_threshold, cp_upper, pair_features,
                    ranker_from_gate, select_threshold, train_gate)

MODES = ("sama", "baseline", "model_only")


@dataclass
class RunResult:
    run_id: str
    config: Config
    evidence_scope: str
    raws: dict[str, RawRecord]
    norms: dict[str, NormRecord]
    recs: dict[str, RecordAttributes]
    pairs: dict[tuple[str, str], CandidatePair]
    truth: dict[str, str]                                   # record_id -> true_material_id
    split: dict[str, str]                                   # record_id -> train|calibration|test
    pair_types: dict[tuple[str, str], str]
    gate: ScoreModel
    ranker: ScoreModel
    thr: ThresholdResult
    thr_E: float
    thr_is_demo: bool
    t_base: float
    t_base_f1: float
    reject_thr: float
    zones: dict[str, dict[tuple[str, str], str]]          # mode -> pair -> zone
    nmc_of: dict[str, str] = field(default_factory=dict)   # record_id -> NMC (final decisions only)
    nmcs: dict[str, dict] = field(default_factory=dict)    # NMC -> {members, golden, short, long, kind}
    pending: set[str] = field(default_factory=set)         # records with an open review item
    metrics: dict = field(default_factory=dict)
    timings: dict = field(default_factory=dict)
    index: TextIndex | None = None
    text_model: TextModel | None = None

    def is_match(self, key: tuple[str, str]) -> bool | None:
        a, b = key
        if a not in self.truth or b not in self.truth:
            return None
        return self.truth[a] == self.truth[b]

    def pair_split(self, key: tuple[str, str]) -> str:
        a, b = (self.split.get(k, "") for k in key)
        return a if a == b else "cross"

    def get_pair(self, a: str, b: str) -> CandidatePair:
        key = (a, b) if a < b else (b, a)
        p = self.pairs.get(key)
        if p is None:                                        # not blocked together: evaluate on the fly
            p = build_pair(self.recs[key[0]], self.recs[key[1]], self.config, blockers=["verify"])
        return p

    def score_pair(self, a: str, b: str) -> CandidatePair:
        """Full sama decision for any two records, blocked together or not (used for demos and
        check-before-create). Same features, frozen gate, thresholds and zone as the batch run."""
        key = (a, b) if a < b else (b, a)
        if key in self.pairs:
            return self.pairs[key]
        p = build_pair(self.recs[key[0]], self.recs[key[1]], self.config, blockers=["on_demand"])
        n0, n1 = self.norms[key[0]], self.norms[key[1]]
        p.features = pair_features(p, self.recs[key[0]], self.recs[key[1]], n0.norm_text, n1.norm_text,
                                   self.index.cos(*key), n0.uom_norm, n1.uom_norm)
        p.baseline_score = q6(baseline_score(p.features))
        p.gate_score = q6(float(self.gate.score([p.features])[0]))
        p.rank_score = q6(float(self.ranker.score([p.features])[0]))
        p.zone, p.zone_step, p.zone_reason = zone(p, self.thr_E, self.reject_thr, self.config)
        return p


def load_records(path: Path) -> tuple[list[RawRecord], dict[str, str], dict[str, str], pd.DataFrame]:
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    raws, truth, split = [], {}, {}
    for r in df.to_dict("records"):
        raws.append(RawRecord(
            record_id=r["record_id"], cpse=r["cpse"], matnr=r["matnr"], maktx=r["maktx"],
            long_text=r.get("long_text", ""), mtart=r.get("mtart", ""), matkl=r.get("matkl", ""),
            meins=r.get("meins", ""), characteristics=parse_characteristics(r.get("characteristics")),
            mfr=r.get("mfr", ""), mpn=r.get("mpn", ""),
            last_po_price=float(r["last_po_price"]) if r.get("last_po_price") else None,
            annual_qty=float(r["annual_qty"]) if r.get("annual_qty") else None, plant=r.get("plant", "")))
        if r.get("true_material_id"):
            truth[r["record_id"]] = r["true_material_id"]
        if r.get("split"):
            split[r["record_id"]] = r["split"]
    return raws, truth, split, df


def load_pair_types(path: Path) -> dict[tuple[str, str], str]:
    if not path.exists():
        return {}
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    return {tuple(sorted((r["left_id"], r["right_id"]))): r["pair_type"] for r in df.to_dict("records")}


def standardise(raws: list[RawRecord], cfg: Config) -> tuple[dict[str, NormRecord], dict[str, RecordAttributes]]:
    norms, recs = {}, {}
    for raw in raws:
        n = normalize_record(raw, cfg)
        c = classify(n.norm_text, cfg)
        n = apply_pass2(n, c.class_code, cfg)
        norms[raw.record_id] = n
        recs[raw.record_id] = assign_tier(extract(raw, n, c, cfg), cfg)
    return norms, recs


def run(data_dir: Path | str, cfg: Config | None = None, evidence_scope: str = "synthetic", run_id: str = "RUN-0001",
        gate: ScoreModel | None = None, thr_E: float | None = None, t_base: float | None = None,
        demo_threshold: float | None = None, text_model: TextModel | None = None) -> RunResult:
    """Run the full pipeline. With `gate`/`thr_E`/`t_base` given (e.g. an unseen-noise set), the
    frozen models and thresholds from a previous run are reused, never re-fitted on this data."""
    cfg = cfg or default_config()
    data_dir = Path(data_dir)
    t0 = time.perf_counter()
    raws_l, truth, split, _ = load_records(data_dir / "records.csv")
    raws = {r.record_id: r for r in raws_l}
    pair_types = load_pair_types(data_dir / "pair_labels.csv")
    norms, recs = standardise(raws_l, cfg)
    t1 = time.perf_counter()

    if text_model is None:                                  # benchmark training run: fit once on the train split
        train_texts = [n.norm_text for rid, n in norms.items() if split.get(rid) == "train"] or                       [n.norm_text for n in norms.values()]
        text_model = fit_text_model(train_texts)
    index = TextIndex({rid: n.norm_text for rid, n in norms.items()}, text_model)
    blocked = block(recs, index, cfg)
    pairs: dict[tuple[str, str], CandidatePair] = {}
    for (a, b), how in blocked.items():
        p = build_pair(recs[a], recs[b], cfg, blockers=how)
        p.features = pair_features(p, recs[a], recs[b], norms[a].norm_text, norms[b].norm_text,
                                   index.cos(a, b), norms[a].uom_norm, norms[b].uom_norm)
        p.baseline_score = q6(baseline_score(p.features))
        pairs[(a, b)] = p
    t2 = time.perf_counter()

    res = RunResult(run_id=run_id, config=cfg, evidence_scope=evidence_scope, raws=raws, norms=norms, recs=recs,
                    pairs=pairs, truth=truth, split=split, pair_types=pair_types, gate=None, ranker=None,  # type: ignore[arg-type]
                    thr=None, thr_E=math.inf, thr_is_demo=False, t_base=1.0, t_base_f1=0.0,          # type: ignore[arg-type]
                    reject_thr=float(cfg["tiers"]["reject_threshold"]), zones={}, index=index, text_model=text_model)
    keys = list(pairs)

    # ---- frozen gate scorer: trained on the synthetic train split only
    if gate is None:
        train = [k for k in keys if res.pair_split(k) == "train" and res.is_match(k) is not None]
        gate = train_gate([pairs[k].features for k in train], [int(bool(res.is_match(k))) for k in train])
    res.gate, res.ranker = gate, ranker_from_gate(gate)
    if keys:
        g = gate.score([pairs[k].features for k in keys])
        r = res.ranker.score([pairs[k].features for k in keys])
        for k, gs, rs in zip(keys, g, r):
            pairs[k].gate_score, pairs[k].rank_score = q6(float(gs)), q6(float(rs))

    # ---- Tier E threshold on auto-eligible calibration pairs (§7.8)
    calib = [k for k in keys if res.pair_split(k) == "calibration" and res.is_match(k) is not None]
    if thr_E is None:
        eligible = [(pairs[k].gate_score, bool(res.is_match(k))) for k in calib
                    if zone(pairs[k], -math.inf, res.reject_thr, cfg)[1] == 8]
        res.thr = select_threshold(eligible, float(cfg["tiers"]["budget_E"]), float(cfg["tiers"]["confidence_level"]))
        res.thr_E = res.thr.threshold
        if not res.thr.sufficient and demo_threshold is not None:
            res.thr_E, res.thr_is_demo = demo_threshold, True
    else:
        res.thr = ThresholdResult(thr_E, 0, 0, 0, 0, None, "reused from calibration run")
        res.thr_E = thr_E
    # ---- baseline threshold: max F1 on calibration (the baseline at its best)
    if t_base is None:
        res.t_base, res.t_base_f1 = best_f1_threshold([(pairs[k].baseline_score, bool(res.is_match(k))) for k in calib])
    else:
        res.t_base = t_base

    # ---- zones, all three modes on identical candidate pairs
    res.zones = {m: {} for m in MODES}
    for k in keys:
        p = pairs[k]
        z, step, why = zone(p, res.thr_E, res.reject_thr, cfg)
        p.zone, p.zone_step, p.zone_reason = z, step, why
        res.zones["sama"][k] = z
        res.zones["baseline"][k] = zone_baseline(p, res.t_base)
        res.zones["model_only"][k] = zone_model_only(p, res.thr_E, res.reject_thr)
    t3 = time.perf_counter()

    mint_master_layer(res)
    res.metrics = evaluate(res)
    res.timings = {"standardise_s": round(t1 - t0, 2), "block_compare_s": round(t2 - t1, 2),
                   "score_zone_s": round(t3 - t2, 2), "total_s": round(time.perf_counter() - t0, 2),
                   "n_records": len(raws), "n_pairs": len(pairs)}
    return res


def mint_master_layer(res: RunResult, start_serial: int = 1) -> None:
    """Decision order (FR-GOV-09 / FR-NMC-07), automatic part only: verified AUTO_MERGE clusters
    are minted; records with an open REVIEW item stay pending (no NMC); the rest get singletons.
    Reviewer approvals reach the master layer later through governance."""
    cfg = res.config
    auto = [p for k, p in res.pairs.items() if p.zone == "AUTO_MERGE"]
    cr = verified_clusters(auto, res.get_pair, int(cfg["tiers"]["cluster_size_alarm"]))
    res.pending = {rid for k, p in res.pairs.items() if p.zone == "REVIEW" for rid in k} | cr.bridges
    res.pending |= {rid for comp in cr.alarms for rid in comp}
    alloc = SerialAllocator(start_serial)
    clustered: set[str] = set()
    for members in sorted(cr.clusters, key=lambda m: m[0]):
        recs = [res.recs[m] for m in members]
        code = alloc.mint(recs[0].class_code)
        g = golden_record(recs, cfg)
        short, long = render_texts(recs[0].class_code, g, cfg)
        res.nmcs[code] = {"members": members, "golden": g, "short_text": short, "long_text": long, "kind": "cluster"}
        for m in members:
            res.nmc_of[m] = code
        clustered.update(members)
    for rid in sorted(res.recs):
        if rid in clustered or rid in res.pending:
            continue
        rec = res.recs[rid]
        code = alloc.mint(rec.class_code)
        if rec.class_code in cfg.classes and cfg.classes[rec.class_code].properties:
            g = golden_record([rec], cfg)
            short, long = render_texts(rec.class_code, g, cfg)
        else:
            g, short, long = {"attributes": {}, "conflicts": {}}, res.raws[rid].maktx[:40], res.raws[rid].maktx
        res.nmcs[code] = {"members": [rid], "golden": g, "short_text": short, "long_text": long, "kind": "singleton"}
        res.nmc_of[rid] = code


def evaluate(res: RunResult, splits: tuple[str, ...] = ("test",)) -> dict:
    """Counts on pairs whose records are both in `splits` (all pairs if the data has no splits)."""
    has_split = bool(res.split)
    keys = [k for k in res.pairs if res.is_match(k) is not None and (not has_split or res.pair_split(k) in splits)]
    out: dict = {"evidence_scope": res.evidence_scope, "splits": list(splits) if has_split else ["all"],
                 "n_pairs": len(keys), "modes": {}, "by_pair_type": {}}
    for m in MODES:
        c = Counter()
        for k in keys:
            z, match = res.zones[m][k], res.is_match(k)
            if z == "AUTO_MERGE":
                c["auto_correct" if match else "auto_wrong"] += 1
            elif z == "REVIEW":
                c["review_match" if match else "review_nonmatch"] += 1
            else:
                c["reject_match" if match else "reject_nonmatch"] += 1
        n_auto = c["auto_correct"] + c["auto_wrong"]
        n_true = sum(bool(res.is_match(k)) for k in keys)
        out["modes"][m] = {
            "auto_correct": c["auto_correct"], "auto_wrong": c["auto_wrong"],
            "review": c["review_match"] + c["review_nonmatch"], "reject": c["reject_match"] + c["reject_nonmatch"],
            "reject_true_match": c["reject_match"],
            "auto_precision": round(c["auto_correct"] / n_auto, 4) if n_auto else None,
            "upper_bound_95": round(cp_upper(c["auto_wrong"], n_auto), 5) if n_auto else None,
            "total_recall": round((c["auto_correct"] + c["review_match"]) / n_true, 4) if n_true else None,
        }
    types = defaultdict(Counter)
    for k in keys:
        t = res.pair_types.get(k, "identical" if res.is_match(k) else "random")
        for m in MODES:
            types[t][f"{m}:{res.zones[m][k]}"] += 1
    out["by_pair_type"] = {t: dict(c) for t, c in sorted(types.items())}
    # blocking recall: labelled true-match pairs in scope that were produced as candidates
    by_mat = defaultdict(list)
    for rid, mat in res.truth.items():
        if not has_split or res.split.get(rid) in splits:
            by_mat[mat].append(rid)
    true_pairs = {tuple(sorted((a, b))) for ms in by_mat.values() for i, a in enumerate(ms) for b in ms[i + 1:]}
    found = sum(1 for k in true_pairs if k in res.pairs)
    out["blocking"] = {"true_pairs": len(true_pairs), "found": found,
                       "recall": round(found / len(true_pairs), 4) if true_pairs else None}
    zc = Counter(res.zones["sama"][k] for k in keys)
    out["zone_split"] = dict(zc)
    out["threshold"] = {"thr_E": res.thr_E if math.isfinite(res.thr_E) else None, "is_demo": res.thr_is_demo,
                        "min_n": res.thr.min_n, "n_eligible": res.thr.n_eligible, "n_above": res.thr.n_above,
                        "errors": res.thr.errors, "upper_bound_95": res.thr.upper_bound_95,
                        "stopped_reason": res.thr.stopped_reason,
                        "t_base": round(res.t_base, 4), "t_base_f1": round(res.t_base_f1, 4)}
    out["safety"] = safety_counts(res, keys)
    return out


def safety_counts(res: RunResult, keys) -> dict:
    """Hard-gate counts (PRD §11) in sama mode: must all be zero on synthetic and unseen-noise."""
    from .decide import qualifying_mpn
    c = Counter()
    for k in keys:
        if res.zones["sama"][k] != "AUTO_MERGE":
            continue
        t = res.pair_types.get(k, "")
        if not res.is_match(k):
            c["auto_false_merges"] += 1
        if t in ("trap", "riskword", "mpn_suffix"):
            c[f"auto_{t}"] += 1
        if t == "downgrade" and not qualifying_mpn(res.pairs[k]):
            c["auto_downgrade_without_mpn"] += 1
    base = {"auto_false_merges": 0, "auto_trap": 0, "auto_riskword": 0, "auto_mpn_suffix": 0,
            "auto_downgrade_without_mpn": 0}
    base.update(c)
    base["passed"] = all(v == 0 for v in base.values())
    return base


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--scope", default="synthetic")
    ap.add_argument("--demo-threshold", type=float, default=None)
    args = ap.parse_args()
    res = run(args.data, evidence_scope=args.scope, demo_threshold=args.demo_threshold)
    print(json.dumps({"timings": res.timings, **res.metrics}, indent=2, default=str))


if __name__ == "__main__":
    main()
