"""Shared builders for tests: run raw description strings through the real pipeline stages."""
from sama.classify import classify
from sama.config import default_config
from sama.contracts import RawRecord
from sama.decide import assign_tier, build_pair, zone
from sama.extract import extract
from sama.normalize import apply_pass2, normalize_record

CFG = default_config()


def rec(text: str, rid: str = "A:1", **kw):
    raw = RawRecord(record_id=rid, cpse=rid.split(":")[0], matnr=rid.split(":")[1], maktx=text, **kw)
    n = normalize_record(raw, CFG)
    c = classify(n.norm_text, CFG)
    n = apply_pass2(n, c.class_code, CFG)
    return assign_tier(extract(raw, n, c, CFG), CFG)


def decide(left: str, right: str, gate: float = 0.99, thr_E: float = 0.5, left_kw=None, right_kw=None):
    a = rec(left, "A:1", **(left_kw or {}))
    b = rec(right, "B:2", **(right_kw or {}))
    p = build_pair(a, b, CFG)
    p.gate_score = gate
    z, step, _ = zone(p, thr_E, 0.10, CFG)
    return p, z, step
