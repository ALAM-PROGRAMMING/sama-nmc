"""Fine-tune a small sentence-embedding model on the GPU to retrieve duplicate material records.

Trained ONLY on the synthetic TRAIN split. Evaluation uses the held-out test split and the
unseen-noise set (new house style, abbreviations and filler never seen here).

  anchor    : a record's normalised text
  positive  : another record of the SAME material (different wording / house style)
  negative  : a HARD negative: a trap twin (differs in exactly one critical attribute), a risk-word
              or part-number-suffix look-alike, or else another material of the same class

The model only proposes candidate pairs. It never decides a merge (rules and the frozen gate do).

    python bench/gpu/train_embedder.py --base sentence-transformers/all-MiniLM-L6-v2 --out models/embedder-v1
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import time
from collections import defaultdict
from pathlib import Path

import torch
from datasets import Dataset
from sentence_transformers import SentenceTransformer, SentenceTransformerTrainer, SentenceTransformerTrainingArguments, losses
from sentence_transformers.training_args import BatchSamplers

from common import ROOT, load_set


def build_triplets(ds: dict, seed: int, per_anchor: int) -> list[tuple[str, str, str]]:
    rng = random.Random(seed)
    train = [r for r, s in ds["split"].items() if s == "train"]
    train_set = set(train)
    by_mat: dict[str, list[str]] = defaultdict(list)
    for r in train:
        by_mat[ds["truth"][r]].append(r)
    hard: dict[str, list[str]] = defaultdict(list)
    for row in csv.DictReader(open(ROOT / "data/synthetic" / ds["name"] / "pair_labels.csv", encoding="utf-8")):
        a, b = row["left_id"], row["right_id"]
        if row["is_match"] == "0" and row["pair_type"] in ("trap", "riskword", "mpn_suffix") and a in train_set and b in train_set:
            hard[a].append(b)
            hard[b].append(a)
    by_class: dict[str, list[str]] = defaultdict(list)
    for r in train:
        by_class[ds["klass"][r]].append(r)
    out = []
    for r in train:
        mates = [x for x in by_mat[ds["truth"][r]] if x != r]
        if not mates:
            continue
        for _ in range(per_anchor):
            pos = rng.choice(mates)
            if hard[r]:
                neg = rng.choice(hard[r])
            else:
                pool = [x for x in by_class[ds["klass"][r]] if ds["truth"][x] != ds["truth"][r]]
                neg = rng.choice(pool or train)
            out.append((ds["text"][r], ds["text"][pos], ds["text"][neg]))
    rng.shuffle(out)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="sentence-transformers/all-MiniLM-L6-v2")
    ap.add_argument("--out", default="models/embedder-v1")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--per-anchor", type=int, default=2)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    a = ap.parse_args()
    use_gpu = a.device == "cuda"
    if use_gpu:
        assert torch.cuda.is_available(), "CUDA not available: run inside .venv-gpu"
        print("GPU:", torch.cuda.get_device_name(0), f"{torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    ds = load_set("demo")
    triplets = build_triplets(ds, a.seed, a.per_anchor)
    print("training triplets:", len(triplets), "| example:", triplets[0])
    data = Dataset.from_dict({"anchor": [t[0] for t in triplets], "positive": [t[1] for t in triplets],
                              "negative": [t[2] for t in triplets]})
    model = SentenceTransformer(a.base, device=a.device)
    args = SentenceTransformerTrainingArguments(
        output_dir=str(ROOT / a.out / "_trainer"), num_train_epochs=a.epochs, per_device_train_batch_size=a.batch,
        learning_rate=a.lr, warmup_ratio=0.1, fp16=use_gpu, use_cpu=not use_gpu, batch_sampler=BatchSamplers.NO_DUPLICATES, seed=a.seed,
        logging_steps=20, save_strategy="no", report_to="none")
    trainer = SentenceTransformerTrainer(model=model, args=args, train_dataset=data,
                                         loss=losses.MultipleNegativesRankingLoss(model))
    t0 = time.perf_counter()
    trainer.train()
    secs = time.perf_counter() - t0
    out = ROOT / a.out
    model.save(str(out))
    (out / "train_info.json").write_text(json.dumps({
        "base": a.base, "triplets": len(triplets), "epochs": a.epochs, "batch": a.batch, "lr": a.lr, "fp16": use_gpu, "device": a.device,
        "train_seconds": round(secs, 1), "gpu": torch.cuda.get_device_name(0) if use_gpu else None, "trained_on": "synthetic train split only",
        "peak_vram_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2) if use_gpu else None}, indent=1))
    print(f"trained in {secs:.1f}s on {a.device} -> {out}")


if __name__ == "__main__":
    main()
