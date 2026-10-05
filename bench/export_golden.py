"""Export parity fixtures: what the Python reference produces, which the browser engine must reproduce.

Writes frontend/src/engine/golden/*.json (test-only, never shipped to visitors):
  records.json    raw record -> normalized text, class, tier, attributes (with spans), residuals, flags
  pairs.json      raw record pair -> comparison rows, rules, features, scores, zone, step, reason
  sample_run.json the full RunOutput for the sample dataset (fixed timestamps)
  subset_run.json the full RunOutput for a 250-record slice of the unseen-noise set
  textmodel.json  frozen text model vectors/cosines and token_set_ratio values
  audit.json      a small hash chain with fixed timestamps
Also writes frontend/public/sample/{sample_truth,sample_meta}.json.

    python -m bench.export_golden
"""
from __future__ import annotations

import csv
import json
import random
from pathlib import Path

from sama.audit import AuditChain
from sama.contracts import RawRecord
from sama.evaluator import Assets, evaluate, evaluate_pair, load_assets, records_from_csv
from sama.extract import parse_characteristics
from sama.fuzzy import token_set_ratio
from sama.pipeline import standardise
from sama.runview import build_run_output
from sama.textmodel import bucket_of, char_wb_ngrams

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "src" / "engine" / "golden"
SAMPLE = ROOT / "frontend" / "public" / "sample"
TS0, TS1 = "2026-10-03T00:00:00Z", "2026-10-03T00:00:01Z"

# Demo-only answer key for the sample (designed together with the data; clearly synthetic).
TRUTH_GROUPS = {
    "T01": ["DEMO_A:10004101", "DEMO_B:M-20417", "DEMO_C:4500-310"], "T02": ["DEMO_A:10004102", "DEMO_B:M-20418"],
    "T03": ["DEMO_A:10004103", "DEMO_B:M-20419", "DEMO_C:4500-312"],
    "T04": ["DEMO_A:10004104", "DEMO_B:M-20420", "DEMO_C:4500-313"], "T05": ["DEMO_A:10004105", "DEMO_B:M-20421"],
    "T06": ["DEMO_C:4500-314"], "T07": ["DEMO_A:10004106", "DEMO_B:M-20422", "DEMO_C:4500-315"],
    "T08": ["DEMO_A:10004206"], "T09": ["DEMO_B:M-20522"],
    "T10": ["DEMO_A:10004207", "DEMO_B:M-20523", "DEMO_C:4500-316"],
    "T11": ["DEMO_A:10004107", "DEMO_B:M-20427", "DEMO_C:4500-317"], "T12": ["DEMO_A:10004108", "DEMO_C:4500-318"],
    "T13": ["DEMO_A:10004109"], "T14": ["DEMO_B:M-20429"], "T15": ["DEMO_B:M-20430", "DEMO_C:4500-320"],
    "T16": ["DEMO_A:10004110"], "T17": ["DEMO_A:10004111", "DEMO_C:4500-321"],
    "T18": ["DEMO_A:10004112", "DEMO_A:10004612"], "T19": ["DEMO_A:10004113"], "T20": ["DEMO_C:4500-323"],
    "T21": ["DEMO_A:10004114", "DEMO_B:M-20434"], "T22": ["DEMO_A:10004115", "DEMO_B:M-20435"],
    "T23": ["DEMO_C:4500-325", "DEMO_A:10004116"], "T24": ["DEMO_A:10004117"], "T25": ["DEMO_C:4500-326"],
    "T26": ["DEMO_C:4500-319"]}

FEATURED = [
    ("lookalike", "Look-alike: Class 150 vs Class 300",
     "Two gate valves that read almost the same. Only the pressure class differs.", "DEMO_B:M-20427", "DEMO_A:10004108"),
    ("vague", "Too vague: carbon steel vs A216 WCB", "One record names the exact grade, the other only the family.",
     "DEMO_A:10004107", "DEMO_B:M-20427"),
    ("verified", "Same flange, three wordings", "Three companies, three descriptions, one verified identity.",
     "DEMO_A:10004101", "DEMO_B:M-20417"),
    ("missing", "Missing information", "One record does not say how the valve connects.",
     "DEMO_A:10004111", "DEMO_C:4500-321"),
    ("risk", "A warning word: NACE", "Everything else matches, but one record flags sour-service use.",
     "DEMO_A:10004109", "DEMO_B:M-20429"),
    ("table", "STD vs SCH40 at 2 inch",
     "Different labels, same pipe wall. The thickness table is still unverified, so an engineer confirms.",
     "DEMO_A:10004106", "DEMO_B:M-20422"),
    ("mpn", "Same maker part number",
     "Identical manufacturer and part number is proof enough, even with sparse text.", "DEMO_B:M-20430", "DEMO_C:4500-320"),
    ("chain", "The chain trap: vague links must not join different grades",
     "A carbon-steel valve could be A216 WCB or A105, but WCB and A105 are different. Approve both links and watch what happens.",
     "DEMO_A:10004107", "DEMO_C:4500-319"),
    ("generic", "Outside the templated classes", "A pump. Review only: GENERIC records are never auto-merged.",
     "DEMO_A:10004115", "DEMO_B:M-20435"),
]

EDGE = ["GLB VLV 2IN 150# A105 FLGD", "BLV 1IN 300# SS316 FLANGED", "CHK VLV 3IN CL150 CS FLGD", "NON-RETURN VALVE 2IN CL150 A216 WCB FLANGED",
        "SEML PIPE 2IN SCH40 A106 GR B", "STUD BOLT M16 X 100 A193 B7 THD", "GATE VL 2IN CL150 A216 WCB FLANGED", "FLGS WN 2IN CL150 RF SCH40 A105",
        "VALVE 5 NO", "", "   ", "VALVE", "FLANGE WN 2\" CL150", "gate valve 2in 150# cs flgd", "BOLT STUD M16 X 100MM A193-B7 ÄÖÜ ß",
        "PIPE SMLS NPS 1-1/2 SCH 40 A106 GR. B", "FLANGE WN 12IN CL600 RF STD A105 NACE MR0175",
        "BALL VALVE 3IN CL300 CL150 SS316", "HEX NUT M16 ASTM A194 2H", "CENTRIFUGAL PUMP 50 M3H 30M HEAD",
        "ΒΑΛΒΕ GATE 2IN 150#", "FLANGE   WN\t2\"  150#  RF  SCH40  A105  DRG NO 4471-A  TAG NO PV-102",
        "GATE VALVE DN50 PN16 SS316 FLANGED API 600", "SUPPLY OF PIPE ERW 2.5\" SCH40 A53 GR B AS PER SPEC"]


def raw_input(r: RawRecord) -> dict:
    return {"cpse": r.cpse, "matnr": r.matnr, "maktx": r.maktx, "long_text": r.long_text, "meins": r.meins,
            "mfr": r.mfr, "mpn": r.mpn, "last_po_price": r.last_po_price, "annual_qty": r.annual_qty,
            "characteristics": r.characteristics}


def rec_expected(raw: RawRecord, assets: Assets) -> dict:
    norms, recs = standardise([raw], assets.cfg)
    n, rec = norms[raw.record_id], recs[raw.record_id]
    return {"normalized": n.norm_text, "uom": n.uom_norm, "transforms": [t.model_dump() for t in n.transforms],
            "class_code": rec.class_code, "class_confidence": rec.class_confidence, "abstained": rec.abstained,
            "tier": rec.tier, "tier_reasons": rec.tier_reasons,
            "attributes": {k: v.model_dump() for k, v in rec.attributes.items()},
            "residuals": rec.residuals.model_dump(), "sanity_flags": [f.model_dump() for f in rec.sanity_flags],
            "mfr_norm": rec.mfr_norm, "mpn_norm": rec.mpn_norm}


def pair_expected(l: RawRecord, r: RawRecord, assets: Assets) -> dict:
    p = evaluate_pair(l, r, assets)
    return {"class_code": p.class_code, "tier": p.tier, "comparison": [c.model_dump() for c in p.comparison],
            "residual_diff": p.residual_diff.model_dump(), "rules": [x.model_dump() for x in p.rules],
            "features": dict(p.features), "gate_score": p.gate_score, "baseline_score": p.baseline_score,
            "zone": p.zone, "zone_step": p.zone_step, "reason": p.zone_reason}


def load_generated(path: Path) -> dict[str, RawRecord]:
    out = {}
    for row in csv.DictReader(open(path, encoding="utf-8")):
        rid = row["record_id"]
        out[rid] = RawRecord(
            record_id=rid, cpse=row["cpse"], matnr=row["matnr"], maktx=row["maktx"], long_text=row.get("long_text", ""),
            meins=row.get("meins", ""), characteristics=parse_characteristics(row.get("characteristics")),
            mfr=row.get("mfr", ""), mpn=row.get("mpn", ""),
            last_po_price=float(row["last_po_price"]) if row.get("last_po_price") else None,
            annual_qty=float(row["annual_qty"]) if row.get("annual_qty") else None)
    return out


def dump(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    assets = load_assets()
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(11)
    sample = records_from_csv(SAMPLE / "sama_nmc_sample.csv")
    demo = load_generated(ROOT / "data/synthetic/demo/records.csv")
    unseen = load_generated(ROOT / "data/synthetic/unseen/records.csv")

    # ---- records
    edge = [RawRecord(record_id=f"EDGE:{i}", cpse="EDGE", matnr=str(i), maktx=t) for i, t in enumerate(EDGE)]
    recs = sample + rng.sample(list(demo.values()), 600) + rng.sample(list(unseen.values()), 450) + edge
    dump(OUT / "records.json", [{"input": raw_input(r), "expected": rec_expected(r, assets)} for r in recs])

    # ---- pairs: stratified by generator pair type, plus every candidate pair of the sample run
    pair_cases: list[tuple[RawRecord, RawRecord]] = []
    for name, data in (("demo", demo), ("unseen", unseen)):
        by_type: dict[str, list[tuple[str, str]]] = {}
        for row in csv.DictReader(open(ROOT / f"data/synthetic/{name}/pair_labels.csv", encoding="utf-8")):
            by_type.setdefault(row["pair_type"], []).append((row["left_id"], row["right_id"]))
        for t, ps in sorted(by_type.items()):
            for a, b in rng.sample(ps, min(len(ps), 70 if name == "demo" else 40)):
                a, b = sorted((a, b))
                pair_cases.append((data[a], data[b]))
    sample_res = evaluate(sample, assets)
    for a, b in sorted(sample_res.pairs):
        pair_cases.append((sample_res.raws[a], sample_res.raws[b]))
    dump(OUT / "pairs.json", [{"left": raw_input(l), "right": raw_input(r), "expected": pair_expected(l, r, assets)}
                              for l, r in pair_cases])

    # ---- full runs (fixed timestamps)
    truth = {rid: m for m, ids in TRUTH_GROUPS.items() for rid in ids}
    run1 = build_run_output(sample_res, "RUN-GOLDEN", "sample", TS0, TS1, truth)
    dump(OUT / "sample_run.json", {"input": [raw_input(r) for r in sample], "expected": run1})
    subset = list(unseen.values())[:250]
    run2 = build_run_output(evaluate(subset, assets), "RUN-GOLDEN-2", "upload", TS0, TS1)
    dump(OUT / "subset_run.json", {"input": [raw_input(r) for r in subset], "expected": run2})

    # ---- frozen text model + shared fuzzy definition
    texts = [rec_expected(r, assets)["normalized"] for r in rng.sample(list(demo.values()), 120) +
             rng.sample(list(unseen.values()), 60)] + ["centrifugal pump 50 m3h 30m head", "", "a", "ab", "ÄÖÜ ß straße"]
    tm = assets.text_model
    vecs = [{"text": t, "ngrams": len(char_wb_ngrams(t)), "vector": [[int(k), x] for k, x in tm.vector(t).items()]}
            for t in texts]
    cos_cases = []
    for _ in range(300):
        i, j = rng.randrange(len(texts)), rng.randrange(len(texts))
        cos_cases.append({"a": i, "b": j, "cos": tm.cosine(tm.vector(texts[i]), tm.vector(texts[j]))})
    fz = []
    for _ in range(600):
        a, b = rng.choice(texts), rng.choice(texts)
        fz.append({"a": a, "b": b, "ratio": token_set_ratio(a, b)})
    buckets = [{"ngram": g, "bucket": bucket_of(g)} for g in sorted({g for t in texts[:40] for g in char_wb_ngrams(t)})[:400]]
    dump(OUT / "textmodel.json", {"texts": vecs, "cosines": cos_cases, "token_set_ratio": fz, "buckets": buckets})

    # ---- audit chain with fixed timestamps (strings / ints / booleans only)
    chain = AuditChain()
    events_in = [("engine", "RUN_STARTED", "run", "R1", {"records": 3, "scope": "sample"}),
                 ("engine", "DECISION_RECORDED", "decision", "A~B",
                  {"zone": "REJECT", "step": 2, "kind": "lookalike", "rules_fired": "R-01"}),
                 ("Demo analyst", "REVIEW_APPROVED", "decision", "A~C", {"approvals": 1, "comment": "ok ÄÖ ß 日本"}),
                 ("engine", "NMC_MINTED", "nmc", "NMC:1201-0000001-3", {"members": 3, "flag": True})]
    for a, act, et, eid, pl in events_in:
        chain.append(TS0, a, act, et, eid, pl)
    dump(OUT / "audit.json", {"ts": TS0, "events_in": events_in, "chain": chain.events})

    # ---- sample meta + truth for the UI
    (SAMPLE / "sample_truth.json").write_text(json.dumps(truth, indent=1), encoding="utf-8")
    meta = {"title": "Sample: three companies, one national material master",
            "note": "All records are synthetic demo data. DEMO_A, DEMO_B and DEMO_C are not real organisations.",
            "cpses": [{"id": "DEMO_A", "label": "Demo CPSE A"}, {"id": "DEMO_B", "label": "Demo CPSE B"},
                      {"id": "DEMO_C", "label": "Demo CPSE C"}],
            "showcase_records": ["DEMO_A:10004101", "DEMO_B:M-20417", "DEMO_C:4500-310", "DEMO_A:10004108", "DEMO_B:M-20427"],
            "featured": [{"key": k, "title": t, "blurb": b, "left": l, "right": r,
                          "decision_id": "~".join(sorted((l, r)))} for k, t, b, l, r in FEATURED]}
    (SAMPLE / "sample_meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")

    # the featured pairs must exist as decisions with the zones the story promises
    by_id = {d["id"]: d for d in run1["decisions"]}
    expect = {"lookalike": "REJECT", "vague": "REVIEW", "verified": "AUTO_MERGE", "missing": "REVIEW", "risk": "REVIEW",
              "table": "REVIEW", "mpn": "AUTO_MERGE", "generic": "REVIEW", "chain": "REVIEW"}
    for f in meta["featured"]:
        d = by_id.get(f["decision_id"])
        assert d, f"featured pair missing from decisions: {f['key']}"
        assert d["zone"] == expect[f["key"]], f"{f['key']} is {d['zone']}, story needs {expect[f['key']]}"
    print("golden fixtures written:", sorted(p.name for p in OUT.glob("*.json")))
    print("sample summary:", run1["summary"], "| answer key:", run1["fuzzy"]["answer_key"])


if __name__ == "__main__":
    main()
