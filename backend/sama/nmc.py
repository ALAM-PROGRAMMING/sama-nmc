"""National Material Code: mint, validate, golden record (FR-NMC, Architecture §7.10).

Format NMC:CCCC-NNNNNNN-K. The 7-digit serial is the permanent, non-significant identity;
K is the ISO/IEC 7064 MOD 11-2 check character over CCCC+NNNNNNN.
"""
from __future__ import annotations

import re
from collections import Counter

from .config import Config
from .contracts import RecordAttributes

_NMC_RE = re.compile(r"NMC:(\d{4})-(\d{7})-([0-9X])")


def mod11_2_check(digits: str) -> str:
    """ISO/IEC 7064 MOD 11-2. Verified: '000000021825009' -> '7' (ORCID test vector)."""
    p = 0
    for ch in digits:
        p = ((p + int(ch)) * 2) % 11
    c = (12 - p) % 11
    return "X" if c == 10 else str(c)


def format_nmc(class_code: str, serial: int | str) -> str:
    s = f"{int(serial):07d}"
    return f"NMC:{class_code}-{s}-{mod11_2_check(class_code + s)}"


def validate(code: str) -> bool:
    m = _NMC_RE.fullmatch(code)
    return bool(m) and mod11_2_check(m[1] + m[2]) == m[3]


class SerialAllocator:
    """Globally unique, never reused. A DB sequence in the platform layer; in-memory here."""

    def __init__(self, start: int = 1):
        self._next = start

    def mint(self, class_code: str) -> str:
        code = format_nmc(class_code, self._next)
        self._next += 1
        return code


_SOURCE_RANK = {"char": 0, "text": 1, "llm": 2}


def golden_record(members: list[RecordAttributes], cfg: Config, approved_less_specific: bool = False) -> dict:
    """Survivorship: char > text > llm, then frequency, then completeness (FR-NMC-01).

    Within a value hierarchy the most specific recognised value wins (FR-NMC-06)."""
    from .extract import is_ancestor
    tmpl = cfg.classes[members[0].class_code]
    golden: dict[str, str | None] = {}
    conflicts: dict[str, list[str]] = {}
    completeness = {m.record_id: sum(a.value is not None for a in m.attributes.values()) for m in members}
    for p in tmpl.properties:
        vals = [(m.attributes[p["name"]], m.record_id) for m in members
                if p["name"] in m.attributes and m.attributes[p["name"]].value is not None]
        if not vals:
            golden[p["name"]] = None
            continue
        freq = Counter(a.value for a, _ in vals)
        best = min(vals, key=lambda v: (_SOURCE_RANK[v[0].source], -freq[v[0].value], -completeness[v[1]]))[0].value
        if p.get("hierarchy"):
            for v in freq:
                if is_ancestor(cfg, p["hierarchy"], best, v):
                    best = v                                  # more specific value wins
        golden[p["name"]] = best
        if len(freq) > 1 and not p.get("critical"):
            conflicts[p["name"]] = sorted(freq)
    return {"attributes": golden, "conflicts": conflicts}


def render_texts(class_code: str, golden: dict, cfg: Config) -> tuple[str, str]:
    tmpl = cfg.classes[class_code]
    vals = {k: (v if v is not None else "—") for k, v in golden["attributes"].items()}
    vals.setdefault("raw", "")
    short = re.sub(r"\s+", " ", tmpl.short_text_template.format_map(_Default(vals))).strip()
    long = tmpl.long_text_template.format_map(_Default(vals))
    long = re.sub(r";\s*[A-Z ]+ —", "", long)                 # drop properties with no value
    if len(short) > 40:
        short = short[:39] + "…"                               # truncated and flagged by the ellipsis
    return short, long


class _Default(dict):
    def __missing__(self, key):
        return "—"
