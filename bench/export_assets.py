"""Export the frozen engine artifacts shared by the Python reference and the browser engine.

Writes (canonical copy in engine_assets/, mirrored to frontend/public/engine/):
  config.json      every YAML table + class template + status + config version
  text_model.json  frozen character n-gram TF-IDF model (SC-02)
  gate.json        frozen gate scorer v2 + thresholds (Tier E, reject, baseline)
and frontend/public/data/benchmark.json (offline benchmark results for the Analytics screen).

Hard safety gates are re-checked here; the export refuses to write artifacts if one fails.

    python -m bench.export_assets --data data/synthetic/demo --unseen data/synthetic/unseen
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import math
import shutil
import sys
from pathlib import Path

from sama.config import Config, default_config
from sama.pipeline import RunResult, run
from sama.score import FEATURES

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "engine_assets"
PUBLIC_ENGINE = ROOT / "frontend" / "public" / "engine"
PUBLIC_DATA = ROOT / "frontend" / "public" / "data"


def config_to_json(cfg: Config) -> dict:
    classes = {}
    for code, c in cfg.classes.items():
        d = dataclasses.asdict(c)
        d["head_patterns"] = list(c.head_patterns)
        d["properties"] = [dict(p) for p in c.properties]
        classes[code] = d
    return {"version": cfg.version, "status": cfg.status, "tables": cfg.tables, "classes": classes}


def gate_to_json(res: RunResult) -> dict:
    m = res.gate.model
    return {
        "version": res.gate.name, "frozen": True, "features": list(FEATURES),
        "feature_scaling": {"token_set_ratio": 100.0},          # the feature is divided by 100 before the dot product
        "coef": [float(x) for x in m.coef_[0]], "intercept": float(m.intercept_[0]),
        "thr_E": res.thr_E if math.isfinite(res.thr_E) else None, "reject_thr": res.reject_thr, "t_base": res.t_base,
        "calibration": {"evidence_scope": "synthetic", "min_n": res.thr.min_n, "n_eligible": res.thr.n_eligible,
                        "n_above": res.thr.n_above, "errors": res.thr.errors, "upper_bound_95": res.thr.upper_bound_95,
                        "stopped_reason": res.thr.stopped_reason, "t_base_f1": res.t_base_f1},
        "trained_on": {"split": "train", "n_pairs": res.gate.n_synthetic},
    }


def pick_examples(res: RunResult, limit: int = 4) -> list[dict]:
    """Pairs the ordinary fuzzy matcher auto-merged that are NOT the same item, with SAMA's decision."""
    test = [k for k in res.pairs if res.pair_split(k) == "test" and res.is_match(k) is not None]
    wrong = [k for k in test if res.zones["baseline"][k] == "AUTO_MERGE" and not res.is_match(k)
             and res.norms[k[0]].norm_text != res.norms[k[1]].norm_text]

    def conflict(k):
        return next((r.property for r in res.pairs[k].comparison if r.critical and r.state == "conflict"), None)
    wrong.sort(key=lambda k: (conflict(k) is None, res.pair_types.get(k) != "riskword", -res.pairs[k].baseline_score, k))
    out, seen = [], set()
    for k in wrong:
        why = conflict(k) or res.pair_types.get(k, "random")
        if why in seen:
            continue
        seen.add(why)
        p = res.pairs[k]
        out.append({"left_raw": res.raws[k[0]].maktx, "right_raw": res.raws[k[1]].maktx,
                    "left_cpse": res.raws[k[0]].cpse, "right_cpse": res.raws[k[1]].cpse,
                    "pair_type": res.pair_types.get(k, "random"), "baseline_score": p.baseline_score,
                    "baseline_zone": "AUTO_MERGE", "sama_zone": p.zone, "sama_step": p.zone_step,
                    "sama_reason": p.zone_reason, "comparison": [r.model_dump() for r in p.comparison]})
        if len(out) == limit:
            break
    return out


def check_gates(name: str, res: RunResult) -> list[str]:
    s, errs = res.metrics["safety"], []
    if not s["passed"]:
        errs.append(f"{name}: safety gate failed {s}")
    if name == "synthetic" and (res.metrics["blocking"]["recall"] or 0) < 0.98:
        errs.append(f"{name}: blocking recall {res.metrics['blocking']['recall']} < 0.98")
    if name == "synthetic" and not res.thr.sufficient:
        errs.append(f"{name}: insufficient calibration evidence ({res.thr.stopped_reason})")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--unseen", required=True)
    a = ap.parse_args()
    cfg = default_config()
    main_run = run(a.data, cfg, "synthetic")
    unseen = run(a.unseen, cfg, "unseen_noise", run_id="RUN-0002", gate=main_run.gate, thr_E=main_run.thr_E,
                 t_base=main_run.t_base, text_model=main_run.text_model)
    errs = check_gates("synthetic", main_run) + check_gates("unseen_noise", unseen)
    if errs:
        print("HARD GATE FAILED, artifacts NOT written:\n  " + "\n  ".join(errs), file=sys.stderr)
        return 1
    ASSETS.mkdir(exist_ok=True)
    PUBLIC_ENGINE.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    main_run.text_model.save(ASSETS / "text_model.json")
    (ASSETS / "gate.json").write_text(json.dumps(gate_to_json(main_run), indent=1), encoding="utf-8")
    (ASSETS / "config.json").write_text(json.dumps(config_to_json(cfg), separators=(",", ":")), encoding="utf-8")
    for f in ("text_model.json", "gate.json", "config.json"):
        shutil.copyfile(ASSETS / f, PUBLIC_ENGINE / f)
    m, u = main_run.metrics, unseen.metrics
    bench = {"generated_by": "bench/export_assets.py", "config_version": cfg.version, "gate": main_run.gate.name,
             "scope_note": "Measured offline with the Python reference on a seeded synthetic benchmark.",
             "synthetic": {"n_pairs": m["n_pairs"], "modes": m["modes"], "by_pair_type": m["by_pair_type"],
                           "blocking": m["blocking"], "safety": m["safety"], "threshold": m["threshold"],
                           "n_records": len(main_run.raws)},
             "unseen_noise": {"n_pairs": u["n_pairs"], "modes": u["modes"], "by_pair_type": u["by_pair_type"],
                              "blocking": u["blocking"], "safety": u["safety"], "n_records": len(unseen.raws)},
             "examples": pick_examples(main_run)}
    (PUBLIC_DATA / "benchmark.json").write_text(json.dumps(bench, indent=1), encoding="utf-8")
    print(json.dumps({"synthetic": {"pairs": m["n_pairs"], "sama": m["modes"]["sama"], "baseline": m["modes"]["baseline"],
                                    "model_only": m["modes"]["model_only"], "blocking": m["blocking"],
                                    "threshold": m["threshold"]},
                      "unseen": {"pairs": u["n_pairs"], "sama": u["modes"]["sama"], "baseline": u["modes"]["baseline"],
                                 "model_only": u["modes"]["model_only"], "blocking": u["blocking"]},
                      "text_model": main_run.text_model.meta, "gate": gate_to_json(main_run)["version"]},
                     indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
