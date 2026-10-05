"""Tier, six-state compare, rules R-01…R-09 and the nine-step zone (Architecture §7.4–7.7).

This module carries the safety. Nothing here reads embeddings, model scores or LLM output,
except `zone`, which reads the frozen gate score at steps 5 and 8 only (Locked Decision 10).
"""
from __future__ import annotations

from .config import Config
from .contracts import (Attribute, CandidatePair, CompareRow, RecordAttributes, ResidualDiff, ResidualSide,
                        RuleOutcome)
from .extract import is_ancestor

GENERIC = "9999"
HIGH_CLASSES = ("CL600", "CL900", "CL1500", "CL2500")


# ---------------------------------------------------------------- tier (§7.4)
def assign_tier(rec: RecordAttributes, cfg: Config) -> RecordAttributes:
    tmpl = cfg.classes.get(rec.class_code)
    tier = tmpl.tier_default if tmpl else "R"
    reasons = [f"class {rec.class_code} default {tier}"]
    pc = rec.attributes.get("pressure_class")
    if pc and pc.value in HIGH_CLASSES:
        tier, reasons = "R", reasons + [f"T-01 pressure class {pc.value}"]
    if rec.residuals.risk:
        tier, reasons = "R", reasons + [f"T-02 risk word {', '.join(rec.residuals.risk)}"]
    if rec.class_code == GENERIC:
        tier, reasons = "R", reasons + ["T-03 GENERIC class"]
    return rec.model_copy(update={"tier": tier, "tier_reasons": reasons})


def pair_tier(a: RecordAttributes, b: RecordAttributes) -> str:
    return "R" if "R" in (a.tier, b.tier) else "E"           # FR-CLS-04


# ---------------------------------------------------------------- compare (§7.6)
def _usable(a: Attribute | None) -> Attribute | None:
    return a if a is not None and a.value is not None else None


def compare_prop(prop: dict, a: Attribute | None, b: Attribute | None, cfg: Config) -> CompareRow:
    name, critical = prop["name"], bool(prop.get("critical"))
    a, b = _usable(a), _usable(b)
    shown_l = a.value if a else None
    shown_r = b.value if b else None
    via = None
    if prop.get("resolver"):
        if a and b and a.designation == b.designation:
            return CompareRow(property=name, critical=critical, left=shown_l, right=shown_r, state="agree")
        va = a.resolved if a else None
        vb = b.resolved if b else None
        via = "size_table"
    else:
        va = a.value if a else None
        vb = b.value if b else None
    row = dict(property=name, critical=critical, left=shown_l, right=shown_r)
    if va is None and vb is None:
        return CompareRow(**row, state="both_missing")
    if va is None:
        return CompareRow(**row, state="left_missing")
    if vb is None:
        return CompareRow(**row, state="right_missing")
    h = prop.get("hierarchy")
    if va == vb:
        if h and cfg["hierarchies"].get(h, {}).get(va):
            # Both records state only a family (e.g. STAINLESS STEEL): agreement on the family is not
            # evidence of identity (SS304 vs SS316 both read as STAINLESS STEEL). Spec clarification
            # SC-01: treated as less specific, so R-02 sends it to review and step 5 never rejects it.
            return CompareRow(**row, state="less_specific", via="both_family", ancestor_chain=[va])
        return CompareRow(**row, state="agree", via=via)
    if h and is_ancestor(cfg, h, va, vb):
        return CompareRow(**row, state="less_specific", ancestor_chain=[va, vb])
    if h and is_ancestor(cfg, h, vb, va):
        return CompareRow(**row, state="less_specific", ancestor_chain=[vb, va])
    return CompareRow(**row, state="conflict", via=via)     # both recognised, unrelated


def residual_diff(a: RecordAttributes, b: RecordAttributes) -> ResidualDiff:
    def side(x: list[str], y: list[str]) -> ResidualSide:
        return ResidualSide(left_only=sorted(set(x) - set(y)), right_only=sorted(set(y) - set(x)))
    return ResidualDiff(unknown=side(a.residuals.unknown, b.residuals.unknown),
                        reference=side(a.residuals.reference, b.residuals.reference))


def compare_records(a: RecordAttributes, b: RecordAttributes, cfg: Config) -> list[CompareRow]:
    tmpl = cfg.classes.get(a.class_code)
    if not tmpl or a.class_code != b.class_code:
        return []
    return [compare_prop(p, a.attributes.get(p["name"]), b.attributes.get(p["name"]), cfg) for p in tmpl.properties]


# ---------------------------------------------------------------- rules (§7.7)
def evaluate_rules(a: RecordAttributes, b: RecordAttributes, rows: list[CompareRow], diff: ResidualDiff,
                   cfg: Config) -> list[RuleOutcome]:
    crit = [r for r in rows if r.critical]
    conflicts = [r.property for r in crit if r.state == "conflict"]
    less = [r.property for r in crit if r.state == "less_specific"]
    missing = [r.property for r in crit if r.state.endswith("missing")]
    res_l = diff.unknown.left_only + diff.reference.left_only
    res_r = diff.unknown.right_only + diff.reference.right_only
    risk = sorted(set(a.residuals.risk) | set(b.residuals.risk))
    sanity = [f"{f.type}:{f.prop}" for f in a.sanity_flags + b.sanity_flags]
    same_mpn = bool(a.mfr_norm and b.mfr_norm and a.mpn_norm and b.mpn_norm
                    and a.mfr_norm == b.mfr_norm and a.mpn_norm == b.mpn_norm)
    diff_mpn = bool(a.mfr_norm and a.mfr_norm == b.mfr_norm and a.mpn_norm and b.mpn_norm
                    and a.mpn_norm != b.mpn_norm)
    via_table = [r.property for r in crit if r.state == "agree" and r.via == "size_table"]
    r09 = bool(via_table) and not cfg.is_reviewed("schedules")

    def out(rid: str, fired: bool, detail: str) -> RuleOutcome:
        return RuleOutcome(id=rid, fired=fired, detail=detail if fired else "")
    return [
        out("R-01", bool(conflicts), f"critical conflict: {', '.join(conflicts)}"),
        out("R-02", bool(less), f"less specific: {', '.join(less)}"),
        out("R-03", bool(missing), f"critical missing: {', '.join(missing)}"),
        out("R-04", bool(res_l or res_r), f"unexplained tokens: {' '.join(res_l) or '—'} | {' '.join(res_r) or '—'}"),
        out("R-05", bool(risk), f"risk word: {', '.join(risk)}"),
        out("R-06", bool(sanity), f"sanity flag: {', '.join(sanity)}"),
        out("R-07", same_mpn, f"same manufacturer + part number {a.mpn_norm}"),
        out("R-08", diff_mpn, f"same manufacturer, different part numbers {a.mpn_norm} / {b.mpn_norm}"),
        out("R-09", r09, f"agreement via unreviewed size table: {', '.join(via_table)}"),
    ]


# ---------------------------------------------------------------- zone (§7.7)
STEP_WORDS = {
    1: "same part number but conflicting attributes → review (data-quality issue)",
    2: "critical conflict → reject",
    3: "risk word or sanity flag → review",
    4: "qualifying manufacturer part-number match",
    5: "low evidence → reject (logged, sampleable)",
    6: "engineered item (Tier R) → engineer review",
    7: "review cap",
    8: "every critical attribute agrees and gate score clears the measured threshold → auto-merge",
    9: "below auto threshold → review",
}


def zone(p: CandidatePair, thr_E: float, reject_thr: float, cfg: Config) -> tuple[str, int, str]:
    f = p.fired
    detail = {r.id: r.detail or r.id for r in p.rules if r.fired}
    if f("R-01") and f("R-07"):
        return "REVIEW", 1, STEP_WORDS[1]
    if f("R-01"):
        return "REJECT", 2, detail["R-01"]
    if f("R-05") or f("R-06"):
        return "REVIEW", 3, "; ".join(detail[r] for r in ("R-05", "R-06") if r in detail)
    if f("R-07"):
        if p.class_code == GENERIC:
            return "REVIEW", 4, "part-number match in GENERIC class → review (no template to check conflicts)"
        return _downgrade_if_unreviewed(p, "AUTO_MERGE", 4, STEP_WORDS[4], cfg)
    crit = [r for r in p.comparison if r.critical]
    if p.gate_score is not None and p.gate_score < reject_thr and not any(
            r.state in ("agree", "less_specific") for r in crit):
        return "REJECT", 5, STEP_WORDS[5]
    if p.tier == "R" or p.class_code == GENERIC:              # GENERIC is always Tier R; guarded here too (I-08)
        return "REVIEW", 6, STEP_WORDS[6]
    for rid in ("R-02", "R-03", "R-04", "R-08", "R-09"):
        if f(rid):
            return "REVIEW", 7, detail[rid]
    if p.gate_score is not None and p.gate_score >= thr_E:
        return _downgrade_if_unreviewed(p, "AUTO_MERGE", 8, STEP_WORDS[8], cfg)
    return "REVIEW", 9, STEP_WORDS[9]


def _downgrade_if_unreviewed(p: CandidatePair, z: str, step: int, why: str, cfg: Config) -> tuple[str, int, str]:
    if cfg["tiers"].get("auto_merge_requires_reviewed_config"):
        if any(s != "reviewed" for k, s in cfg.status.items() if not k.startswith("class:")):
            return "REVIEW", step, why + " — downgraded: decision uses unreviewed tables (NFR-12)"
    return z, step, why


def zone_baseline(p: CandidatePair, t_base: float) -> str:
    return "AUTO_MERGE" if (p.baseline_score or 0.0) >= t_base else "REVIEW"


def zone_model_only(p: CandidatePair, thr_E: float, reject_thr: float) -> str:
    if (p.gate_score or 0.0) >= thr_E:
        return "AUTO_MERGE"
    if (p.gate_score or 0.0) < reject_thr:
        return "REJECT"
    return "REVIEW"


def qualifying_mpn(p: CandidatePair) -> bool:
    return p.fired("R-07") and p.class_code != GENERIC and not (p.fired("R-01") or p.fired("R-05") or p.fired("R-06"))


def build_pair(a: RecordAttributes, b: RecordAttributes, cfg: Config, blockers: list[str] | None = None) -> CandidatePair:
    rows = compare_records(a, b, cfg)
    diff = residual_diff(a, b)
    return CandidatePair(left_id=a.record_id, right_id=b.record_id, class_code=a.class_code, tier=pair_tier(a, b),
                         blockers=blockers or [], comparison=rows, residual_diff=diff,
                         rules=evaluate_rules(a, b, rows, diff, cfg))
