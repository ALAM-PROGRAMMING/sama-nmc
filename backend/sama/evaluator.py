"""Evaluator-mode run: no ground truth, frozen artifacts only.

This is the reference for what the browser engine does on the sample data and on uploads:
standardise -> block (frozen text model) -> compare -> rules R-01..R-09 -> frozen gate score ->
nine-step zone -> verified clustering -> NMC + crosswalk. Nothing is trained or fitted here.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

from .block import TextIndex, block
from .config import Config, default_config
from .contracts import CandidatePair, NormRecord, RawRecord, RecordAttributes
from .decide import build_pair, zone
from .pipeline import mint_master_layer, standardise
from .score import baseline_score, pair_features, q6
from .textmodel import TextModel

ASSETS_DIR = Path(__file__).resolve().parents[2] / "engine_assets"


class FrozenGate:
    """Logistic gate scorer read straight from gate.json (not scikit-learn), so the export itself is verified."""

    def __init__(self, d: dict):
        self.version: str = d["version"]
        self.features: list[str] = d["features"]
        self.scaling: dict[str, float] = d.get("feature_scaling", {})
        self.coef: list[float] = d["coef"]
        self.intercept: float = d["intercept"]
        self.thr_E: float = d["thr_E"] if d["thr_E"] is not None else math.inf
        self.reject_thr: float = d["reject_thr"]
        self.t_base: float = d["t_base"]
        self.raw = d

    def score(self, feats: dict[str, float]) -> float:
        z = self.intercept
        for name, w in zip(self.features, self.coef):
            z += w * (feats[name] / self.scaling.get(name, 1.0))
        if z >= 0:
            return 1.0 / (1.0 + math.exp(-z))
        e = math.exp(z)
        return e / (1.0 + e)


@dataclass
class Assets:
    cfg: Config
    text_model: TextModel
    gate: FrozenGate


def load_assets(cfg: Config | None = None, directory: Path | str = ASSETS_DIR) -> Assets:
    d = Path(directory)
    return Assets(cfg or default_config(), TextModel.load(d / "text_model.json"),
                  FrozenGate(json.loads((d / "gate.json").read_text(encoding="utf-8"))))


@dataclass
class EvalResult:
    run_id: str
    config: Config
    assets: Assets
    raws: dict[str, RawRecord]
    norms: dict[str, NormRecord]
    recs: dict[str, RecordAttributes]
    pairs: dict[tuple[str, str], CandidatePair]
    index: TextIndex
    zones_baseline: dict[tuple[str, str], str] = field(default_factory=dict)
    nmc_of: dict[str, str] = field(default_factory=dict)
    nmcs: dict[str, dict] = field(default_factory=dict)
    pending: set[str] = field(default_factory=set)

    def get_pair(self, a: str, b: str) -> CandidatePair:
        key = (a, b) if a < b else (b, a)
        p = self.pairs.get(key)
        if p is None:                                        # not blocked together: rules only, evaluated on the fly
            p = build_pair(self.recs[key[0]], self.recs[key[1]], self.config, blockers=["verify"])
        return p


def evaluate(raws: list[RawRecord], assets: Assets, run_id: str = "RUN-0001") -> EvalResult:
    cfg, gate = assets.cfg, assets.gate
    norms, recs = standardise(raws, cfg)
    index = TextIndex({rid: n.norm_text for rid, n in norms.items()}, assets.text_model)
    blocked = block(recs, index, cfg)
    pairs: dict[tuple[str, str], CandidatePair] = {}
    zones_baseline: dict[tuple[str, str], str] = {}
    for key in sorted(blocked):
        a, b = key
        p = build_pair(recs[a], recs[b], cfg, blockers=blocked[key])
        p.features = pair_features(p, recs[a], recs[b], norms[a].norm_text, norms[b].norm_text,
                                   index.cos(a, b), norms[a].uom_norm, norms[b].uom_norm)
        p.baseline_score = q6(baseline_score(p.features))
        p.gate_score = q6(gate.score(p.features))
        p.zone, p.zone_step, p.zone_reason = zone(p, gate.thr_E, gate.reject_thr, cfg)
        pairs[key] = p
        zones_baseline[key] = "AUTO_MERGE" if p.baseline_score >= gate.t_base else "REVIEW"
    res = EvalResult(run_id=run_id, config=cfg, assets=assets, raws={r.record_id: r for r in raws}, norms=norms,
                     recs=recs, pairs=pairs, index=index, zones_baseline=zones_baseline)
    mint_master_layer(res)                                   # duck-typed: needs pairs, recs, raws, config, get_pair
    return res


def records_from_csv(path: Path | str) -> list[RawRecord]:
    """Read the SAMA-NMC evaluator CSV format (required: cpse, matnr, maktx)."""
    import csv

    from .extract import parse_characteristics
    out: list[RawRecord] = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            def num(k: str):
                v = (row.get(k) or "").strip()
                return float(v) if v else None
            out.append(RawRecord(
                record_id=f"{row['cpse'].strip()}:{row['matnr'].strip()}", cpse=row["cpse"].strip(),
                matnr=row["matnr"].strip(), maktx=row["maktx"].strip(), long_text=(row.get("long_text") or "").strip(),
                meins=(row.get("meins") or "").strip(), mfr=(row.get("mfr") or "").strip(),
                mpn=(row.get("mpn") or "").strip(), last_po_price=num("last_po_price"), annual_qty=num("annual_qty"),
                characteristics=parse_characteristics(row.get("characteristics"))))
    return out


def evaluate_pair(left: RawRecord, right: RawRecord, assets: Assets) -> CandidatePair:
    """Decide ONE pair on its own (no blocking, no corpus): same features, frozen gate and zone as a run.
    Used for parity fixtures and check-before-create. `left.record_id` must sort before `right.record_id`."""
    cfg, gate = assets.cfg, assets.gate
    norms, recs = standardise([left, right], cfg)
    a, b = left.record_id, right.record_id
    p = build_pair(recs[a], recs[b], cfg, blockers=["direct"])
    va, vb = assets.text_model.vector(norms[a].norm_text), assets.text_model.vector(norms[b].norm_text)
    p.features = pair_features(p, recs[a], recs[b], norms[a].norm_text, norms[b].norm_text,
                               assets.text_model.cosine(va, vb), norms[a].uom_norm, norms[b].uom_norm)
    p.baseline_score = q6(baseline_score(p.features))
    p.gate_score = q6(gate.score(p.features))
    p.zone, p.zone_step, p.zone_reason = zone(p, gate.thr_E, gate.reject_thr, cfg)
    return p
