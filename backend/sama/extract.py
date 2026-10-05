"""Attribute extraction with match spans, sanity flags, size resolution and classified
residuals (FR-EXT, Architecture §7.3).

Each extractor returns candidate matches over the normalized text. Spans include prefix and
unit tokens (`NPS 2`, `ASTM A105`, `M16 X 100`) so those never become residuals. A value that
is read but not recognised is kept as `raw_value` with `value=None`, so compare treats it as
missing and it can never produce a conflict (Locked Decision 5).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Callable

from .classify import ClassResult
from .config import Config
from .contracts import Attribute, NormRecord, RawRecord, RecordAttributes, Residuals, SanityFlag

FRAC = r"\d+-\d+/\d+|\d+/\d+|\d+"           # longest alternative first: 1-1/2, 1/2, 2


@dataclass
class Hit:
    value: str | None          # canonical value, None when not recognised
    raw: str                   # text as matched
    start: int                 # char span in norm_text
    end: int
    rule_id: str
    sanity: str | None = None  # not_allowed | out_of_range


# ---------------------------------------------------------------- extractors
def _x_size_nps(text: str, cfg: Config) -> list[Hit]:
    known = set(cfg["units"]["nps_dn"])
    hits = []
    for rid, rx in (("X-SIZE-01", rf"\bNPS ({FRAC})\b"), ("X-SIZE-02", rf"(?<![\w/-])({FRAC}) IN\b")):
        for m in re.finditer(rx, text):
            v = m.group(1)
            hits.append(Hit(v if v in known else None, v, m.start(), m.end(), rid,
                            None if v in known else "out_of_range"))
    return hits


def _x_pressure_class(text: str, cfg: Config) -> list[Hit]:
    known = set(cfg["units"]["pressure_class_aliases"]) | {"CL900", "CL1500", "CL2500"}
    return [Hit(m.group(0) if m.group(0) in known else None, m.group(0), m.start(), m.end(), "X-PC-01",
                None if m.group(0) in known else "not_allowed")
            for m in re.finditer(r"\bCL\d+\b", text)]


_FACES = {"RF": "RF", "FF": "FF", "RTJ": "RTJ", "RAISED FACE": "RF", "FLAT FACE": "FF", "RING JOINT": "RTJ"}


def _x_face(text: str, cfg: Config) -> list[Hit]:
    rx = r"\b(RAISED FACE|FLAT FACE|RING JOINT|RTJ|RF|FF)\b"
    return [Hit(_FACES[m.group(1)], m.group(1), m.start(), m.end(), "X-FACE-01") for m in re.finditer(rx, text)]


def _x_end_connection(text: str, cfg: Config) -> list[Hit]:
    rx = r"\b(FLANGED|BUTTWELD|SOCKETWELD|THREADED)(?: ENDS?)?\b"
    return [Hit(m.group(1), m.group(0), m.start(), m.end(), "X-END-01") for m in re.finditer(rx, text)]


def _x_schedule(text: str, cfg: Config) -> list[Hit]:
    canon = set(cfg["units"]["schedule_spelling"])
    hits = []
    for m in re.finditer(r"\b(SCH\d+S?|STD|XXS|XS|\d0S)\b", text):
        v = m.group(1)
        # An unlisted designation (e.g. SCH160) is still a designation: the size table decides
        # its meaning, and with no entry it compares as missing. No sanity flag.
        hits.append(Hit(v, v, m.start(), m.end(), "X-SCH-01" if v in canon else "X-SCH-02"))
    return hits


@lru_cache(maxsize=8)
def _material_gazetteer(cfg: Config) -> list[tuple[str, re.Pattern]]:
    """Regex per recognised material value, built from hierarchies.yaml only."""
    entries: list[tuple[str, re.Pattern]] = []
    for family, leaves in cfg["hierarchies"]["material"].items():
        entries.append((family, re.compile(rf"\b{re.escape(family)}\b")))
        for leaf in leaves:
            m = re.fullmatch(r"ASTM (A\d+)(?: (GR )?(\S+))?", leaf)
            if m:
                spec, _, grade = m.groups()
                body = rf"(?:ASTM )?{spec}" + (rf" (?:GR )?{re.escape(grade)}" if grade else "")
                entries.append((leaf, re.compile(rf"\b{body}\b")))
                continue
            s = re.fullmatch(r"SS(\d+L?)", leaf)
            if s:
                entries.append((leaf, re.compile(rf"\b(?:SS ?|STAINLESS STEEL ){s.group(1)}\b")))
                continue
            entries.append((leaf, re.compile(rf"\b{re.escape(leaf)}\b")))
    # most specific (longest pattern) first, so ASTM A216 WCB wins over a bare family word
    entries.sort(key=lambda e: -len(e[1].pattern))
    return entries


_GRADE_LIKE = re.compile(r"\b(?:ASTM )?A\d{2,3}(?: (?:GR )?[A-Z0-9]{1,4}\b)?|\bSS ?\d{3}[A-Z]?\b|\bDUPLEX\b|\bMONEL\b|\bINCONEL\b")


def _x_material(text: str, cfg: Config) -> list[Hit]:
    hits: list[Hit] = []
    taken: list[tuple[int, int]] = []
    for value, rx in _material_gazetteer(cfg):
        for m in rx.finditer(text):
            if any(m.start() < e and s < m.end() for s, e in taken):
                continue
            taken.append(m.span())
            hits.append(Hit(value, m.group(0), m.start(), m.end(), "X-MAT-01"))
    for m in _GRADE_LIKE.finditer(text):                     # grade-shaped but not in the table
        if not any(m.start() < e and s < m.end() for s, e in taken):
            hits.append(Hit(None, m.group(0), m.start(), m.end(), "X-MAT-02", "not_allowed"))
    return hits


def _x_standard(text: str, cfg: Config) -> list[Hit]:
    rx = r"\b(API \d{3}[A-Z]?|ASME B\d+\.\d+M?|NACE MR0175|BS \d{3,4}|IS \d{3,5}|ISO \d{3,5})\b"
    return [Hit(m.group(1), m.group(1), m.start(), m.end(), "X-STD-01") for m in re.finditer(rx, text)]


_ENDS = {"PE": "PE", "BE": "BE", "TE": "TE", "PLAIN END": "PE", "PLAIN ENDS": "PE", "BEVELLED END": "BE",
         "BEVELLED ENDS": "BE", "BEVELED ENDS": "BE", "BEVELED END": "BE", "THREADED END": "TE", "THREADED ENDS": "TE"}


def _x_pipe_ends(text: str, cfg: Config) -> list[Hit]:
    rx = r"\b(PLAIN ENDS?|BEVELL?ED ENDS?|THREADED ENDS?|PE|BE|TE)\b"
    return [Hit(_ENDS.get(m.group(1), m.group(1)), m.group(1), m.start(), m.end(), "X-ENDS-01")
            for m in re.finditer(rx, text)]


def _x_thread_size(text: str, cfg: Config) -> list[Hit]:
    return [Hit(m.group(0), m.group(0), m.start(), m.end(), "X-THR-01") for m in re.finditer(r"\bM\d{1,2}\b", text)]


def _x_length_mm(text: str, cfg: Config) -> list[Hit]:
    hits = []
    rx = r"\bX ?(\d{2,4})(?: ?MM)?\b|\b(?:L|LG|LENGTH) (\d{2,4})(?: ?MM)?\b|\b(\d{2,4}) ?MM (?:LONG|LG)\b"
    for m in re.finditer(rx, text):
        v = next(g for g in m.groups() if g)
        ok = 10 <= int(v) <= 1000
        hits.append(Hit(v if ok else None, m.group(0), m.start(), m.end(), "X-LEN-01", None if ok else "out_of_range"))
    return hits


def _x_property_class(text: str, cfg: Config) -> list[Hit]:
    rx = r"\b(?:(?:GR|PC|CLASS|PROPERTY CLASS) )?(\d{1,2}\.\d)\b"
    return [Hit(m.group(1), m.group(0), m.start(), m.end(), "X-PCL-01") for m in re.finditer(rx, text)]


EXTRACTORS: dict[str, Callable[[str, Config], list[Hit]]] = {
    "size_nps": _x_size_nps, "pressure_class": _x_pressure_class, "face": _x_face,
    "end_connection": _x_end_connection, "schedule": _x_schedule, "material_grade": _x_material,
    "standard": _x_standard, "pipe_ends": _x_pipe_ends, "thread_size": _x_thread_size,
    "length_mm": _x_length_mm, "property_class": _x_property_class,
}


# ---------------------------------------------------------------- helpers
def _char_to_token_span(text: str, start: int, end: int) -> tuple[int, int]:
    first = text[:start].count(" ")
    last = text[:end].rstrip().count(" ")
    return first, last + 1


def is_ancestor(cfg: Config, hierarchy: str, anc: str, desc: str) -> bool:
    tree: dict[str, list[str]] = cfg["hierarchies"].get(hierarchy, {})
    stack = list(tree.get(anc, []))
    while stack:
        v = stack.pop()
        if v == desc:
            return True
        stack.extend(tree.get(v, []))
    return False


def _recognised_in_hierarchy(cfg: Config, hierarchy: str, value: str) -> bool:
    tree = cfg["hierarchies"].get(hierarchy, {})
    return value in tree or any(value in leaves for leaves in tree.values())


@lru_cache(maxsize=8)
def _risk_patterns(cfg: Config) -> list[tuple[str, re.Pattern]]:
    words = sorted(cfg["risk_words"]["words"], key=len, reverse=True)
    return [(w, re.compile(rf"(?<![A-Z0-9]){re.escape(w)}(?![A-Z0-9])")) for w in words]


def resolve_size(cfg: Config, nps: str | None, designation: str | None) -> float | None:
    if not nps or not designation:
        return None
    row = cfg["schedules"]["entries"].get(nps) or {}
    v = row.get(designation)
    return float(v) if v is not None else None


def normalize_mpn(mpn: str) -> str:
    """Uppercase and drop spaces, hyphens, dots and slashes. Suffixes are never truncated."""
    return re.sub(r"[\s\-./]", "", (mpn or "").upper())


def normalize_mfr(mfr: str, cfg: Config) -> str:
    m = re.sub(r"\s+", " ", (mfr or "").strip().upper())
    for canon, aliases in (cfg["manufacturers"].get("aliases") or {}).items():
        if m == canon or m in {a.upper() for a in aliases}:
            return canon
    return m


# ---------------------------------------------------------------- main entry
def extract(raw: RawRecord, norm: NormRecord, cls: ClassResult, cfg: Config) -> RecordAttributes:
    text = norm.norm_text
    tokens = norm.tokens
    consumed: set[int] = set()
    attrs: dict[str, Attribute] = {}
    flags: list[SanityFlag] = []
    tables_used = {"abbreviations", "units"}

    tmpl = cfg.classes.get(cls.class_code)
    if tmpl and not cls.abstained:
        # head pattern span: re-find on pass-2 text (pass 2 never touches head words)
        for p in tmpl.head_patterns:
            m = re.search(p, text)
            if m:
                s, e = _char_to_token_span(text, *m.span())
                consumed.update(range(s, e))
                break
        chars = {k.lower(): v for k, v in (raw.characteristics or {}).items()}
        for prop in tmpl.properties:
            name = prop["name"]
            fn = EXTRACTORS[prop["extractor"]]
            hits = fn(text, cfg)
            for h in hits:
                s, e = _char_to_token_span(text, h.start, h.end)
                consumed.update(range(s, e))
            # allowed-set / hierarchy recognition
            for h in hits:
                if h.value is None:
                    continue
                if "allowed" in prop and h.value not in prop["allowed"]:
                    h.sanity, h.value = "not_allowed", None
                elif prop.get("hierarchy") and not _recognised_in_hierarchy(cfg, prop["hierarchy"], h.value):
                    h.sanity, h.value = "not_allowed", None
            recognised = [h for h in hits if h.value is not None]
            for h in hits:
                if h.sanity:
                    flags.append(SanityFlag(type=h.sanity, prop=name, detail=h.raw))
            distinct = sorted({h.value for h in recognised})
            if prop.get("hierarchy") and len(distinct) > 1:
                # "CARBON STEEL A216 WCB": a family plus its own member is one value, the specific one
                leaves = [v for v in distinct if not any(is_ancestor(cfg, prop["hierarchy"], v, o)
                                                         for o in distinct if o != v)]
                if len(leaves) == 1 and all(v == leaves[0] or is_ancestor(cfg, prop["hierarchy"], v, leaves[0])
                                            for v in distinct):
                    distinct = leaves
            attr: Attribute | None = None
            if len(distinct) > 1:
                flags.append(SanityFlag(type="multi_value", prop=name, detail=" / ".join(distinct)))
                attr = Attribute(value=None, raw_value=" / ".join(distinct), rule_id="SAN-MULTI", confidence=0.0)
            elif distinct:
                h = next(h for h in recognised if h.value == distinct[0])
                attr = Attribute(value=h.value, raw_value=h.raw, rule_id=h.rule_id, source="text",
                                 span=_char_to_token_span(text, h.start, h.end))
            elif hits:
                h = hits[0]
                attr = Attribute(value=None, raw_value=h.raw, rule_id=h.rule_id, confidence=0.0,
                                 span=_char_to_token_span(text, h.start, h.end))
            # characteristics take precedence over text (FR-EXT-02)
            cv = chars.get(name)
            if cv:
                c_norm = re.sub(r"\s+", " ", str(cv).upper().strip())
                c_hits = [h for h in fn(c_norm, cfg) if h.value is not None] or None
                c_val = c_hits[0].value if c_hits else c_norm
                if attr and attr.value and attr.value != c_val:
                    flags.append(SanityFlag(type="internal_conflict", prop=name,
                                            detail=f"text {attr.value} vs characteristic {c_val}"))
                attr = Attribute(value=c_val, raw_value=str(cv), rule_id="X-CHAR-01", source="char",
                                 span=attr.span if attr else None)
            if attr is not None:
                attrs[name] = attr
            if prop.get("hierarchy"):
                tables_used.add("hierarchies")
        # size-dependent designations (FR-NORM-05)
        for prop in tmpl.properties:
            if prop.get("resolver") and prop["name"] in attrs:
                a = attrs[prop["name"]]
                nps = attrs.get("size_nps").value if attrs.get("size_nps") else None
                attrs[prop["name"]] = a.model_copy(update={"designation": a.value,
                                                           "resolved": resolve_size(cfg, nps, a.value)})
                tables_used.add("schedules")

    # residuals (FR-EXT-05): risk words are scanned on the WHOLE record, inside spans too
    residuals = Residuals()
    risk_tokens: set[int] = set()
    for word, rx in _risk_patterns(cfg):
        for m in rx.finditer(text):
            if word not in residuals.risk:
                residuals.risk.append(word)
            s, e = _char_to_token_span(text, *m.span())
            risk_tokens.update(range(s, e))
    tables_used.add("risk_words")
    for ref in cfg["residual_vocab"]["reference_patterns"]:
        for m in re.finditer(ref["pattern"], text):
            s, e = _char_to_token_span(text, *m.span())
            if s in consumed or s in risk_tokens:
                continue
            residuals.reference.append(m.group(0))
            consumed.update(range(s, e))
    ignorable = set(cfg["residual_vocab"]["ignorable"])
    for i, tok in enumerate(tokens):
        if i in consumed or i in risk_tokens or not re.search(r"[A-Z0-9]", tok):
            continue
        (residuals.ignorable if tok in ignorable else residuals.unknown).append(tok)
    tables_used.add("residual_vocab")

    mfr = normalize_mfr(raw.mfr, cfg)
    if raw.mfr:
        tables_used.add("manufacturers")
    return RecordAttributes(
        record_id=raw.record_id, class_code=cls.class_code, class_confidence=cls.confidence,
        abstained=cls.abstained, attributes=attrs, mfr_norm=mfr, mpn_norm=normalize_mpn(raw.mpn),
        residuals=residuals, sanity_flags=flags, tables_used=sorted(tables_used))


def parse_characteristics(value: str | dict | None) -> dict[str, str]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        return {str(k): str(v) for k, v in json.loads(value).items()}
    except (ValueError, AttributeError):
        return {}
