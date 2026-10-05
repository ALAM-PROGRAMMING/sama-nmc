"""Plain-Python text similarity shared by the Python reference and the browser engine.

`token_set_ratio` re-implements rapidfuzz's algorithm (default settings, no preprocessing) so the
TypeScript engine can carry the exact same definition. tests/unit/test_fuzzy.py proves it equals
rapidfuzz on tens of thousands of random pairs.
"""
from __future__ import annotations


def indel_distance(a: str, b: str) -> int:
    """Insertions + deletions needed to turn a into b (= len(a)+len(b)-2*LCS)."""
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = [0] * (len(b) + 1)
    for ca in a:
        cur = [0]
        for j, cb in enumerate(b, start=1):
            cur.append(prev[j - 1] + 1 if ca == cb else max(prev[j], cur[j - 1]))
        prev = cur
    return len(a) + len(b) - 2 * prev[-1]


def _norm_sim(dist: int, lensum: int) -> float:
    """Normalised Indel similarity on a 0..100 scale (100 when both strings are empty)."""
    if lensum == 0:
        return 100.0
    return (1.0 - dist / lensum) * 100.0


def ratio(a: str, b: str) -> float:
    return _norm_sim(indel_distance(a, b), len(a) + len(b))


def token_set_ratio(a: str, b: str) -> float:
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    inter = ta & tb
    diff_ab, diff_ba = ta - tb, tb - ta
    if inter and (not diff_ab or not diff_ba):
        return 100.0
    sect = " ".join(sorted(inter))
    ab = " ".join(sorted(diff_ab))
    ba = " ".join(sorted(diff_ba))
    if not sect:
        return ratio(ab, ba)                               # the sect-based candidates are 0
    c12, c21 = sect + " " + ab, sect + " " + ba
    sect_len = len(sect)
    return max(_norm_sim(len(c12) - sect_len, sect_len + len(c12)),      # ratio(sect, c12)
               _norm_sim(len(c21) - sect_len, sect_len + len(c21)),      # ratio(sect, c21)
               ratio(c12, c21))
