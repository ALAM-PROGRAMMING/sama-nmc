"""Builds and executes notebooks/idea_proof.ipynb (the idea-stage proof, PRD §7.2 / Arch §17).

python notebooks/build_idea_proof.py   (from the repo root)
"""
from pathlib import Path

import nbformat as nbf
from nbclient import NotebookClient

ROOT = Path(__file__).resolve().parents[1]
md, code = nbf.v4.new_markdown_cell, nbf.v4.new_code_cell

cells = [
    md("""# SAMA-NMC — idea-stage proof (SIH26099)

**AI proposes, rules dispose, humans approve, the ledger remembers.**

This notebook runs the real SAMA-NMC core engine end to end on a seeded synthetic benchmark
(5 CPSE house styles, noise, ~15% trap twins) and on a held-out *unseen-noise* set. It shows:

1. a trap twin (Class 150 vs Class 300) **rejected**;
2. *carbon steel* vs *A216 WCB* sent to an **engineer** (vaguer, not different);
3. a NACE vs non-NACE pair sent to **review**;
4. a weld-neck flange pair **auto-merged** with its Evidence Certificate and a National Material Code;
5. STD vs SCH40 — the same wall at 2 inch, a conflict at 12 inch;
6. an ordinary fuzzy matcher vs SAMA-NMC on **the same candidate pairs** — wrong-merge counts measured, not promised.

**Honesty notes.** All data here is synthetic (labelled). Engineering tables are `unverified` drafts pending
domain-reviewer sign-off. Precision figures are benchmark measurements, never production guarantees."""),
    code("""import sys, json, math
from pathlib import Path
ROOT = Path.cwd().parent if Path.cwd().name == "notebooks" else Path.cwd()
sys.path.insert(0, str(ROOT / "backend"))
import pandas as pd
from IPython.display import display, HTML
from sama.pipeline import run
from sama.certificate import build_certificate
from sama.export_demo import SHOWCASE, _find
from sama.nmc import validate
pd.set_option("display.max_colwidth", 80)

main = run(ROOT / "data/synthetic/demo", evidence_scope="synthetic")
unseen = run(ROOT / "data/synthetic/unseen", evidence_scope="unseen_noise", run_id="RUN-0002",
             gate=main.gate, thr_E=main.thr_E, t_base=main.t_base)
print(f"records: {len(main.raws):,}   candidate pairs: {len(main.pairs):,}   timings: {main.timings}")
print(f"unseen-noise records: {len(unseen.raws):,}   candidate pairs: {len(unseen.pairs):,}")"""),
    md("## 1. The worked examples (PRD §3.5) — every decision with its reason"),
    code("""rows = []
for _id, title, lt, rt in SHOWCASE:
    a, b = _find(main, lt), _find(main, rt)
    p = main.score_pair(a, b)
    crit = "; ".join(f"{r.property}: {r.state}" for r in p.comparison if r.critical and r.state != "agree") or "all critical agree"
    rows.append({"case": title, "left": lt, "right": rt, "zone": p.zone, "step": p.zone_step,
                 "why": p.zone_reason, "non-agreeing critical attributes": crit})
display(pd.DataFrame(rows))"""),
    md("""## 2. Size-dependent designations: STD vs SCH40

ASME schedule designations mean different wall thicknesses at different sizes. SAMA-NMC compares the
*table-resolved wall thickness*, not the label. While the size table is `unverified`, an agreement that
depends on it is capped at review (R-09)."""),
    code("""from sama.decide import build_pair, zone
from sama.pipeline import standardise
from sama.contracts import RawRecord
def adhoc(lt, rt):
    raws = [RawRecord(record_id="X:1", cpse="X", matnr="1", maktx=lt), RawRecord(record_id="Y:2", cpse="Y", matnr="2", maktx=rt)]
    _, recs = standardise(raws, main.config)
    p = build_pair(recs["X:1"], recs["Y:2"], main.config); p.gate_score = 1.0
    z, step, why = zone(p, main.thr_E, main.reject_thr, main.config)
    wall = next(r for r in p.comparison if r.property == "wall")
    return {"left": lt, "right": rt, "wall": f"{wall.left} vs {wall.right}: {wall.state}" + (" (via size table)" if wall.via else ""),
            "zone": z, "why": why}
display(pd.DataFrame([adhoc("PIPE SMLS NPS 2 STD A106 GR B", 'PIPE SEAMLESS 2" SCH40 ASTM A106 B'),
                      adhoc("PIPE SMLS NPS 12 STD A106 GR B", 'PIPE SEAMLESS 12" SCH40 ASTM A106 B')]))"""),
    md("## 3. Evidence Certificate for the auto-merged weld-neck flange pair"),
    code("""a, b = _find(main, 'FLANGE WN 2" CL150 RF SCH40 A105'), _find(main, "WELD NECK FLG, NPS 2, 150#, RF, S40, ASTM A105")
key = tuple(sorted((a, b)))
main.score_pair(a, b)
cert = build_certificate(main, key, "CERT-000004", scopes={"synthetic": main.metrics, "unseen_noise": unseen.metrics})
c = cert.model_dump()
print("NMC:", c["subject"]["nmc"], "| check digit valid:", validate(c["subject"]["nmc"]) if c["subject"]["nmc"] else None)
display(pd.DataFrame([r for r in c["comparison"]])[["property", "critical", "left", "right", "state"]])
print(json.dumps({k: c[k] for k in ("decision", "tier", "threshold", "measured_precision", "config_status", "limitations")},
                 indent=1, default=str))"""),
    md("""## 4. Ordinary fuzzy matching vs SAMA-NMC — same data, same candidate pairs

The baseline is what a typical fuzzy matcher does: `mean(char TF-IDF cosine, token_set_ratio/100)`, auto-merge
above a threshold. Its threshold is the one that **maximises its own F1 on the calibration split**, so it is shown
at its best. Counts below are on the held-out **test split**. This compares *decision safety on identical
candidate pairs*; it is not an end-to-end retrieval benchmark."""),
    code("""def table(m):
    return pd.DataFrame({mode: {"wrong auto-merges": d["auto_wrong"], "correct auto-merges": d["auto_correct"],
                                "sent to review": d["review"], "rejected": d["reject"],
                                "true matches rejected": d["reject_true_match"],
                                "auto-merge precision": d["auto_precision"], "95% upper bound on error": d["upper_bound_95"],
                                "total recall (auto+review)": d["total_recall"]}
                         for mode, d in m["modes"].items()})
print("SYNTHETIC test split —", main.metrics["n_pairs"], "candidate pairs; baseline t =", main.metrics["threshold"]["t_base"],
      "(F1", main.metrics["threshold"]["t_base_f1"], ")")
display(table(main.metrics))
print("UNSEEN-NOISE set —", unseen.metrics["n_pairs"], "candidate pairs (held-out style, abbreviations, filler)")
display(table(unseen.metrics))"""),
    code("""print("Decisions by pair type (synthetic test split):")
display(pd.DataFrame(main.metrics["by_pair_type"]).fillna(0).astype(int).T)"""),
    code("""wrong = [k for k in main.pairs if main.pair_split(k) == "test" and main.zones["baseline"][k] == "AUTO_MERGE" and not main.is_match(k)]
ex = []
for k in sorted(wrong, key=lambda k: -main.pairs[k].baseline_score)[:8]:
    p = main.pairs[k]
    ex.append({"left": main.raws[k[0]].maktx, "right": main.raws[k[1]].maktx, "type": main.pair_types.get(k, "random"),
               "fuzzy score": round(p.baseline_score, 3), "fuzzy": "AUTO_MERGE", "SAMA-NMC": p.zone, "SAMA reason": p.zone_reason})
print("Examples the fuzzy matcher merged that are NOT the same item:")
display(pd.DataFrame(ex))"""),
    md("## 5. Hard safety gates (PRD §11) and threshold evidence"),
    code("""display(pd.DataFrame({"synthetic": main.metrics["safety"], "unseen_noise": unseen.metrics["safety"]}))
print(json.dumps(main.metrics["threshold"], indent=1))
print("blocking recall (synthetic test):", main.metrics["blocking"])"""),
    md("""**Reading the threshold line.** The Tier E auto-merge threshold is chosen on the calibration split so that the
95% upper bound on the false-merge rate stays within 0.5%, which needs at least 598 error-free auto-eligible pairs.
If the calibration split is too small, Tier E does not auto-merge by score at all and the report says so."""),
    md("## 6. National Material Codes minted"),
    code("""rows = []
for code, v in list(main.nmcs.items()):
    if v["kind"] == "cluster" and len({main.raws[r].cpse for r in v["members"]}) >= 2:
        rows.append({"NMC": code, "valid": validate(code), "short text": v["short_text"],
                     "legacy codes": ", ".join(f"{main.raws[r].cpse}:{main.raws[r].matnr}" for r in v["members"])})
print(f"NMCs minted: {len(main.nmcs):,} ({sum(v['kind']=='cluster' for v in main.nmcs.values())} verified clusters); "
      f"records pending engineer review (no code yet, by design): {len(main.pending):,}")
display(pd.DataFrame(rows[:10]))"""),
]

nb = nbf.v4.new_notebook(cells=cells, metadata={"kernelspec": {"name": "python3", "display_name": "Python 3"}})
out = ROOT / "notebooks" / "idea_proof.ipynb"
NotebookClient(nb, timeout=900, kernel_name="python3", resources={"metadata": {"path": str(ROOT / "notebooks")}}).execute()
nbf.write(nb, out)
print("wrote", out)
