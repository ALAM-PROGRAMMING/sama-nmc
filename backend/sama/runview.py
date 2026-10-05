"""Build the RunOutput JSON (contract: frontend/src/engine/types.ts) from an evaluator run.

This is the Python REFERENCE producer. The browser engine must produce the same structure and
values; tests/parity compares them (volatile fields: run id, timestamps, audit ts/hashes).

Presentation rules (they never change a decision):
  kept decisions : every AUTO_MERGE, every REVIEW, and every REJECT that is a "look-alike":
                   exactly one critical property conflicts and every other critical property is
                   same or too vague, OR an ordinary text-similarity matcher would have merged it.
  filtered       : all other candidate pairs (clearly different items), reported as one count.
"""
from __future__ import annotations

from collections import Counter

from .audit import AuditChain
from .contracts import CandidatePair
from .evaluator import EvalResult

STAGE_LABELS = ["Understanding records", "Finding candidates", "Comparing attributes", "Applying safety rules",
                "Preparing decisions", "Building identity and evidence"]


def is_near_miss(p: CandidatePair) -> bool:
    crit = [r for r in p.comparison if r.critical]
    conflicts = [r for r in crit if r.state == "conflict"]
    return len(conflicts) == 1 and all(r.state in ("agree", "less_specific") for r in crit if r.state != "conflict")


def decision_kind(p: CandidatePair, t_base: float) -> str | None:
    if p.zone == "AUTO_MERGE":
        return "verified"
    if p.zone == "REVIEW":
        return "review"
    if p.zone == "REJECT" and (is_near_miss(p) or (p.baseline_score or 0.0) >= t_base):
        return "lookalike"
    return None


def decision_id(p: CandidatePair) -> str:
    a, b = sorted((p.left_id, p.right_id))
    return f"{a}~{b}"


def build_run_output(res: EvalResult, run_id: str, scope: str, started_at: str, finished_at: str,
                     truth: dict[str, str] | None = None) -> dict:
    cfg, gate = res.config, res.assets.gate
    t_base = gate.t_base
    cluster_of = {m: code for code, v in res.nmcs.items() if v["kind"] == "cluster" for m in v["members"]}
    has_open_review = set(res.pending)

    records = []
    for rid, raw in res.raws.items():
        norm, rec = res.norms[rid], res.recs[rid]
        in_cluster = rid in cluster_of
        status = "VERIFIED" if in_cluster else ("REVIEW" if rid in has_open_review else "UNIQUE")
        tmpl = cfg.classes.get(rec.class_code)
        records.append({
            "id": rid, "cpse": raw.cpse, "matnr": raw.matnr, "raw": raw.maktx, "normalized": norm.norm_text,
            "transforms": [t.model_dump() for t in norm.transforms], "class_code": rec.class_code,
            "class_name": tmpl.national_name if tmpl and rec.class_code != "9999" else "GENERIC",
            "generic": rec.class_code == "9999", "tier": rec.tier, "tier_reasons": list(rec.tier_reasons),
            "attributes": {k: v.model_dump() for k, v in rec.attributes.items()},
            "residuals": rec.residuals.model_dump(), "sanity_flags": [f.model_dump() for f in rec.sanity_flags],
            "mfr": raw.mfr, "mpn": raw.mpn, "mfr_norm": rec.mfr_norm, "mpn_norm": rec.mpn_norm, "uom": norm.uom_norm,
            "price": raw.last_po_price, "qty": raw.annual_qty, "status": status, "nmc": res.nmc_of.get(rid)})

    decisions, fuzzy_auto, both_auto, stopped, kept_counts = [], 0, 0, [], Counter()
    for key in sorted(res.pairs):
        p = res.pairs[key]
        fz_auto = res.zones_baseline[key] == "AUTO_MERGE"
        fuzzy_auto += fz_auto
        both_auto += fz_auto and p.zone == "AUTO_MERGE"
        kind = decision_kind(p, t_base)
        if kind is None:
            continue
        kept_counts[kind] += 1
        d = {"id": decision_id(p), "left": key[0], "right": key[1], "class_code": p.class_code, "tier": p.tier,
             "zone": p.zone, "zone_step": p.zone_step, "reason": p.zone_reason, "kind": kind,
             "comparison": [r.model_dump() for r in p.comparison], "residual_diff": p.residual_diff.model_dump(),
             "rules": [r.model_dump() for r in p.rules], "features": dict(p.features), "gate_score": p.gate_score,
             "baseline_score": p.baseline_score, "baseline_zone": res.zones_baseline[key],
             "blockers": sorted(p.blockers)}
        decisions.append(d)
        if fz_auto and p.zone != "AUTO_MERGE":
            stopped.append(d["id"])

    nmcs = []
    for code, v in res.nmcs.items():
        nmcs.append({"code": code, "class_code": code[4:8], "serial": code[9:16], "check_char": code[-1],
                     "kind": v["kind"], "members": list(v["members"]), "golden": v["golden"],
                     "short_text": v["short_text"], "long_text": v["long_text"]})

    status_counts = Counter(r["status"] for r in records)
    summary = {"records": len(records), "candidate_pairs": len(res.pairs), "auto": kept_counts["verified"],
               "review": kept_counts["review"], "reject": kept_counts["lookalike"],
               "filtered": len(res.pairs) - sum(kept_counts.values()),
               "groups": sum(1 for v in res.nmcs.values() if v["kind"] == "cluster"),
               "unique": sum(1 for v in res.nmcs.values() if v["kind"] == "singleton"),
               "pending": status_counts["REVIEW"], "generic_records": sum(r["generic"] for r in records),
               "nmcs": len(res.nmcs), "by_class": dict(sorted(Counter(r["class_code"] for r in records).items()))}

    answer_key = None
    if truth:
        n = fw = sw = 0
        for key, p in res.pairs.items():
            if key[0] in truth and key[1] in truth:
                n += 1
                same = truth[key[0]] == truth[key[1]]
                fw += (res.zones_baseline[key] == "AUTO_MERGE") and not same
                sw += (p.zone == "AUTO_MERGE") and not same
        answer_key = {"pairs_with_truth": n, "fuzzy_wrong": fw, "sama_wrong": sw}

    chain = AuditChain()
    chain.append(started_at, "engine", "RUN_STARTED", "run", run_id, {"records": len(records), "scope": scope})
    counts = [len(records), len(res.pairs), len(res.pairs), len(res.pairs),
              kept_counts["verified"] + kept_counts["review"] + kept_counts["lookalike"], len(res.nmcs)]
    for i, (label, c) in enumerate(zip(STAGE_LABELS, counts)):
        chain.append(started_at, "engine", "STAGE_COMPLETED", "run", run_id, {"stage": i, "label": label, "count": c})
    for d in decisions:
        fired = ",".join(r["id"] for r in d["rules"] if r["fired"])
        chain.append(finished_at, "engine", "DECISION_RECORDED", "decision", d["id"],
                     {"zone": d["zone"], "step": d["zone_step"], "kind": d["kind"], "rules_fired": fired})
    for n_ in nmcs:
        chain.append(finished_at, "engine", "NMC_MINTED", "nmc", n_["code"],
                     {"kind": n_["kind"], "members": len(n_["members"])})
    chain.append(finished_at, "engine", "RUN_FINISHED", "run", run_id,
                 {"auto": summary["auto"], "review": summary["review"], "reject": summary["reject"],
                  "filtered": summary["filtered"], "nmcs": summary["nmcs"]})

    tm = res.assets.text_model.meta
    return {"schema": "sama-run/1", "run_id": run_id, "scope": scope, "started_at": started_at,
            "finished_at": finished_at, "config_version": cfg.version, "config_status": dict(cfg.status),
            "gate_model": gate.version, "text_model": f"text_model_v{tm.get('version', 1)}",
            "thresholds": {"thr_E": gate.thr_E if gate.thr_E != float("inf") else None, "reject_thr": gate.reject_thr,
                           "t_base": t_base},
            "summary": summary, "records": records, "decisions": decisions, "nmcs": nmcs,
            "fuzzy": {"t_base": t_base, "fuzzy_auto": fuzzy_auto, "both_auto": both_auto,
                      "stopped_by_sama": fuzzy_auto - both_auto, "stopped_ids": sorted(stopped),
                      "answer_key": answer_key},
            "audit": chain.events, "warnings": []}
