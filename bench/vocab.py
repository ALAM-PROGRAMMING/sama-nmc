"""Read-only access to the config vocabulary the generator is allowed to use.

The benchmark never invents engineering reference data: every material, size,
pressure class, schedule, face, end connection and property class it emits must be
found here (config/*.yaml, config/classes/*.yaml). `validate_grids` enforces this
for bench/grids/grids.yaml.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = REPO_ROOT / "config"
GRIDS_PATH = Path(__file__).resolve().parent / "grids" / "grids.yaml"

CLASS_CODES = ("1101", "1102", "1103", "1104", "1201", "1202", "1203",
               "1301", "1302", "1401", "1402", "1403")
VALVES = ("1101", "1102", "1103", "1104")
FLANGES = ("1201", "1202", "1203")
PIPES = ("1301", "1302")
FASTENERS = ("1401", "1402", "1403")


def family_of_class(class_code: str) -> str:
    if class_code in VALVES:
        return "valve"
    if class_code in FLANGES:
        return "flange"
    if class_code in PIPES:
        return "pipe"
    return "fastener"


def _load(path: Path) -> Any:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


@dataclass(frozen=True)
class Vocab:
    material_hierarchy: dict[str, list[str]]
    grade_to_family: dict[str, str]
    nps_dn: dict[str, int]
    pressure_class_aliases: dict[str, list[str]]
    schedule_spelling: dict[str, list[str]]
    schedules: dict[str, dict[str, float]]
    uom_synonyms: dict[str, str]
    risk_words: list[str]
    mfr_aliases: dict[str, list[str]]
    ignorable: list[str]
    abbreviations: list[tuple[str, str, str]]      # (rule id, abbreviation, full form)
    classes: dict[str, dict[str, Any]] = field(default_factory=dict)

    def critical_props(self, class_code: str) -> list[str]:
        return [p["name"] for p in self.classes[class_code]["properties"] if p.get("critical")]

    def props(self, class_code: str) -> list[str]:
        return [p["name"] for p in self.classes[class_code]["properties"]]

    def allowed(self, class_code: str, prop: str) -> list[str] | None:
        for p in self.classes[class_code]["properties"]:
            if p["name"] == prop:
                return p.get("allowed")
        return None

    def tier(self, class_code: str) -> str:
        return self.classes[class_code]["tier_default"]

    def wall_mm(self, nps: str, designation: str) -> float | None:
        return self.schedules.get(nps, {}).get(designation)


_ABBR_TOKEN = re.compile(r"^\\b(?P<tok>[A-Z]+)(?:\\\.\?)?\\b$")


def _parse_abbreviations(doc: dict) -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []
    rules = list(doc.get("global", []))
    for lst in (doc.get("by_class") or {}).values():
        rules.extend(lst)
    for r in rules:
        m = _ABBR_TOKEN.match(str(r["pattern"]))
        if not m:
            continue
        tok, full = m.group("tok"), str(r["replace"])
        if tok == full:
            continue
        out.append((str(r["id"]), tok, full))
    return out


@lru_cache(maxsize=1)
def load_vocab() -> Vocab:
    hier = _load(CONFIG_DIR / "hierarchies.yaml")["material"]
    units = _load(CONFIG_DIR / "units.yaml")
    sched = _load(CONFIG_DIR / "schedules.yaml")["entries"]
    classes = {}
    for code in CLASS_CODES:
        classes[code] = _load(CONFIG_DIR / "classes" / f"{code}.yaml")
    g2f = {g: fam for fam, grades in hier.items() for g in grades}
    return Vocab(
        material_hierarchy={k: list(v) for k, v in hier.items()},
        grade_to_family=g2f,
        nps_dn={str(k): int(v) for k, v in units["nps_dn"].items()},
        pressure_class_aliases={k: list(v) for k, v in units["pressure_class_aliases"].items()},
        schedule_spelling={str(k): list(v) for k, v in units["schedule_spelling"].items()},
        schedules={str(k): {str(d): float(w) for d, w in v.items()} for k, v in sched.items()},
        uom_synonyms={str(k): str(v) for k, v in units["uom_synonyms"].items()},
        risk_words=list(_load(CONFIG_DIR / "risk_words.yaml")["words"]),
        mfr_aliases={k: list(v) for k, v in _load(CONFIG_DIR / "manufacturers.yaml")["aliases"].items()},
        ignorable=list(_load(CONFIG_DIR / "residual_vocab.yaml")["ignorable"]),
        abbreviations=_parse_abbreviations(_load(CONFIG_DIR / "abbreviations.yaml")),
        classes=classes,
    )


@lru_cache(maxsize=1)
def load_grids() -> dict:
    grids = _load(GRIDS_PATH)
    validate_grids(grids, load_vocab())
    return grids


def validate_grids(grids: dict, v: Vocab) -> None:
    """Raise ValueError if any grid value is not present in config."""
    errors: list[str] = []
    all_grades = set(v.grade_to_family)
    for code, g in grids["classes"].items():
        if code not in v.classes:
            errors.append(f"{code}: class not in config/classes")
            continue
        props = set(v.props(code))
        for key, values in g.items():
            if key not in props:
                errors.append(f"{code}: property {key!r} not in class template")
                continue
            if key == "size_nps":
                bad = [s for s in values if s not in v.nps_dn]
            elif key == "pressure_class":
                bad = [c for c in values if c not in v.pressure_class_aliases]
            elif key in ("material", "body_material"):
                bad = [m for m in values if m not in all_grades]
            elif key in ("wall", "bore_wall"):
                bad = []
                for fam, desigs in values.items():
                    if fam not in v.material_hierarchy:
                        bad.append(fam)
                    for d in desigs:
                        if d not in v.schedule_spelling:
                            bad.append(d)
                        for nps in g.get("size_nps", []):
                            if v.wall_mm(nps, d) is None:
                                bad.append(f"{d}@NPS{nps} (not in schedules.yaml)")
            elif key in ("face", "end_connection", "ends", "property_class"):
                allowed = v.allowed(code, key) or v.allowed("1402", key) or []
                bad = [x for x in values if str(x) not in [str(a) for a in allowed]]
            else:
                bad = []   # thread_size / length_mm: draft fastener grid, documented as mild
            if bad:
                errors.append(f"{code}.{key}: values not in config: {bad}")
    if errors:
        raise ValueError("bench/grids/grids.yaml uses vocabulary outside config:\n  " + "\n  ".join(errors))
