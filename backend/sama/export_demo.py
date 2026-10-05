"""Phase 0 exporter (idea stage): wrote static JSON for the first prototype screens.

Kept only because the idea-stage proof notebook (notebooks/build_idea_proof.py) imports its showcase helpers.
The live web app does NOT read its output: the browser engine computes everything itself. Do not point --out at
frontend/public.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from pathlib import Path

from .certificate import build_certificate
from .nmc import validate
from .pipeline import RunResult, run

# The PRD §3.5 worked examples, located by their raw text in the generated data.
SHOWCASE = [
    ("cs-vs-wcb", "Carbon steel vs A216 WCB — vaguer, not different",
     "VALVE GATE 2IN 150# CS FLGD", "GATE VLV 50MM CL150 A216 WCB FLANGED END"),
    ("missing-end", "End connection stated on one side only",
     "VALVE GATE 2IN 150# CS FLGD", "Valve, Gate, NPS 2, Class 150, Carbon Steel, RF"),
    ("trap-twin", "Trap twin — Class 150 vs Class 300",
     "GATE VLV 50MM CL150 A216 WCB FLGD RF", "GATE VLV 50MM CL300 A216 WCB FLGD RF"),
    ("flange-auto", "Weld-neck flange — standard part, auto-merged with proof",
     'FLANGE WN 2" CL150 RF SCH40 A105', "WELD NECK FLG, NPS 2, 150#, RF, S40, ASTM A105"),
    ("std-vs-sch40", "STD vs SCH40 at 2 inch — same wall via the size table",
     "PIPE SMLS NPS 2 STD A106 GR B", 'PIPE SEAMLESS 2" SCH40 ASTM A106 B'),
    ("nace", "Same attributes, but one record says NACE",
     "BALL VLV 1IN CL300 SS316 NACE", 'BALL VALVE 1" 300# SS316'),
]


def _find(res: RunResult, text: str) -> str | None:
    hits = sorted(rid for rid, r in res.raws.items() if r.maktx.strip() == text)
    return hits[0] if hits else None


def _side(res: RunResult, rid: str) -> dict:
    raw, norm, rec = res.raws[rid], res.norms[rid], res.recs[rid]
    return {"record_id": rid, "cpse": raw.cpse, "matnr": raw.matnr, "raw": raw.maktx, "normalized": norm.norm_text,
            "residuals": rec.residuals.model_dump(), "mfr": raw.mfr, "mpn": raw.mpn}


def _scopes(main: RunResult, unseen: RunResult | None) -> dict[str, dict]:
    s = {"synthetic": main.metrics}
    if unseen:
        s["unseen_noise"] = unseen.metrics
    return s


def _precision_rows(scopes: dict[str, dict]) -> list[dict]:
    rows = []
    for scope in ("synthetic", "unseen_noise", "real_labelled"):
        m = scopes.get(scope)
        if not m:
            rows.append({"evidence_scope": scope, "n": None, "false_merges": None, "upper_bound_95": None,
                         "note": "not yet measured — Day-1 real-text study pending"})
            continue
        s = m["modes"]["sama"]
        rows.append({"evidence_scope": scope, "n": s["auto_correct"] + s["auto_wrong"], "false_merges": s["auto_wrong"],
                     "upper_bound_95": s["upper_bound_95"]})
    return rows


def export(main: RunResult, unseen: RunResult | None, out: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    (out / "review").mkdir(exist_ok=True)
    (out / "nmc").mkdir(exist_ok=True)
    scopes = _scopes(main, unseen)
    precision = _precision_rows(scopes)
    summary: dict = {"review": [], "nmc": []}

    # ---- review detail + certificates for the worked examples
    items = []
    for n, (rid_, title, lt, rt) in enumerate(SHOWCASE, start=1):
        a, b = _find(main, lt), _find(main, rt)
        if not a or not b:
            summary["review"].append({"id": rid_, "missing": True})
            continue
        p = main.score_pair(a, b)
        key = (a, b) if a < b else (b, a)
        cert = build_certificate(main, key, f"CERT-{n:06d}").model_dump()
        cert["measured_precision"] = precision
        left, right = (_side(main, a), _side(main, b))
        doc = {"pair": p.model_dump(), "left": left, "right": right,
               "ranker": {"version": f"v{main.ranker.version}", "reviewer_labels": main.ranker.n_reviewer},
               "approvals_required": 2 if p.tier == "R" else 1, "certificate": cert}
        (out / "review" / f"{rid_}.json").write_text(json.dumps(doc, indent=1, default=str), encoding="utf-8")
        items.append({"id": rid_, "title": title, "zone": p.zone, "zone_step": p.zone_step})
        summary["review"].append({"id": rid_, "zone": p.zone, "step": p.zone_step})
    (out / "review_index.json").write_text(json.dumps({"items": items}, indent=1), encoding="utf-8")

    # ---- comparison: same candidate pairs, three decision logics (test split)
    m = main.metrics
    test_keys = [k for k in main.pairs if main.pair_split(k) == "test" and main.is_match(k) is not None]
    wrong = [k for k in test_keys if main.zones["baseline"][k] == "AUTO_MERGE" and not main.is_match(k)]
    # Judges must SEE why the merge is wrong: visible critical conflicts first (one per attribute),
    # then a risk word; pairs whose texts normalize identically are skipped.
    def visible_conflict(k):
        return next((r.property for r in main.pairs[k].comparison if r.critical and r.state == "conflict"), None)
    wrong = [k for k in wrong if main.norms[k[0]].norm_text != main.norms[k[1]].norm_text]
    wrong.sort(key=lambda k: (visible_conflict(k) is None, main.pair_types.get(k) != "riskword",
                              -main.pairs[k].baseline_score, k))
    examples, seen_props = [], set()
    for k in wrong:
        p = main.pairs[k]
        why = next((r.property for r in p.comparison if r.critical and r.state == "conflict"),
                   main.pair_types.get(k, "random"))
        if why in seen_props:
            continue
        seen_props.add(why)
        examples.append({"left_raw": main.raws[k[0]].maktx, "right_raw": main.raws[k[1]].maktx,
                         "left_cpse": main.raws[k[0]].cpse, "right_cpse": main.raws[k[1]].cpse,
                         "pair_type": main.pair_types.get(k, "random"),
                         "baseline_score": p.baseline_score, "baseline_zone": "AUTO_MERGE",
                         "sama_zone": p.zone, "sama_step": p.zone_step, "sama_reason": p.zone_reason,
                         "comparison": [r.model_dump() for r in p.comparison]})
        if len(examples) == 4:
            break
    cmp = {"scope": "synthetic", "split": "test", "n_pairs": m["n_pairs"], "t_base": m["threshold"]["t_base"],
           "t_base_f1": m["threshold"]["t_base_f1"], "thr_E": m["threshold"]["thr_E"],
           "thr_is_demo": m["threshold"]["is_demo"],
           "modes": {mode: {k: v for k, v in d.items()} for mode, d in m["modes"].items()},
           "by_pair_type": m["by_pair_type"], "examples": examples,
           "unseen_noise": ({"n_pairs": unseen.metrics["n_pairs"], "modes": unseen.metrics["modes"]} if unseen else None)}
    (out / "comparison.json").write_text(json.dumps(cmp, indent=1), encoding="utf-8")
    summary["comparison"] = {mode: (d["auto_wrong"], d["auto_correct"]) for mode, d in m["modes"].items()}

    # ---- NMC cards + Savings lens
    nmc_items = []
    flange_rec = _find(main, 'FLANGE WN 2" CL150 RF SCH40 A105')
    clusters = [(c, v) for c, v in main.nmcs.items() if v["kind"] == "cluster"
                and len({main.raws[r].cpse for r in v["members"]}) >= 2]
    clusters.sort(key=lambda cv: (flange_rec not in cv[1]["members"], -len(cv[1]["members"]), cv[0]))
    for code, v in clusters[:6]:
        recs = [main.raws[r] for r in v["members"]]
        uoms = Counter(main.norms[r].uom_norm for r in v["members"] if main.norms[r].uom_norm)
        base = uoms.most_common(1)[0][0] if uoms else ""
        rows = []
        for r in recs:
            u = main.norms[r.record_id].uom_norm
            ok = r.last_po_price is not None and u == base
            rows.append({"cpse": r.cpse, "legacy_matnr": r.matnr, "price": r.last_po_price, "qty": r.annual_qty, "uom": u,
                         "included": ok, **({} if ok else {"reason": "no price" if r.last_po_price is None
                                                            else f"UoM {u} ≠ base {base}"})})
        inc = [x for x in rows if x["included"]]
        savings = None
        if len(inc) >= 2:
            pmin, pmax = min(x["price"] for x in inc), max(x["price"] for x in inc)
            savings = {"synthetic": True, "base_uom": base, "rows": rows, "min": pmin, "max": pmax,
                       "spread": round(pmax - pmin, 2), "pooled_qty": sum((x["qty"] or 0) for x in inc),
                       "opportunity": round(sum((x["price"] - pmin) * (x["qty"] or 0) for x in inc), 2),
                       "assumptions": ["Prices compared only when the base unit of measure matches.",
                                       "Opportunity = Σ (price − lowest price) × annual quantity.",
                                       "Synthetic prices; an illustrative opportunity, not realised savings."]}
        cls, serial, check = code[4:8], code[9:16], code[-1]
        doc = {"full_code": code, "class_code": cls, "serial": serial, "check_char": check, "valid": validate(code),
               "national_name": main.config.classes[cls].national_name, "short_text": v["short_text"],
               "long_text": v["long_text"], "golden": v["golden"]["attributes"],
               "crosswalk": [{"cpse": r.cpse, "legacy_matnr": r.matnr, "raw": r.maktx, "relation_type": "IDENTICAL",
                              "status": "approved", "certificate_id": None} for r in recs],
               "savings": savings}
        (out / "nmc" / f"{code.replace(':', '_')}.json").write_text(json.dumps(doc, indent=1), encoding="utf-8")
        nmc_items.append({"code": code, "title": v["short_text"]})
    (out / "nmc_index.json").write_text(json.dumps({"items": nmc_items}, indent=1), encoding="utf-8")
    summary["nmc"] = nmc_items

    # ---- run summary for slides and the dashboard
    run_doc = {"run_id": main.run_id, "config_version": main.config.version, "timings": main.timings,
               "metrics": {"synthetic": main.metrics, **({"unseen_noise": unseen.metrics} if unseen else {})},
               "nmcs_minted": len(main.nmcs), "clusters": sum(v["kind"] == "cluster" for v in main.nmcs.values()),
               "pending_review_records": len(main.pending), "config_status": main.config.status}
    (out / "run_summary.json").write_text(json.dumps(run_doc, indent=1, default=str), encoding="utf-8")
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--unseen", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--demo-threshold", type=float, default=None)
    a = ap.parse_args()
    main_run = run(a.data, evidence_scope="synthetic", demo_threshold=a.demo_threshold)
    unseen = None
    if a.unseen:
        unseen = run(a.unseen, evidence_scope="unseen_noise", run_id="RUN-0002", gate=main_run.gate,
                     thr_E=main_run.thr_E if math.isfinite(main_run.thr_E) else math.inf, t_base=main_run.t_base)
    print(json.dumps(export(main_run, unseen, Path(a.out)), indent=1, default=str))


if __name__ == "__main__":
    main()
