"""Shared loading for the GPU embedding experiments (Track G).

Embeddings only widen WHICH PAIRS GET CONSIDERED. They never enter a rule, the gate or a zone
(invariant I-14, spec clarification SC-03), so this work cannot change any decision.
"""
from __future__ import annotations

import csv
import pickle
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from sama.config import default_config  # noqa: E402
from sama.contracts import RawRecord  # noqa: E402
from sama.extract import parse_characteristics  # noqa: E402
from sama.pipeline import standardise  # noqa: E402

CACHE = ROOT / "bench" / "reports"


def load_set(name: str) -> dict:
    """records, truth (record -> material), split, normalized text and class per record."""
    path = ROOT / "data" / "synthetic" / name / "records.csv"
    raws, truth, split = [], {}, {}
    for row in csv.DictReader(open(path, encoding="utf-8")):
        raws.append(RawRecord(
            record_id=row["record_id"], cpse=row["cpse"], matnr=row["matnr"], maktx=row["maktx"],
            long_text=row.get("long_text", ""), meins=row.get("meins", ""),
            characteristics=parse_characteristics(row.get("characteristics")), mfr=row.get("mfr", ""), mpn=row.get("mpn", ""),
            last_po_price=float(row["last_po_price"]) if row.get("last_po_price") else None,
            annual_qty=float(row["annual_qty"]) if row.get("annual_qty") else None))
        truth[row["record_id"]] = row["true_material_id"]
        split[row["record_id"]] = row["split"]
    norms, recs = standardise(raws, default_config())
    return {"name": name, "raws": {r.record_id: r for r in raws}, "truth": truth, "split": split,
            "text": {rid: n.norm_text for rid, n in norms.items()},
            "klass": {rid: r.class_code for rid, r in recs.items()},
            "raw_text": {r.record_id: r.maktx for r in raws}}


def true_pairs(ds: dict, only_split: str | None = None) -> set[tuple[str, str]]:
    by: dict[str, list[str]] = {}
    for rid, m in ds["truth"].items():
        if only_split is None or ds["split"][rid] == only_split:
            by.setdefault(m, []).append(rid)
    return {tuple(sorted((a, b))) for ms in by.values() for i, a in enumerate(ms) for b in ms[i + 1:]}


def current_blocking_pairs(ds: dict) -> set[tuple[str, str]]:
    """Candidate pairs the existing blockers (attribute key + frozen text TF-IDF) produce. Cached on disk."""
    cache = CACHE / f"blocking_pairs_{ds['name']}.pkl"
    if cache.exists():
        return pickle.loads(cache.read_bytes())
    from sama.block import TextIndex, block
    from sama.pipeline import standardise as std
    from sama.textmodel import TextModel
    cfg = default_config()
    _, recs = std(list(ds["raws"].values()), cfg)
    model = TextModel.load(ROOT / "engine_assets" / "text_model.json")
    index = TextIndex(ds["text"], model)
    pairs = set(block(recs, index, cfg))
    cache.write_bytes(pickle.dumps(pairs))
    return pairs
