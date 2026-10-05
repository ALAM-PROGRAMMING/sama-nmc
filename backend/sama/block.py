"""Candidate generation within class (FR-MATCH-01, Architecture §7.5).

Critical-attribute key ∪ char 3–5-gram TF-IDF top-k. GENERIC blocks with TF-IDF only.
Sentence embeddings join the union in Phase 1 (`embed` stage); `blockers` records which
blocker produced each pair so per-blocker recall can be reported.
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np
from scipy.sparse import csr_matrix

from .config import Config
from .contracts import RecordAttributes
from .textmodel import TextModel

GENERIC = "9999"


class TextIndex:
    """Frozen-model TF-IDF vectors over pass-2 normalized text (SC-02); also the tfidf_cos feature."""

    def __init__(self, texts: dict[str, str], model: TextModel):
        self.model = model
        self.ids = list(texts)
        self.pos = {rid: i for i, rid in enumerate(self.ids)}
        self.vecs = [model.vector(texts[i]) for i in self.ids]
        rows, cols, vals = [], [], []
        for r, v in enumerate(self.vecs):
            for c, w in v.items():
                rows.append(r)
                cols.append(c)
                vals.append(w)
        self.X = csr_matrix((vals, (rows, cols)), shape=(len(self.ids), model.n_buckets))

    def cos(self, a: str, b: str) -> float:
        return self.model.cosine(self.vecs[self.pos[a]], self.vecs[self.pos[b]])


def _key(rec: RecordAttributes, cfg: Config) -> tuple | None:
    tmpl = cfg.classes.get(rec.class_code)
    if not tmpl or rec.class_code == GENERIC:
        return None
    parts = []
    for p in tmpl.properties:
        if not p.get("critical"):
            continue
        a = rec.attributes.get(p["name"])
        if a is None or a.value is None:
            return None                                   # key blocking needs every critical value
        parts.append((p["name"], a.resolved if p.get("resolver") and a.resolved is not None else a.value))
    return (rec.class_code, *parts)


def _key2(rec: RecordAttributes, cfg: Config, n: int = 2) -> tuple | None:
    """Coarse key on the first two critical properties (size+class, size+wall, thread+length).
    Catches pairs where a later attribute (often material) is vaguer or missing on one side."""
    tmpl = cfg.classes.get(rec.class_code)
    if not tmpl or rec.class_code == GENERIC:
        return None
    parts = []
    for p in [p for p in tmpl.properties if p.get("critical")][:n]:
        a = rec.attributes.get(p["name"])
        if a is None or a.value is None:
            return None
        parts.append(a.resolved if p.get("resolver") and a.resolved is not None else a.value)
    return (rec.class_code, *parts)


def block(records: dict[str, RecordAttributes], index: TextIndex, cfg: Config,
          top_k: int | None = None) -> dict[tuple[str, str], list[str]]:
    top_k = top_k or int(cfg["models"].get("tfidf", {}).get("top_k", 20))
    pairs: dict[tuple[str, str], set[str]] = defaultdict(set)

    def add(a: str, b: str, how: str) -> None:
        if a != b:
            pairs[(a, b) if a < b else (b, a)].add(how)

    by_key: dict[tuple, list[str]] = defaultdict(list)
    by_key2: dict[tuple, list[str]] = defaultdict(list)
    by_key1: dict[tuple, list[str]] = defaultdict(list)
    by_class: dict[str, list[str]] = defaultdict(list)
    for rid, rec in records.items():
        by_class[rec.class_code].append(rid)
        k = _key(rec, cfg)
        if k:
            by_key[k].append(rid)
        k2 = _key2(rec, cfg)
        if k2:
            by_key2[k2].append(rid)
        else:                                              # second critical value missing: size-only bucket
            k1 = _key2(rec, cfg, n=1)
            if k1:
                by_key1[k1].append(rid)
    full_by_k1: dict[tuple, list[str]] = defaultdict(list)
    for k2, ms in by_key2.items():
        full_by_k1[k2[:2]].extend(ms)
    for k1, partial in by_key1.items():                    # partial records x their size bucket only
        for a in partial:
            for b in full_by_k1.get(k1, []) + partial:
                add(a, b, "key1")
    for name, buckets in (("key", by_key), ("key2", by_key2)):
        for members in buckets.values():
            if len(members) > int(cfg["tiers"].get("block_bucket_max", 200)):
                continue                                   # oversized bucket: leave it to TF-IDF
            for i, a in enumerate(members):
                for b in members[i + 1:]:
                    add(a, b, name)
    for members in by_class.values():
        if len(members) < 2:
            continue
        rows = [index.pos[m] for m in members]
        Xc = index.X[rows]
        sims = (Xc @ Xc.T).toarray()
        # deterministic top-k: similarities quantised to 1e-9, ties broken by member order (SC-04),
        # so the browser engine reproduces exactly the same candidate set
        q = np.floor(sims * 1e9 + 0.5).astype(np.int64)
        np.fill_diagonal(q, -1)
        k = min(top_k, len(members) - 1)
        order = np.argsort(-q, axis=1, kind="stable")[:, :k]
        for i, js in enumerate(order):
            for j in js:
                if q[i, j] > 0:
                    add(members[i], members[j], "tfidf")
    return {k: sorted(v) for k, v in pairs.items()}
