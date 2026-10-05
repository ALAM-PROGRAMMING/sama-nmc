"""Candidate recall when embeddings may only pair records of the SAME class code (what ships).

A pair across different classes (e.g. a GENERIC record vs a templated valve) has no attribute
comparison and cannot be merged by the engine, so it is not proposed.
"""
import json
import sys

import torch
from sentence_transformers import SentenceTransformer

from common import current_blocking_pairs, load_set, true_pairs


def run(model_path: str, name: str, only: str | None, k: int) -> dict:
    ds = load_set(name)
    model = SentenceTransformer(model_path, device="cuda")
    ids = [r for r in ds["text"] if only is None or ds["split"][r] == only]
    emb = model.encode([ds["text"][r] for r in ids], batch_size=256, convert_to_tensor=True, normalize_embeddings=True, show_progress_bar=False)
    cls = [ds["klass"][r] for r in ids]
    code = {c: i for i, c in enumerate(sorted(set(cls)))}
    ct = torch.tensor([code[c] for c in cls], device=emb.device)
    out = set()
    for s in range(0, len(ids), 1024):
        sims = emb[s:s + 1024] @ emb.T
        same = ct[s:s + 1024, None] == ct[None, :]
        sims = torch.where(same, sims, torch.full_like(sims, -2.0))
        for r in range(sims.shape[0]):
            sims[r, s + r] = -2.0
        top = torch.topk(sims, min(k, len(ids) - 1), dim=1)
        for r in range(sims.shape[0]):
            for v, j in zip(top.values[r].tolist(), top.indices[r].tolist()):
                if v > -1.0:
                    a, b = ids[s + r], ids[j]
                    out.add((a, b) if a < b else (b, a))
    true = true_pairs(ds, only); keep = set(ids)
    cur = {p for p in current_blocking_pairs(ds) if p[0] in keep and p[1] in keep}
    same_class_true = {p for p in true if ds["klass"][p[0]] == ds["klass"][p[1]]}
    pct = lambda n, d: round(100 * n / d, 2)
    return {"set": name, "true_pairs": len(true), "true_pairs_same_class": len(same_class_true),
            "recall_current_pct": pct(len(true & cur), len(true)),
            "recall_embed_same_class_pct": pct(len(true & out), len(true)),
            "recall_union_same_class_pct": pct(len(true & (out | cur)), len(true)),
            "extra_pairs": len(out - cur), "extra_true": len(true & (out - cur))}


if __name__ == "__main__":
    m = sys.argv[1] if len(sys.argv) > 1 else "../../models/embedder-final"
    print(json.dumps([run(m, "demo", "test", 20), run(m, "unseen", None, 20)], indent=1))
