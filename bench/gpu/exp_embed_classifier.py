"""Experiment: classify head-pattern abstentions by k-nearest labelled TRAIN examples in embedding space."""
import csv
from collections import Counter

import torch
from sentence_transformers import SentenceTransformer

from common import ROOT, load_set

model = SentenceTransformer(str(ROOT / "models" / "embedder-final"), device="cuda")


def true_class(name):
    return {r["true_material_id"]: r["class_code"] for r in csv.DictReader(open(ROOT / "data/synthetic" / name / "truth.csv", encoding="utf-8"))}


def enc(texts):
    return model.encode(texts, batch_size=256, convert_to_tensor=True, normalize_embeddings=True, show_progress_bar=False)


demo, unseen = load_set("demo"), load_set("unseen")
tcd, tcu = true_class("demo"), true_class("unseen")
train = [r for r, s in demo["split"].items() if s == "train"]
Etr = enc([demo["text"][r] for r in train]); ytr = [tcd[demo["truth"][r]] for r in train]
abst = [r for r in unseen["text"] if unseen["klass"][r] == "9999"]
Eab = enc([unseen["text"][r] for r in abst]); truth = [tcu[unseen["truth"][r]] for r in abst]
sims = Eab @ Etr.T
for k in (5, 10):
    top = torch.topk(sims, k, dim=1)
    for share_thr in (0.6, 0.8, 1.0):
        for sim_thr in (0.0, 0.5, 0.65):
            n = right = 0
            for i in range(len(abst)):
                votes = Counter(ytr[j] for j, s in zip(top.indices[i].tolist(), top.values[i].tolist()) if s >= sim_thr)
                if not votes: continue
                cls, c = votes.most_common(1)[0]
                if c / k >= share_thr:
                    n += 1; right += cls == truth[i]
            print(f"k={k} vote>={share_thr} sim>={sim_thr}: confident {n}/{len(abst)} ({100*n/len(abst):.0f}%), accuracy {100*right/max(n,1):.1f}%")
