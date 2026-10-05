"""Evaluate an embedding model as an extra CANDIDATE GENERATOR (not a decision maker).

For each evaluation set it reports how many true duplicate pairs are found by
  (a) the existing blockers (attribute key + frozen text TF-IDF),
  (b) embeddings alone (top-k nearest neighbours across ALL records, class-agnostic),
  (c) the union,
plus how many extra pairs the embeddings add (the cost) and encoding speed.

    python bench/gpu/eval_embedder.py --model sentence-transformers/all-MiniLM-L6-v2 --k 20
    python bench/gpu/eval_embedder.py --model models/embedder-v1 --k 20
"""
from __future__ import annotations

import argparse
import json
import time

import torch
from sentence_transformers import SentenceTransformer

from common import current_blocking_pairs, load_set, true_pairs


def encode(model: SentenceTransformer, texts: list[str], device: str, batch: int = 256):
    if device == "cuda":
        torch.cuda.synchronize()
    t0 = time.perf_counter()
    emb = model.encode(texts, batch_size=batch, convert_to_tensor=True, normalize_embeddings=True, device=device,
                       show_progress_bar=False)
    if device == "cuda":
        torch.cuda.synchronize()
    return emb, time.perf_counter() - t0


def knn_pairs(emb: torch.Tensor, ids: list[str], k: int) -> set[tuple[str, str]]:
    out: set[tuple[str, str]] = set()
    n = emb.shape[0]
    for s in range(0, n, 2048):
        sims = emb[s:s + 2048] @ emb.T
        for r in range(sims.shape[0]):
            sims[r, s + r] = -2.0                              # never itself
        top = torch.topk(sims, min(k, n - 1), dim=1).indices.cpu().numpy()
        for r, row in enumerate(top):
            a = ids[s + r]
            for j in row:
                b = ids[int(j)]
                out.add((a, b) if a < b else (b, a))
    return out


def evaluate(model_path: str, ds_name: str, only_split: str | None, k: int, device: str) -> dict:
    ds = load_set(ds_name)
    model = SentenceTransformer(model_path, device=device)
    ids = [rid for rid in ds["text"] if only_split is None or ds["split"][rid] == only_split]
    emb, secs = encode(model, [ds["text"][r] for r in ids], device)
    true = true_pairs(ds, only_split)
    keep = set(ids)
    cur = {p for p in current_blocking_pairs(ds) if p[0] in keep and p[1] in keep}
    emb_pairs = knn_pairs(emb, ids, k)
    union = cur | emb_pairs
    extra = emb_pairs - cur
    pct = lambda n: round(100.0 * n / len(true), 2)
    return {"set": ds_name, "split": only_split or "all", "records": len(ids), "true_pairs": len(true), "k": k,
            "recall_current_pct": pct(len(true & cur)), "recall_embedding_only_pct": pct(len(true & emb_pairs)),
            "recall_union_pct": pct(len(true & union)), "extra_pairs": len(extra), "extra_true_pairs": len(true & extra),
            "current_pairs": len(cur), "encode_seconds": round(secs, 3), "device": device}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="sentence-transformers/all-MiniLM-L6-v2")
    ap.add_argument("--k", type=int, default=20)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    rows = [evaluate(a.model, "demo", "test", a.k, a.device), evaluate(a.model, "unseen", None, a.k, a.device)]
    print(json.dumps({"model": a.model, "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                      "results": rows}, indent=1))
    if a.out:
        open(a.out, "w").write(json.dumps({"model": a.model, "results": rows}, indent=1))


if __name__ == "__main__":
    main()
