"""Noise operators for the synthetic benchmark (Architecture §10, step 4).

Every operator has a stable ID and a rate. Record-level operators act on the
`Chunk` list produced by bench.styles (or on `_opts` before rendering) and never
alter the digits of a critical value. Material-level operators (N-RISKWORD,
N-MPN-SUFFIX) create a NEW true_material_id and are applied by bench.generate.

Rates are DRAFTS. Architecture §10 says N-FILLER rates must come from the Day-1
real-text study; replace FILLER rates once bench/real_study.py has run.
"""
from __future__ import annotations

import random
import re

from bench.styles import Chunk, INCH_FORMS, METRIC_FORMS, SPECS, UNSEEN_FACE_FOLD, UNSEEN_HEADS
from bench.vocab import load_vocab

# ---------------------------------------------------------------- rates (draft)
RECORD_OPS: dict[str, float] = {
    "N-DOWNGRADE": 0.12,    # grade -> family (same true_material_id; pair_type downgrade)
    "N-DESIG": 0.50,        # of eligible records only (NPS 2, STD/SCH40)
    "N-UNIT": 0.15,         # inch <-> metric size spelling
    "N-MISSING": 0.08,      # drop one critical attribute from the text
    "N-ABBR": 0.15,         # contract/expand one config abbreviation
    "N-REORDER": 0.15,      # swap two attribute groups
    "N-FILLER": 0.15,       # ignorable words / reference tokens (draft; Day-1 study sets this)
    "N-TYPO": 0.08,         # typo in a non-critical or filler token
    "N-UOM": 0.06,          # UoM synonym or mismatched UoM
    "N-WRONG-MATKL": 0.03,  # material group of another class family
}
MATERIAL_OPS: dict[str, float] = {
    "N-RISKWORD": 0.04,     # of materials: one extra record with NACE / FIRE SAFE -> new id
    "N-MPN-SUFFIX": 0.30,   # of MPN-bearing valve materials: base MPN + suffix -> new id
}
UNSEEN_OPS: dict[str, float] = {
    "N-FIELDSWAP": 0.35,    # attribute moved from text into characteristics JSON
    "N-FILLER2": 0.30,      # new filler vocabulary
    "N-ABBR2": 0.35,        # new abbreviation set
}
ALL_OP_IDS = tuple(RECORD_OPS) + tuple(MATERIAL_OPS) + tuple(UNSEEN_OPS)

# Filler vocabulary. Ignorable words are from config/residual_vocab.yaml; reference
# tokens match its RF-01/RF-02 patterns. Identifiers are fictional.
FILLER_PREFIX = ("SUPPLY OF", "NEW")
FILLER_SUFFIX = ("AS PER SPEC", "SPARE", "AS PER SPECIFICATION")
REFERENCE_TOKENS = ("DRG NO 4471-A", "TAG NO PV-102", "DWG NO 2208-C", "TAG NO XV-215")
# Unseen-noise filler (held out; deliberately NOT in residual_vocab.yaml).
FILLER2 = ("FOR PLANT USE", "REF ENQ 22/31", "REF ENQ 23/07", "FOR PLANT USE ONLY")

RISK_WORDS_BY_FAMILY = {"valve": ("NACE", "FIRE SAFE"), "flange": ("NACE",), "pipe": ("NACE",),
                        "fastener": ("NACE",)}
MPN_SUFFIXES = ("-NACE", "-X", "-A", "-B")


def _check_risk_words() -> None:
    words = set(load_vocab().risk_words)
    for ws in RISK_WORDS_BY_FAMILY.values():
        for w in ws:
            assert w in words, f"risk word {w} not in config/risk_words.yaml"


# ---------------------------------------------------------------- pre-render ops
def op_unit(style: str, rng: random.Random) -> str:
    """N-UNIT: switch the size spelling to the other unit system."""
    form = SPECS[style].size_form
    pool = METRIC_FORMS if form in INCH_FORMS or form == "INCH" else INCH_FORMS
    return rng.choice(pool)


def designation_swap(nps: str | None, designation: str | None, swaps: list[dict]) -> str | None:
    """N-DESIG: equivalent designation at a size where the table says they are equal."""
    if nps is None or designation is None:
        return None
    v = load_vocab()
    for s in swaps:
        if s["at_size"] == nps and designation in s["swap"]:
            other = [d for d in s["swap"] if d != designation][0]
            if v.wall_mm(nps, other) == v.wall_mm(nps, designation):   # table must agree
                return other
    return None


# ---------------------------------------------------------------- chunk ops
def _groups(chunks: list[Chunk]) -> list[list[Chunk]]:
    groups: list[list[Chunk]] = []
    for c in chunks:
        if c.glue and groups:
            groups[-1].append(c)
        else:
            groups.append([c])
    return groups


def op_reorder(chunks: list[Chunk], rng: random.Random) -> bool:
    """N-REORDER: swap two attribute groups (the head stays first)."""
    groups = _groups(chunks)
    idx = [i for i, g in enumerate(groups) if g[0].prop != "head"]
    if len(idx) < 2:
        return False
    a, b = rng.sample(idx, 2)
    groups[a], groups[b] = groups[b], groups[a]
    chunks[:] = [c for g in groups for c in g]
    return True


def op_missing(chunks: list[Chunk], rng: random.Random) -> str | None:
    """N-MISSING: drop one critical attribute. Returns the dropped property."""
    idx = [i for i, c in enumerate(chunks) if c.critical]
    if not idx:
        return None
    i = rng.choice(idx)
    dropped = chunks.pop(i)
    if i < len(chunks) and chunks[i].glue:
        chunks[i].glue = False
    return dropped.prop


def _abbr_pairs() -> list[tuple[str, str]]:
    return [(abbr, full) for _rid, abbr, full in load_vocab().abbreviations]


def _match_case(src: str, repl: str) -> str:
    if src.isupper() or (" " not in repl and len(repl) <= 4):   # abbreviations stay upper
        return repl.upper()
    if src[:1].isupper():
        return repl.title()
    return repl.lower()


def op_abbr(chunks: list[Chunk], rng: random.Random) -> bool:
    """N-ABBR: contract or expand ONE config abbreviation (abbreviations.yaml) in the text.

    Grade-level material chunks are left alone, so a grade is never rewritten.
    """
    cands: list[tuple[int, str, str]] = []
    for i, c in enumerate(chunks):
        if c.prop in ("ref", "risk"):
            continue
        for abbr, full in _abbr_pairs():
            if re.search(rf"\b{re.escape(full)}\b", c.text, flags=re.I):
                cands.append((i, full, abbr))
            if re.search(rf"\b{re.escape(abbr)}\b", c.text, flags=re.I):
                cands.append((i, abbr, full))
    if not cands:
        return False
    i, src, dst = rng.choice(cands)
    c = chunks[i]
    c.text = re.sub(rf"\b{re.escape(src)}\b", lambda m: _match_case(m.group(0), dst), c.text,
                    count=1, flags=re.I)
    return True


def op_filler(chunks: list[Chunk], rng: random.Random, title: bool) -> list[str]:
    """N-FILLER: inject ignorable words and/or a reference token. Returns injected texts."""
    added: list[str] = []
    r = rng.random()
    if r < 0.35:
        t = rng.choice(FILLER_PREFIX)
        chunks.insert(1 if title else 0, Chunk("filler", t.title() if title else t, False, plain=t))
        added.append(t)
    elif r < 0.65:
        t = rng.choice(FILLER_SUFFIX)
        chunks.append(Chunk("filler", t.title() if title else t, False, plain=t))
        added.append(t)
    else:
        t = rng.choice(REFERENCE_TOKENS)
        chunks.append(Chunk("ref", t, False, plain=t))
        added.append(t)
    return added


def op_filler2(chunks: list[Chunk], rng: random.Random) -> str:
    """N-FILLER2 (unseen): new filler vocabulary, never seen in train/calibration."""
    t = rng.choice(FILLER2)
    if rng.random() < 0.5:
        chunks.append(Chunk("filler", t, False, plain=t))
    else:
        chunks.insert(1, Chunk("filler", t, False, plain=t))
    return t


def _typo(word: str, rng: random.Random) -> str:
    if len(word) >= 4 and rng.random() < 0.5:
        j = rng.randrange(1, len(word) - 2)
        return word[:j] + word[j + 1] + word[j] + word[j + 2:]
    j = rng.randrange(1, len(word) - 1)
    return word[:j] + word[j + 1:]


def op_typo(chunks: list[Chunk], rng: random.Random) -> bool:
    """N-TYPO: typo in a non-critical token or filler; never in a digit-bearing token,
    never in the head noun, never in a critical value (only ignorable words like END)."""
    ignorable = set(load_vocab().ignorable)
    cands: list[tuple[int, int]] = []
    for i, c in enumerate(chunks):
        if c.prop in ("head", "risk", "ref"):
            continue
        words = c.text.split(" ")
        for k, w in enumerate(words):
            if not w.isalpha() or len(w) < 3:
                continue
            if c.critical and w.upper() not in ignorable:
                continue
            cands.append((i, k))
    if not cands:
        return False
    i, k = rng.choice(cands)
    words = chunks[i].text.split(" ")
    new = _typo(words[k], rng)
    if new == words[k]:
        return False
    words[k] = new
    chunks[i].text = " ".join(words)
    return True


def op_abbr2(chunks: list[Chunk], class_code: str, face: str | None) -> bool:
    """N-ABBR2 (unseen): replace the head with the held-out abbreviation set (GT VLV, WNRF ...)."""
    if not chunks or chunks[0].prop != "head":
        return False
    if class_code in UNSEEN_FACE_FOLD and face == "RF":
        chunks[0].text = UNSEEN_FACE_FOLD[class_code]
        chunks[:] = [c for c in chunks if c.prop != "face"]
    else:
        chunks[0].text = UNSEEN_HEADS[class_code]
    return True


def op_fieldswap(chunks: list[Chunk], rng: random.Random) -> dict[str, str]:
    """N-FIELDSWAP (unseen): move 1-2 critical attributes out of the text into characteristics."""
    idx = [i for i, c in enumerate(chunks) if c.critical]
    if not idx:
        return {}
    k = 1 if len(idx) < 3 or rng.random() < 0.6 else 2
    pick = sorted(rng.sample(idx, k), reverse=True)
    moved: dict[str, str] = {}
    for i in pick:
        c = chunks.pop(i)
        if i < len(chunks) and chunks[i].glue:
            chunks[i].glue = False
        moved[c.prop] = c.plain
    return moved


# ---------------------------------------------------------------- UoM
def op_uom(meins: str, family: str, rng: random.Random) -> str:
    """N-UOM: a synonym of the same unit (units.yaml) or, 1 time in 3, a mismatched unit."""
    syn = load_vocab().uom_synonyms
    canon = syn.get(meins, meins)
    if rng.random() < 2 / 3:
        pool = sorted(k for k, v in syn.items() if v == canon and k != meins)
        if pool:
            return rng.choice(pool)
    mismatch = ("EA", "NOS") if family == "pipe" else ("SET", "KG")
    return rng.choice(mismatch)
