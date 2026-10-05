"""Evaluator golden scenarios A-F against the Python reference (the browser engine runs the same file)."""
import json
from pathlib import Path

import pytest

from sama.certificate import build_certificate  # noqa: F401  (certificate builder must stay importable)
from sama.contracts import RawRecord
from sama.evaluator import evaluate, evaluate_pair, load_assets
from sama.nmc import validate
from sama.runview import build_run_output

GOLDEN = Path(__file__).resolve().parents[3] / "frontend" / "src" / "engine" / "golden"
SC = json.loads((GOLDEN / "scenarios.json").read_text(encoding="utf-8"))
ASSETS = load_assets()


def raw(d: dict, rid: str) -> RawRecord:
    return RawRecord(record_id=f"{d['cpse']}:{d['matnr']}", cpse=d["cpse"], matnr=d["matnr"], maktx=d["maktx"],
                     mfr=d.get("mfr", ""), mpn=d.get("mpn", ""))


@pytest.mark.parametrize("case", SC["pairs"], ids=lambda c: c["case"])
def test_pair_scenarios(case):
    p = evaluate_pair(raw(case["left"], "l"), raw(case["right"], "r"), ASSETS)
    e = case["expect"]
    assert (p.zone, p.zone_step) == (e["zone"], e["zone_step"]), p.zone_reason
    assert sorted(r.id for r in p.rules if r.fired) == e["rules_fired"]
    states = {r.property: r.state for r in p.comparison}
    for prop, st in e.get("states", {}).items():
        assert states[prop] == st, (prop, states)
    if "class_code" in e:
        assert p.class_code == e["class_code"]


def test_case_f_verified_match_nmc_crosswalk_certificate():
    s = SC["run"]
    raws = [raw(r, "") for r in s["records"]]
    res = evaluate(raws, ASSETS)
    out = build_run_output(res, "RUN-T", "sample", "2026-10-03T00:00:00Z", "2026-10-03T00:00:01Z")
    e = s["expect"]
    assert out["summary"]["groups"] == e["groups"] and out["summary"]["nmcs"] == e["nmcs"]
    assert (out["summary"]["auto"], out["summary"]["review"], out["summary"]["reject"]) == (e["auto"], e["review"], e["reject"])
    nmc = out["nmcs"][0]
    assert nmc["class_code"] == e["class_code"] and nmc["members"] == e["members"] and validate(nmc["code"])
    assert [r["status"] for r in out["records"]] == e["statuses"]
    assert all(r["nmc"] == nmc["code"] for r in out["records"])             # crosswalk: every legacy code -> the NMC
    key = tuple(sorted((raws[0].record_id, raws[1].record_id)))
    cert = build_certificate(_as_run_result(res), key, "CERT-F")             # certificate for a verified pair
    assert cert.decision["zone"] == "AUTO_MERGE" and cert.subject["nmc"] == nmc["code"]


class _as_run_result:
    """Adapter so the benchmark certificate builder can be reused on an evaluator run."""
    def __init__(self, res):
        from types import SimpleNamespace
        g = res.assets.gate
        self.__dict__.update(
            run_id=res.run_id, config=res.config, raws=res.raws, norms=res.norms, recs=res.recs, pairs=res.pairs,
            nmc_of=res.nmc_of, thr_E=g.thr_E, thr_is_demo=False, t_base=g.t_base,
            thr=SimpleNamespace(min_n=598), evidence_scope="sample", metrics={"modes": {"sama": {
                "auto_correct": 0, "auto_wrong": 0, "upper_bound_95": None}}},
            gate=SimpleNamespace(name=g.version, top_features=lambda: []),
            ranker=SimpleNamespace(name="none", n_reviewer=0), get_pair=res.get_pair,
            score_pair=lambda a, b: res.pairs[(a, b) if a < b else (b, a)])
