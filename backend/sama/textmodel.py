"""Frozen hashed character n-gram TF-IDF text model (spec clarification SC-02).

IDF is fit ONCE on the synthetic train split, then shipped as `text_model.json` and loaded
unchanged by the Python reference and the browser engine, so text similarity is identical on
every run and in every implementation (it does not depend on the corpus being processed).

Hashing means ANY text gets a usable vector, including materials and wording never seen in the
benchmark (uploads, GENERIC items); a fitted vocabulary would silently drop unseen n-grams.

Definition (kept deliberately simple so it is trivially portable):
  analyzer : lower-case; split on whitespace; each word w -> " "+w+" "; n-grams n=3..5
             (sklearn `char_wb` layout, including the short-word rule)
  bucket   : FNV-1a 32-bit over the UTF-8 bytes of the n-gram, modulo n_buckets
  weights  : tf = 1 + ln(count in bucket); idf = ln((1+N)/(1+df)) + 1 for buckets seen in the
             fit; every unseen bucket gets the maximum idf (df = 0); vector is L2-normalised
"""
from __future__ import annotations

import json
import math
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

NGRAM_MIN, NGRAM_MAX = 3, 5
N_BUCKETS = 32768


def char_wb_ngrams(text: str) -> list[str]:
    out: list[str] = []
    for word in text.lower().split():
        w = " " + word + " "
        wl = len(w)
        for n in range(NGRAM_MIN, NGRAM_MAX + 1):
            offset = 0
            out.append(w[offset:offset + n])
            while offset + n < wl:
                offset += 1
                out.append(w[offset:offset + n])
            if offset == 0:                                # a word shorter than n is counted once
                break
    return out


@lru_cache(maxsize=1 << 18)
def fnv1a32(s: str) -> int:
    h = 2166136261
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def bucket_of(ngram: str, n_buckets: int = N_BUCKETS) -> int:
    return fnv1a32(ngram) % n_buckets


@dataclass(frozen=True)
class TextModel:
    n_buckets: int
    default_idf: float
    idf: dict[int, float]            # only buckets seen during the fit; the rest use default_idf
    meta: dict

    def vector(self, text: str) -> dict[int, float]:
        """Sparse L2-normalised TF-IDF vector {bucket: weight}, in first-occurrence order."""
        counts: Counter[int] = Counter(bucket_of(g, self.n_buckets) for g in char_wb_ngrams(text))
        vec = {b: (1.0 + math.log(c)) * self.idf.get(b, self.default_idf) for b, c in counts.items()}
        norm = math.sqrt(sum(v * v for v in vec.values()))
        return {k: v / norm for k, v in vec.items()} if norm > 0 else {}

    @staticmethod
    def cosine(a: dict[int, float], b: dict[int, float]) -> float:
        if len(a) > len(b):
            a, b = b, a
        return sum(v * b[k] for k, v in a.items() if k in b)

    def to_json(self) -> dict:
        return {"meta": self.meta, "n_buckets": self.n_buckets, "default_idf": round(self.default_idf, 12),
                "idf": {str(k): round(v, 12) for k, v in sorted(self.idf.items())}}

    @staticmethod
    def from_json(d: dict) -> "TextModel":
        return TextModel(int(d["n_buckets"]), float(d["default_idf"]), {int(k): float(v) for k, v in d["idf"].items()},
                         d["meta"])

    def save(self, path: Path | str) -> None:
        Path(path).write_text(json.dumps(self.to_json(), separators=(",", ":")), encoding="utf-8")

    @staticmethod
    def load(path: Path | str) -> "TextModel":
        return TextModel.from_json(json.loads(Path(path).read_text(encoding="utf-8")))


def fit_text_model(texts: list[str], n_buckets: int = N_BUCKETS) -> TextModel:
    n_docs = len(texts)
    df: Counter[int] = Counter()
    for t in texts:
        df.update({bucket_of(g, n_buckets) for g in char_wb_ngrams(t)})
    idf = {b: math.log((1 + n_docs) / (1 + c)) + 1.0 for b, c in df.items()}
    meta = {"version": 2, "hashing": "fnv1a32-utf8", "ngram_range": [NGRAM_MIN, NGRAM_MAX], "n_docs": n_docs,
            "n_buckets": n_buckets, "n_seen_buckets": len(idf),
            "fit_on": "synthetic train split (pass-2 normalized text)"}
    return TextModel(n_buckets, math.log(1 + n_docs) + 1.0, idf, meta)
