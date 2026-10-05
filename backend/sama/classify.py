"""Classification (FR-CLS-01/02, Architecture §7.2).

Head patterns first. Phase 0 has no TF-IDF + LogReg fallback yet: anything without a
head-pattern hit abstains to GENERIC (9999), which is never auto-merged.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from .config import Config

GENERIC = "9999"


@dataclass(frozen=True)
class ClassResult:
    class_code: str
    confidence: float
    abstained: bool
    head_span: tuple[int, int] | None      # char span of the head-pattern match in the text
    reason: str


@lru_cache(maxsize=8)
def _patterns(cfg: Config):
    return [(code, re.compile(p)) for code, c in cfg.classes.items() for p in c.head_patterns]


def classify(norm_text: str, cfg: Config) -> ClassResult:
    hits: dict[str, re.Match] = {}
    for code, rx in _patterns(cfg):
        m = rx.search(norm_text)
        if m and (code not in hits or m.start() < hits[code].start()):
            hits[code] = m
    if not hits:
        return ClassResult(GENERIC, 0.0, True, None, "no head pattern matched")
    if len(hits) == 1:
        code, m = next(iter(hits.items()))
        return ClassResult(code, 1.0, False, m.span(), f"head pattern '{m.group(0)}'")
    # Several heads (e.g. "STUD BOLT WITH 2 HEX NUTS"): the earliest head is the noun of the
    # description. Recorded with lower confidence so the case stays visible.
    code, m = min(hits.items(), key=lambda kv: kv[1].start())
    return ClassResult(code, 0.8, False, m.span(), f"earliest of {len(hits)} head patterns: '{m.group(0)}'")
