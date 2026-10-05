"""CPSE house-style renderers (Architecture §10, step 2).

Each public renderer (CPSE_A ... CPSE_E, plus the held-out CPSE_F) takes a canonical
item dict and returns a description string, e.g.

    CPSE_A({"class_code": "1101", "size_nps": "2", "pressure_class": "CL150",
            "body_material": "ASTM A216 WCB", "end_connection": "FLANGED", "face": "RF"})
    -> "VALVE GATE 2IN 150# A216 WCB FLGD"

Internally every style renders to a list of `Chunk`s so the noise operators can act
on attribute boundaries (drop one attribute, reorder, inject filler) without ever
touching the digits of a critical value. An item may carry `_opts` to steer a render:
    size_form       one of IN, QUOTE, NPS, MM, DN, NB, INCH   (N-UNIT)
    material_level  "family"                                   (N-DOWNGRADE)
    designation     replacement wall designation               (N-DESIG)

All spellings come from config (units.yaml aliases and schedule_spelling,
abbreviations.yaml) except the held-out CPSE_F abbreviations, which are the
unseen-noise vocabulary and are deliberately NOT in config.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from bench.vocab import load_vocab

STYLE_IDS = ("CPSE_A", "CPSE_B", "CPSE_C", "CPSE_D", "CPSE_E")
HELD_OUT_STYLE = "CPSE_F"
MATERIAL_PROPS = ("body_material", "material")
WALL_PROPS = ("wall", "bore_wall")


@dataclass
class Chunk:
    prop: str            # "head", a class property name, "filler", "ref" or "risk"
    text: str
    critical: bool = False
    plain: str = ""      # value-only spelling, used when an attribute moves to characteristics
    glue: bool = False   # joined to the previous chunk with a space and moved with it


# ---------------------------------------------------------------- spellings
def size_text(nps: str, form: str) -> str:
    dn = load_vocab().nps_dn[nps]
    return {
        "IN": f"{nps}IN",
        "QUOTE": f'{nps}"',
        "NPS": f"NPS {nps}",
        "MM": f"{dn}MM",
        "DN": f"DN{dn}",
        "NB": f"{dn}NB",
        "INCH": f"{nps} INCH",      # CPSE_F only (unseen)
    }[form]


INCH_FORMS = ("IN", "QUOTE", "NPS")
METRIC_FORMS = ("MM", "DN", "NB")


def class_text(pc: str, form: str) -> str:
    n = pc[2:]
    return {
        "HASH": f"{n}#",
        "CL": f"CL{n}",
        "CLASS_TITLE": f"Class {n}",
        "LB": f"{n} LB",
        "CL_SP": f"CL {n}",
        "LB_NOSP": f"{n}LB",
    }[form]


def material_text(grade: str, form: str) -> str:
    stripped = grade[5:] if grade.startswith("ASTM ") else grade
    if form == "FULL":
        return grade
    if form == "STRIP":
        return stripped
    if form == "NOGR":                       # ASTM A106 GR B -> ASTM A106 B
        return grade.replace(" GR ", " ")
    if form == "HYPH":                       # A216-WCB, A350-LF2, A106 GR.B
        if " GR " in stripped:
            return stripped.replace(" GR ", " GR.")
        return "-".join(stripped.split(" "))
    raise KeyError(form)


FAMILY_TEXT = {
    "ABBR": {"CARBON STEEL": "CS", "STAINLESS STEEL": "SS", "ALLOY STEEL": "ALLOY STEEL"},
    "FULL": {"CARBON STEEL": "CARBON STEEL", "STAINLESS STEEL": "STAINLESS STEEL", "ALLOY STEEL": "ALLOY STEEL"},
    "TITLE": {"CARBON STEEL": "Carbon Steel", "STAINLESS STEEL": "Stainless Steel", "ALLOY STEEL": "Alloy Steel"},
}

END_TEXT = {
    "ABBR": {"FLANGED": "FLGD", "BUTTWELD": "BW", "SOCKETWELD": "SW", "THREADED": "THRD"},
    "WORD_END": {"FLANGED": "FLANGED END", "BUTTWELD": "BUTTWELD END", "SOCKETWELD": "SOCKETWELD END",
                 "THREADED": "THREADED END"},
    "TITLE": {"FLANGED": "Flanged", "BUTTWELD": "Buttweld", "SOCKETWELD": "Socketweld", "THREADED": "Threaded"},
    "FULL_ABBR": {"FLANGED": "FLANGED", "BUTTWELD": "BW", "SOCKETWELD": "SW", "THREADED": "THRD"},
    "FULL": {"FLANGED": "FLGD", "BUTTWELD": "BUTTWELD", "SOCKETWELD": "SOCKETWELD", "THREADED": "THREADED"},
    # CPSE_F (unseen abbreviation set)
    "UNSEEN": {"FLANGED": "FLGE", "BUTTWELD": "B/W", "SOCKETWELD": "S/W", "THREADED": "SCRD"},
}

# Schedule spellings: every value is listed in units.yaml schedule_spelling.
SCHED_TEXT = {
    "A": {"SCH40": "SCH40", "SCH80": "SCH80", "STD": "STD", "XS": "XS", "40S": "40S", "80S": "80S"},
    "B": {"SCH40": "S40", "SCH80": "S80", "STD": "STD", "XS": "XS", "40S": "SCH40S", "80S": "SCH80S"},
    "C": {"SCH40": "SCH 40", "SCH80": "SCH 80", "STD": "STD", "XS": "XS", "40S": "SCH 40S", "80S": "SCH 80S"},
    "D": {"SCH40": "SCH-40", "SCH80": "SCH-80", "STD": "STD", "XS": "XH", "40S": "40S", "80S": "80S"},
    "E": {"SCH40": "SCH40", "SCH80": "SCH80", "STD": "STD", "XS": "EXTRA STRONG", "40S": "SCH40S", "80S": "SCH80S"},
}

PROPCLASS_TEXT: dict[str, Callable[[str], str]] = {
    "A": lambda p: f"GR {p}",
    "B": lambda p: p,
    "C": lambda p: f"Property Class {p}",
    "D": lambda p: f"PC {p}",
    "E": lambda p: f"GR {p}",
    "F": lambda p: f"PC{p}",
}

LENGTH_TEXT: dict[str, Callable[[int], str]] = {
    "A": lambda n: f"X {n}MM",
    "B": lambda n: f"X{n}MM",
    "C": lambda n: f"x {n} mm",
    "D": lambda n: f"X {n} MM",
    "E": lambda n: f"X {n}MM",
    "F": lambda n: f"X{n}",
}

# Heads per style. Abbreviations used here (VLV, FLG, WN, SO, SMLS, NRV) are in
# config/abbreviations.yaml; CPSE_F uses the unseen set.
HEADS = {
    "A": {"1101": "VALVE GATE", "1102": "VALVE GLOBE", "1103": "VALVE BALL", "1104": "VALVE CHECK",
          "1201": "FLANGE WN", "1202": "FLANGE SO", "1203": "FLANGE BLIND",
          "1301": "PIPE SMLS", "1302": "PIPE ERW",
          "1401": "STUD BOLT", "1402": "HEX BOLT", "1403": "HEX NUT"},
    "B": {"1101": "GATE VLV", "1102": "GLOBE VLV", "1103": "BALL VLV", "1104": "CHECK VLV",
          "1201": "WN FLG", "1202": "SO FLG", "1203": "BLIND FLG",
          "1301": "SMLS PIPE", "1302": "ERW PIPE",
          "1401": "BOLT STUD", "1402": "BOLT HEX", "1403": "NUT HEX"},
    "C": {"1101": "Valve, Gate", "1102": "Valve, Globe", "1103": "Valve, Ball", "1104": "Valve, Check",
          "1201": "Flange, Weld Neck", "1202": "Flange, Slip On", "1203": "Flange, Blind",
          "1301": "Pipe, Seamless", "1302": "Pipe, ERW",
          "1401": "Bolt, Stud", "1402": "Bolt, Hex", "1403": "Nut, Hex"},
    "D": {"1101": "GATE VALVE", "1102": "GLOBE VALVE", "1103": "BALL VALVE", "1104": "CHECK VALVE",
          "1201": "WELD NECK FLANGE", "1202": "SLIP ON FLANGE", "1203": "BLIND FLANGE",
          "1301": "SEAMLESS PIPE", "1302": "ERW PIPE",
          "1401": "STUD BOLT", "1402": "HEX BOLT", "1403": "HEX NUT"},
    "E": {"1101": "VLV GATE", "1102": "VLV GLOBE", "1103": "VLV BALL", "1104": "NRV",
          "1201": "FLG WN", "1202": "FLG SO", "1203": "FLG BLIND",
          "1301": "PIPE SEAMLESS", "1302": "PIPE ERW",
          "1401": "BOLT STUD", "1402": "BOLT HEX", "1403": "NUT HEX"},
}

# Unseen abbreviation set (held out; used by CPSE_F and by N-ABBR2 in --unseen).
UNSEEN_HEADS = {"1101": "GT VLV", "1102": "GLBE VLV", "1103": "BL VLV", "1104": "CK VLV",
                "1201": "W/N FLG", "1202": "S/O FLG", "1203": "BLND FLG",
                "1301": "PIPE S/LESS", "1302": "PIPE E.R.W.",
                "1401": "STUD BLT", "1402": "HX BLT", "1403": "HX NUT"}
UNSEEN_FACE_FOLD = {"1201": "WNRF FLG", "1202": "SORF FLG", "1203": "BLRF FLG"}
HEADS["F"] = UNSEEN_HEADS


@dataclass(frozen=True)
class StyleSpec:
    key: str             # A..F
    sep: str
    case: str            # "upper" or "title"
    size_form: str
    class_form: str
    material_form: str
    family_form: str
    end_form: str
    valve_face: bool     # valves: write the (non-critical) face?
    pipe_ends: bool      # pipes: write the (non-critical) PE/BE/TE?
    order: tuple[str, ...]


_ORD_A = ("size_nps", "thread_size", "length_mm", "pressure_class", "face", "bore_wall", "wall",
          "body_material", "material", "property_class", "end_connection", "ends")
_ORD_B = ("size_nps", "thread_size", "length_mm", "pressure_class", "bore_wall", "wall",
          "body_material", "material", "property_class", "end_connection", "face", "ends")
_ORD_D = ("size_nps", "thread_size", "length_mm", "body_material", "material", "pressure_class",
          "bore_wall", "wall", "property_class", "face", "end_connection", "ends")
_ORD_E = ("pressure_class", "size_nps", "thread_size", "length_mm", "end_connection", "face",
          "bore_wall", "wall", "property_class", "body_material", "material", "ends")

SPECS = {
    "CPSE_A": StyleSpec("A", " ", "upper", "IN", "HASH", "STRIP", "ABBR", "ABBR", False, True, _ORD_A),
    "CPSE_B": StyleSpec("B", " ", "upper", "MM", "CL", "STRIP", "ABBR", "WORD_END", False, False, _ORD_B),
    "CPSE_C": StyleSpec("C", ", ", "title", "NPS", "CLASS_TITLE", "FULL", "TITLE", "TITLE", True, False, _ORD_B),
    "CPSE_D": StyleSpec("D", " ", "upper", "QUOTE", "LB", "HYPH", "FULL", "FULL_ABBR", True, True, _ORD_D),
    "CPSE_E": StyleSpec("E", " ", "upper", "DN", "CL_SP", "NOGR", "FULL", "FULL", True, True, _ORD_E),
    # Held out for the unseen-noise split: new separator, size spelling and abbreviations.
    "CPSE_F": StyleSpec("F", "; ", "upper", "INCH", "LB_NOSP", "STRIP", "FULL", "UNSEEN", True, True, _ORD_A),
}


def size_family(form: str) -> str:
    return "metric" if form in METRIC_FORMS else "inch"


# ---------------------------------------------------------------- rendering
def render_chunks(item: dict, style: str) -> list[Chunk]:
    v = load_vocab()
    spec = SPECS[style]
    opts = item.get("_opts", {})
    code = item["class_code"]
    crit = set(v.critical_props(code))
    chunks: list[Chunk] = []

    head = HEADS[spec.key][code]
    fold_face = spec.key == "F" and code in UNSEEN_FACE_FOLD and item.get("face") == "RF"
    if fold_face:
        head = UNSEEN_FACE_FOLD[code]
    chunks.append(Chunk("head", head, critical=False, plain=head))

    for prop in spec.order:
        val = item.get(prop)
        if val in (None, ""):
            continue
        is_crit = prop in crit
        if prop == "size_nps":
            form = opts.get("size_form", spec.size_form)
            t = size_text(val, form)
            chunks.append(Chunk(prop, t, is_crit, plain=size_text(val, "NPS")))
        elif prop == "pressure_class":
            t = class_text(val, spec.class_form)
            chunks.append(Chunk(prop, t, is_crit, plain=val))
        elif prop in MATERIAL_PROPS:
            fam = v.grade_to_family[val]
            if opts.get("material_level") == "family":
                t = FAMILY_TEXT[spec.family_form][fam]
            else:
                t = material_text(val, spec.material_form)
            chunks.append(Chunk(prop, t, is_crit, plain=t.upper()))
        elif prop in WALL_PROPS:
            d = opts.get("designation", val)
            t = SCHED_TEXT.get(spec.key, SCHED_TEXT["C"])[d]
            chunks.append(Chunk(prop, t, is_crit, plain=d))
        elif prop == "end_connection":
            t = END_TEXT[spec.end_form][val]
            chunks.append(Chunk(prop, t, is_crit, plain=val))
        elif prop == "face":
            if code in ("1101", "1102", "1103", "1104") and not spec.valve_face:
                continue
            if fold_face:
                continue
            chunks.append(Chunk(prop, val, is_crit, plain=val))
        elif prop == "ends":
            if not spec.pipe_ends:
                continue
            chunks.append(Chunk(prop, val, is_crit, plain=val))
        elif prop == "thread_size":
            chunks.append(Chunk(prop, val, is_crit, plain=val))
        elif prop == "length_mm":
            glue = item.get("thread_size") is not None
            chunks.append(Chunk(prop, LENGTH_TEXT[spec.key](int(val)), is_crit, plain=f"{int(val)} MM",
                                glue=glue))
        elif prop == "property_class":
            chunks.append(Chunk(prop, PROPCLASS_TEXT[spec.key](str(val)), is_crit, plain=str(val)))
    if item.get("risk_word"):
        chunks.append(Chunk("risk", item["risk_word"], False, plain=item["risk_word"]))
    return chunks


def join_chunks(chunks: list[Chunk], style: str) -> str:
    spec = SPECS[style]
    parts: list[str] = []
    for i, c in enumerate(chunks):
        if i == 0:
            parts.append(c.text)
        elif c.glue:
            parts.append(" " + c.text)
        else:
            parts.append(spec.sep + c.text)
    text = "".join(parts)
    text = " ".join(text.split())
    if spec.case == "upper":
        text = text.upper()
    return text


def render(item: dict, style: str) -> str:
    return join_chunks(render_chunks(item, style), style)


def CPSE_A(item: dict) -> str:
    """UPPER, noun-first: VALVE GATE 2IN 150# A216 WCB FLGD."""
    return render(item, "CPSE_A")


def CPSE_B(item: dict) -> str:
    """UPPER, modifier-first + VLV/FLG: GATE VLV 50MM CL150 A216 WCB FLANGED END."""
    return render(item, "CPSE_B")


def CPSE_C(item: dict) -> str:
    """Title Case with commas: Valve, Gate, NPS 2, Class 150, ASTM A216 WCB, Flanged, RF."""
    return render(item, "CPSE_C")


def CPSE_D(item: dict) -> str:
    """UPPER, material before class: GATE VALVE 2" A216-WCB 150 LB FLANGED RF."""
    return render(item, "CPSE_D")


def CPSE_E(item: dict) -> str:
    """UPPER, class first, DN sizes: VLV GATE CL 150 DN50 FLGD RF ASTM A216 WCB."""
    return render(item, "CPSE_E")


def CPSE_F(item: dict) -> str:
    """HELD OUT (unseen-noise split only): GT VLV; 2 INCH; 150LB; FLGE; RF; A216 WCB."""
    return render(item, "CPSE_F")


RENDERERS: dict[str, Callable[[dict], str]] = {
    "CPSE_A": CPSE_A, "CPSE_B": CPSE_B, "CPSE_C": CPSE_C, "CPSE_D": CPSE_D, "CPSE_E": CPSE_E,
    "CPSE_F": CPSE_F,
}
