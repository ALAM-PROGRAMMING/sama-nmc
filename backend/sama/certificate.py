"""Evidence Certificates, schema 4.0 (FR-CERT-01, Architecture §7.12).

A certificate states its own evidence scope and limitations: precision figures are
measurements on named evaluation sets, never production guarantees.
"""
from __future__ import annotations

import math

from .contracts import Certificate
from .pipeline import RunResult

GENERIC = "9999"


def _record_view(res: RunResult, rid: str) -> dict:
    raw, norm, rec = res.raws[rid], res.norms[rid], res.recs[rid]
    return {
        "record_id": rid, "cpse": raw.cpse, "matnr": raw.matnr, "raw": raw.maktx, "normalized": norm.norm_text,
        "transforms": [t.model_dump() for t in norm.transforms],
        "class_code": rec.class_code, "tier": rec.tier,
        "attributes": {k: v.model_dump(exclude_none=True) for k, v in rec.attributes.items()},
        "residuals": rec.residuals.model_dump(), "sanity_flags": [f.model_dump() for f in rec.sanity_flags],
        "mfr": raw.mfr, "mpn": raw.mpn,
    }


def measured_precision(scopes: dict[str, dict]) -> list[dict]:
    """`scopes`: evidence_scope -> metrics dict from pipeline.evaluate()."""
    out = []
    for scope, m in scopes.items():
        s = m["modes"]["sama"]
        n = s["auto_correct"] + s["auto_wrong"]
        out.append({"evidence_scope": scope, "n": n, "false_merges": s["auto_wrong"],
                    "upper_bound_95": s["upper_bound_95"]})
    return out


def build_certificate(res: RunResult, key: tuple[str, str], cert_id: str, scopes: dict[str, dict] | None = None,
                      approvals: list[dict] | None = None, audit: dict | None = None) -> Certificate:
    p = res.pairs[key] if key in res.pairs else res.get_pair(*key)
    cfg = res.config
    used = sorted(set(res.recs[key[0]].tables_used) | set(res.recs[key[1]].tables_used) | {"tiers"})
    if any(r.via == "size_table" for r in p.comparison):
        used = sorted(set(used) | {"schedules"})
    status = {t: cfg.status.get(t, "draft") for t in used}
    nmc = res.nmc_of.get(key[0]) if res.nmc_of.get(key[0]) == res.nmc_of.get(key[1]) else None
    decision_status = "approved" if p.zone == "AUTO_MERGE" else ("rejected" if p.zone == "REJECT" else "pending_review")
    limitations = ["Precision figures are benchmark measurements, not production guarantees."]
    unverified = [t for t, s in status.items() if s != "reviewed"]
    if unverified:
        limitations.append(f"Decision used unverified tables ({', '.join(unverified)}); "
                           f"auto_merge_requires_reviewed_config="
                           f"{str(bool(cfg['tiers'].get('auto_merge_requires_reviewed_config'))).lower()} in this run.")
    if res.thr_is_demo:
        limitations.append("Tier E threshold is a labelled DEMO value: the calibration split held fewer auto-eligible "
                           f"pairs than the {res.thr.min_n} required for the 0.5% budget.")
    if not math.isfinite(res.thr_E):
        limitations.append("Insufficient calibration evidence: Tier E pairs do not auto-merge by score in this run.")
    if p.class_code == GENERIC:
        limitations.append("GENERIC (out-of-template) items are never auto-merged; semantic, review-assisted only.")
    return Certificate(
        certificate_id=cert_id, kind="pair", run_id=res.run_id, mode="sama", config_version=cfg.version,
        config_status=status,
        subject={"nmc": nmc, "records": [_record_view(res, key[0]), _record_view(res, key[1])]},
        comparison=p.comparison, residual_diff=p.residual_diff, rules=p.rules,
        scores={"gate": {"model": res.gate.name, "frozen": True, "value": p.gate_score,
                         "top_features": res.gate.top_features()},
                "rank": {"model": res.ranker.name, "reviewer_labels": res.ranker.n_reviewer, "value": p.rank_score,
                         "used_for": "queue order only"},
                "baseline": {"value": p.baseline_score, "t_base": round(res.t_base, 4),
                             "used_for": "comparison only; never writes"}},
        tier={"value": p.tier, "reasons": sorted(set(res.recs[key[0]].tier_reasons + res.recs[key[1]].tier_reasons))},
        threshold={"applies_to": "gate_score", "value": res.thr_E if math.isfinite(res.thr_E) else None,
                   "is_demo_value": res.thr_is_demo, "min_n": res.thr.min_n, "evidence_scope": res.evidence_scope},
        measured_precision=measured_precision(scopes or {res.evidence_scope: res.metrics}),
        decision={"zone": p.zone, "zone_step": p.zone_step, "reason": p.zone_reason, "status": decision_status,
                  "approvals": approvals or ([{"user": "system", "role": "auto"}] if p.zone == "AUTO_MERGE" else [])},
        audit=audit or {}, limitations=limitations)
