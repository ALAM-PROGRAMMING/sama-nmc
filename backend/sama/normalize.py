"""Deterministic, idempotent text normalization (FR-NORM, Architecture §7.2).

Pass 1 is class-independent; pass 2 applies class-specific rules after classification.
Every change is logged as a Transform with its rule id. Sizes are converted by table only.
"""
from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

from .config import Config
from .contracts import NormRecord, RawRecord, Transform

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_FRACTION_SLASH = re.compile(r"(?<!\d)/|/(?!\d)")          # a slash not inside 1/2
_SEPARATORS = re.compile(r"[,;:()\[\]]")
_DOT_NOT_DECIMAL = re.compile(r"(?<!\d)\.|\.(?!\d)")       # keep 8.8, B16.5
_GRADE_HYPHEN = re.compile(r"\b(A\d{2,3})-(?=[A-Z])")       # A216-WCB -> A216 WCB
_INCH = re.compile(r"(?<![\w/-])(\d+(?:-\d+/\d+)?|\d+/\d+)\s*(?:\"|''|INCHES\b|INCH\b|IN\b)")
_SPACES = re.compile(r"\s+")


def _step(text: str, new: str, rule_id: str, log: list[Transform]) -> str:
    if new != text:
        log.append(Transform(rule_id=rule_id, before=text, after=new))
    return new


@lru_cache(maxsize=8)
def _compiled_tables(cfg: Config):
    abbr = [(a["id"], re.compile(a["pattern"]), a["replace"]) for a in cfg["abbreviations"]["global"]]
    by_class = {k: [(a["id"], re.compile(a["pattern"]), a["replace"]) for a in v]
                for k, v in (cfg["abbreviations"].get("by_class") or {}).items()}

    def alias_rules(prefix: str, table: dict[str, list[str]]):
        pairs = [(alias, canon) for canon, aliases in table.items() for alias in aliases]
        pairs.sort(key=lambda p: -len(p[0]))                 # longest alias first
        return [(f"{prefix}-{canon}", re.compile(rf"(?<![A-Z0-9]){re.escape(alias)}(?![A-Z0-9])"), canon)
                for alias, canon in pairs if alias != canon]

    pclass = alias_rules("U-PC", cfg["units"]["pressure_class_aliases"])
    sched = alias_rules("U-SCH", cfg["units"]["schedule_spelling"])
    dn_to_nps = {str(dn): nps for nps, dn in cfg["units"]["nps_dn"].items()}
    return abbr, by_class, pclass, sched, dn_to_nps


def _dn_to_nps(text: str, dn_to_nps: dict[str, str], log: list[Transform]) -> str:
    def repl(m: re.Match) -> str:
        nps = dn_to_nps.get(m.group(1) or m.group(2))
        return f"NPS {nps}" if nps else m.group(0)          # unknown DN stays as written
    new = re.sub(r"\bDN\s?(\d+)\b|\b(\d+)\s?NB\b", repl, text)
    return _step(text, new, "U-DN", log)


def normalize_pass1(text: str, cfg: Config, log: list[Transform] | None = None) -> str:
    log = [] if log is None else log
    abbr, _, pclass, sched, dn_to_nps = _compiled_tables(cfg)
    t = text
    t = _step(t, _CONTROL.sub(" ", unicodedata.normalize("NFKC", t)).upper(), "N-001", log)
    t = _step(t, _GRADE_HYPHEN.sub(r"\1 ", t), "N-002", log)
    t = _step(t, _INCH.sub(r"\1 IN ", t), "U-003", log)     # before separators eat the quote marks
    t = _step(t, _SEPARATORS.sub(" ", _FRACTION_SLASH.sub(" ", t)), "N-003", log)
    t = _step(t, _DOT_NOT_DECIMAL.sub(" ", t), "N-004", log)
    t = _SPACES.sub(" ", t).strip()
    for rid, rx, rep in abbr:
        t = _step(t, rx.sub(rep, t), rid, log)
    for rid, rx, rep in pclass:
        t = _step(t, rx.sub(rep, t), rid, log)
    for rid, rx, rep in sched:
        t = _step(t, rx.sub(rep, t), rid, log)
    t = _dn_to_nps(t, dn_to_nps, log)
    t = _step(t, re.sub(r"\bNPS\s*(\d+(?:-\d+/\d+)?|\d+/\d+)\s+IN\b", r"NPS \1", t), "U-004", log)
    t = _step(t, re.sub(r"(?<=\d)#", "", t), "N-005", log)  # stray '#' after an unaliased number
    t = _step(t, re.sub(r"\b(M\d{1,2}) ?X ?(\d{2,4})\b", r"\1 X \2", t), "N-006", log)   # M16X100 -> M16 X 100
    return _SPACES.sub(" ", t).strip()


_PASS2_MM_CLASSES = ("11", "12", "13")                       # valves, flanges, pipe


def normalize_pass2(text: str, class_code: str, cfg: Config, log: list[Transform] | None = None) -> str:
    log = [] if log is None else log
    _, by_class, _, _, dn_to_nps = _compiled_tables(cfg)
    t = text
    for rid, rx, rep in by_class.get(class_code, by_class.get("default", [])):
        t = _step(t, rx.sub(rep, t), rid, log)
    if class_code[:2] in _PASS2_MM_CLASSES:
        def mm(m: re.Match) -> str:
            nps = dn_to_nps.get(m.group(1))
            return f"NPS {nps}" if nps else m.group(0)
        t = _step(t, re.sub(r"\b(\d+)\s?MM\b", mm, t), "U-MM", log)
    return _SPACES.sub(" ", t).strip()


def normalize_uom(meins: str, cfg: Config) -> str:
    u = (meins or "").strip().upper()
    return cfg["units"]["uom_synonyms"].get(u, u)


def normalize_record(raw: RawRecord, cfg: Config) -> NormRecord:
    log: list[Transform] = []
    text = raw.maktx if not raw.long_text else f"{raw.maktx} {raw.long_text}"
    t = normalize_pass1(text, cfg, log)
    return NormRecord(record_id=raw.record_id, norm_text=t, tokens=t.split(), uom_norm=normalize_uom(raw.meins, cfg),
                      transforms=log)


def apply_pass2(norm: NormRecord, class_code: str, cfg: Config) -> NormRecord:
    log = list(norm.transforms)
    t = normalize_pass2(norm.norm_text, class_code, cfg, log)
    return norm.model_copy(update={"norm_text": t, "tokens": t.split(), "transforms": log})
