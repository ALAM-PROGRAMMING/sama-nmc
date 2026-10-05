"""Seeded synthetic benchmark generator (Architecture §10; PRD FR-BENCH-01/02).

    python -m bench.generate --seed 7 --n-materials 400 --out data/synthetic/demo
    python -m bench.generate --seed 7 --n-materials 400 --unseen --out data/synthetic/unseen

Outputs (byte-identical for the same arguments):
    records.csv      RawRecord columns + true_material_id, split, house_style, noise_ops
    truth.csv        true_material_id, class_code, canonical_json
    pair_labels.csv  left_id, right_id, is_match, pair_type
    manifest.json    seed, counts per pair_type / split / class / noise op

All engineering values are drawn from config/ via bench/grids/grids.yaml (validated
at load). Prices and quantities are SYNTHETIC and labelled as such.
"""
from __future__ import annotations

import argparse
import csv
import itertools
import json
import random
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from bench import noise as N
from bench import styles as S
from bench.vocab import PIPES, VALVES, family_of_class, load_grids, load_vocab

GENERATOR_VERSION = "1.0"
RECORD_COLUMNS = ["record_id", "cpse", "matnr", "maktx", "long_text", "mtart", "matkl", "meins",
                  "characteristics", "mfr", "mpn", "last_po_price", "annual_qty", "plant",
                  "true_material_id", "split", "house_style", "noise_ops"]
PAIR_TYPES = ("identical", "trap", "downgrade", "riskword", "desig", "mpn_suffix", "random")

MAIN_CPSES = ("CPSE_A", "CPSE_B", "CPSE_C", "CPSE_D", "CPSE_E")
UNSEEN_CPSES = MAIN_CPSES + ("CPSE_F",)

# Fictional makers + the alias family that exists in config/manufacturers.yaml.
MAKERS = ("ACME VALVES", "BHARAT FLOW", "ORION FLOWTECH", "LARSEN & TOUBRO")
MPN_PREFIX = {"1101": "GV", "1102": "GL", "1103": "BV", "1104": "CV"}
MPN_SIZE = {"1/2": "0.5", "3/4": "0.75", "1-1/2": "1.5"}
MPN_END = {"FLANGED": "F", "BUTTWELD": "BW", "SOCKETWELD": "SW", "THREADED": "T"}

# Per-CPSE SAP-shaped conventions (synthetic).
CPSE_META = {
    "CPSE_A": {"plants": ("1000", "1010"), "eaches": "EA", "metres": "M",
               "matkl": {"valve": "V01", "flange": "F01", "pipe": "P01", "fastener": "B01"}},
    "CPSE_B": {"plants": ("PL01",), "eaches": "NOS", "metres": "MTR",
               "matkl": {"valve": "VLV", "flange": "FLG", "pipe": "PIP", "fastener": "FST"}},
    "CPSE_C": {"plants": ("2100", "2200"), "eaches": "EA", "metres": "M",
               "matkl": {"valve": "1100", "flange": "1200", "pipe": "1300", "fastener": "1400"}},
    "CPSE_D": {"plants": ("3000",), "eaches": "PCS", "metres": "MTR",
               "matkl": {"valve": "MG-11", "flange": "MG-12", "pipe": "MG-13", "fastener": "MG-14"}},
    "CPSE_E": {"plants": ("U100", "U200"), "eaches": "NOS", "metres": "M",
               "matkl": {"valve": "VALVE", "flange": "FLANGE", "pipe": "PIPE", "fastener": "FASTENER"}},
    "CPSE_F": {"plants": ("F001",), "eaches": "EA", "metres": "MTR",
               "matkl": {"valve": "VL", "flange": "FL", "pipe": "PP", "fastener": "FS"}},
}

# Synthetic price model (NOT market data): base by family, scaled by size index,
# pressure class and material family.
PRICE_BASE = {"valve": 400.0, "flange": 60.0, "pipe": 25.0, "fastener": 2.0}
CLASS_MULT = {"CL150": 1.0, "CL300": 1.4, "CL600": 2.0}
FAMILY_MULT = {"CARBON STEEL": 1.0, "STAINLESS STEEL": 2.2, "ALLOY STEEL": 1.5}
QTY_RANGE = {"valve": (1, 40), "flange": (5, 200), "pipe": (10, 2000), "fastener": (50, 5000)}


# ====================================================================== data classes
@dataclass
class Material:
    tmid: str
    canon: dict                    # class_code + property values (+ risk_word)
    kind: str = "base"             # base | twin | riskword | mpn_suffix | worked
    variant_of: str | None = None
    variant_kind: str | None = None
    mfr: str = ""
    mpn: str = ""
    root: str = ""                 # split group
    base_price: float = 0.0

    @property
    def class_code(self) -> str:
        return self.canon["class_code"]

    def truth_json(self) -> str:
        d = dict(self.canon)
        d["kind"] = self.kind
        if self.variant_of:
            d["variant_of"] = self.variant_of
            d["variant_kind"] = self.variant_kind
        if self.mfr:
            d["mfr"] = self.mfr
            d["mpn"] = self.mpn
        return json.dumps(d, sort_keys=True, separators=(",", ":"))


@dataclass
class Record:
    cpse: str
    matnr: str
    maktx: str
    tmid: str
    style: str
    ops: list[str]
    meins: str = ""
    matkl: str = ""
    mtart: str = ""
    plant: str = ""
    characteristics: dict = field(default_factory=dict)
    mfr: str = ""
    mpn: str = ""
    price: float | None = None
    qty: float | None = None
    long_text: str = ""
    # what the text expresses, for pair typing
    material_level: str = "na"     # grade | family | missing | na
    designation: str | None = None

    @property
    def record_id(self) -> str:
        return f"{self.cpse}:{self.matnr}"


# ====================================================================== helpers
def material_prop(code: str) -> str | None:
    if code in VALVES:
        return "body_material"
    if code == "1402":
        return None
    return "material"


def wall_prop(code: str) -> str | None:
    if code == "1201":
        return "bore_wall"
    if code in PIPES:
        return "wall"
    return None


def critical_key(canon: dict) -> tuple:
    """Identity key on critical attributes; walls compare on table-resolved wall_mm."""
    v = load_vocab()
    code = canon["class_code"]
    parts = []
    for p in v.critical_props(code):
        val = canon.get(p)
        if p in ("wall", "bore_wall") and val is not None:
            val = ("wall_mm", v.wall_mm(canon["size_nps"], val))
        parts.append((p, val))
    return (code, tuple(parts), canon.get("risk_word"))


class MatnrPool:
    def __init__(self, rng: random.Random):
        self.rng = rng
        self.used: dict[str, set[str]] = defaultdict(set)

    def reserve(self, cpse: str, matnr: str) -> None:
        self.used[cpse].add(matnr)

    def new(self, cpse: str) -> str:
        r = self.rng
        while True:
            if cpse == "CPSE_A":
                m = f"{r.randint(10000000, 10999999)}"
            elif cpse == "CPSE_B":
                m = f"M-{r.randint(10000, 99999)}"
            elif cpse == "CPSE_C":
                m = f"{r.choice((4500, 4510, 4520, 4600))}-{r.randint(100, 999)}"
            elif cpse == "CPSE_D":
                m = f"{r.randint(1, 99999999):018d}"
            elif cpse == "CPSE_E":
                m = f"MAT/{r.randint(0, 999999):06d}"
            else:
                m = f"RM{r.randint(0, 9999999):07d}"
            if m not in self.used[cpse]:
                self.used[cpse].add(m)
                return m


def mpn_for(canon: dict) -> str:
    code = canon["class_code"]
    mat = canon["body_material"].split(" ")[-1]
    if mat.startswith("SS"):
        mat = mat[2:]
    size = MPN_SIZE.get(canon["size_nps"], canon["size_nps"])
    return f"{MPN_PREFIX[code]}-{canon['pressure_class'][2:]}-{size}-{mat}-{MPN_END[canon['end_connection']]}"


def render_mpn(mpn: str, rng: random.Random) -> str:
    """Spacing / hyphen / case variants that normalise to the same MPN."""
    r = rng.random()
    if r < 0.45:
        return mpn
    if r < 0.70:
        return mpn.replace("-", " ")
    if r < 0.85:
        return mpn.replace("-", "", 1)
    return mpn.lower()


def render_mfr(mfr: str, rng: random.Random) -> str:
    aliases = load_vocab().mfr_aliases.get(mfr)
    if aliases and rng.random() < 0.6:
        return rng.choice(aliases)
    return mfr


def price_for(canon: dict, rng: random.Random) -> float:
    v = load_vocab()
    fam = family_of_class(canon["class_code"])
    base = PRICE_BASE[fam]
    if "size_nps" in canon:
        base *= 1 + 0.35 * list(v.nps_dn).index(canon["size_nps"])
    if "thread_size" in canon:
        base *= int(canon["thread_size"][1:]) / 12 * (int(canon.get("length_mm", 50)) / 100 + 0.5)
    base *= CLASS_MULT.get(canon.get("pressure_class", ""), 1.0)
    mp = material_prop(canon["class_code"])
    if mp and canon.get(mp):
        base *= FAMILY_MULT[v.grade_to_family[canon[mp]]]
    return round(base * rng.uniform(0.8, 1.2), 2)


# ====================================================================== catalogue
def sample_item(code: str, grid: dict, rng: random.Random) -> dict:
    v = load_vocab()
    item: dict = {"class_code": code}
    if code in VALVES:
        item["size_nps"] = rng.choice(grid["size_nps"])
        item["pressure_class"] = rng.choice(grid["pressure_class"])
        item["body_material"] = rng.choice(grid["body_material"])
        item["end_connection"] = rng.choice(grid["end_connection"])
        if item["end_connection"] == "FLANGED":
            item["face"] = rng.choice(grid["face"])
    elif code in ("1201", "1202", "1203"):
        item["size_nps"] = rng.choice(grid["size_nps"])
        item["pressure_class"] = rng.choice(grid["pressure_class"])
        item["face"] = rng.choice(grid["face"])
        item["material"] = rng.choice(grid["material"])
        if code == "1201":
            fam = v.grade_to_family[item["material"]]
            item["bore_wall"] = rng.choice(grid["bore_wall"][fam])
    elif code in PIPES:
        item["size_nps"] = rng.choice(grid["size_nps"])
        item["material"] = rng.choice(grid["material"])
        fam = v.grade_to_family[item["material"]]
        item["wall"] = rng.choice(grid["wall"][fam])
        item["ends"] = rng.choice(grid["ends"])
    elif code == "1401":
        item["thread_size"] = rng.choice(grid["thread_size"])
        item["length_mm"] = int(rng.choice(grid["length_mm"]))
        item["material"] = rng.choice(grid["material"])
    elif code == "1402":
        item["thread_size"] = rng.choice(grid["thread_size"])
        item["length_mm"] = int(rng.choice(grid["length_mm"]))
        item["property_class"] = str(rng.choice(grid["property_class"]))
    elif code == "1403":
        item["thread_size"] = rng.choice(grid["thread_size"])
        item["material"] = rng.choice(grid["material"])
    return item


def twin_of(canon: dict, kind: dict) -> dict | None:
    """Copy differing in exactly one critical attribute, or None if the kind does not apply."""
    code = canon["class_code"]
    if code not in kind["classes"]:
        return None
    prop = kind["property"]
    if prop == "wall":
        prop = wall_prop(code)
        if canon.get("size_nps") != kind["at_size"]:
            return None
    elif prop == "material":
        prop = material_prop(code)
    if prop is None or prop not in canon:
        return None
    a, b = kind["swap"]
    cur = str(canon[prop])
    if cur not in (a, b):
        return None
    twin = dict(canon)
    twin[prop] = b if cur == a else a
    return twin


# ====================================================================== worked examples
WORKED_MATERIALS = [
    # key, canon
    ("W-GATE", {"class_code": "1101", "size_nps": "2", "pressure_class": "CL150",
                "body_material": "ASTM A216 WCB", "end_connection": "FLANGED", "face": "RF"}),
    ("W-GATE-CL300", {"class_code": "1101", "size_nps": "2", "pressure_class": "CL300",
                      "body_material": "ASTM A216 WCB", "end_connection": "FLANGED", "face": "RF"}),
    ("W-FLANGE", {"class_code": "1201", "size_nps": "2", "pressure_class": "CL150", "face": "RF",
                  "bore_wall": "SCH40", "material": "ASTM A105"}),
    ("W-PIPE", {"class_code": "1301", "size_nps": "2", "wall": "SCH40", "material": "ASTM A106 GR B"}),
    ("W-BALL", {"class_code": "1103", "size_nps": "1", "pressure_class": "CL300", "body_material": "SS316",
                "end_connection": "FLANGED", "face": "RF"}),
    ("W-BALL-NACE", {"class_code": "1103", "size_nps": "1", "pressure_class": "CL300",
                     "body_material": "SS316", "end_connection": "FLANGED", "face": "RF",
                     "risk_word": "NACE"}),
    ("W-MPN", {"class_code": "1101", "size_nps": "4", "pressure_class": "CL300",
               "body_material": "ASTM A216 WCB", "end_connection": "FLANGED", "face": "RF"}),
]
WORKED_VARIANTS = {"W-GATE-CL300": ("W-GATE", "trap", "T-CLASS"),
                   "W-BALL-NACE": ("W-BALL", "riskword", "N-RISKWORD")}

# (material key, cpse, matnr or None, maktx, style, ops, material_level, designation, mfr, mpn)
WORKED_RECORDS = [
    ("W-GATE", "CPSE_A", "10004521", "VALVE GATE 2IN 150# CS FLGD", ["N-DOWNGRADE"], "family", None, "", ""),
    ("W-GATE", "CPSE_B", "M-77320", "GATE VLV 50MM CL150 A216 WCB FLANGED END", [], "grade", None, "", ""),
    ("W-GATE", "CPSE_C", "4500-118", "Valve, Gate, NPS 2, Class 150, Carbon Steel, RF",
     ["N-DOWNGRADE", "N-MISSING"], "family", None, "", ""),
    ("W-GATE", "CPSE_D", None, "GATE VLV 50MM CL150 A216 WCB FLGD RF", [], "grade", None, "", ""),
    ("W-GATE-CL300", "CPSE_E", None, "GATE VLV 50MM CL300 A216 WCB FLGD RF", [], "grade", None, "", ""),
    ("W-FLANGE", "CPSE_A", None, 'FLANGE WN 2" CL150 RF SCH40 A105', [], "grade", "SCH40", "", ""),
    ("W-FLANGE", "CPSE_D", None, "WELD NECK FLG, NPS 2, 150#, RF, S40, ASTM A105", [], "grade", "SCH40", "", ""),
    ("W-PIPE", "CPSE_B", None, "PIPE SMLS NPS 2 STD A106 GR B", ["N-DESIG"], "grade", "STD", "", ""),
    ("W-PIPE", "CPSE_E", None, 'PIPE SEAMLESS 2" SCH40 ASTM A106 B', [], "grade", "SCH40", "", ""),
    ("W-BALL-NACE", "CPSE_A", None, "BALL VLV 1IN CL300 SS316 NACE", ["N-RISKWORD"], "grade", None, "", ""),
    ("W-BALL", "CPSE_C", None, 'BALL VALVE 1" 300# SS316', ["N-MISSING"], "grade", None, "", ""),
    ("W-MPN", "CPSE_C", None, "VALVE GATE", ["N-MISSING"], "missing", None, "ACME VALVES", "GV-300-4-WCB-F"),
    ("W-MPN", "CPSE_E", None, "GATE VLV", ["N-MISSING"], "missing", None, "ACME VALVES", "GV 300 4 WCB F"),
]
WORKED_TEXTS = tuple(r[3] for r in WORKED_RECORDS)


# ====================================================================== generator
class Generator:
    def __init__(self, seed: int, n_materials: int, unseen: bool, split: tuple[float, float] = (0.6, 0.8)):
        self.split_cuts = split          # cumulative cut points: train < a <= calibration < b <= test
        self.seed = seed
        self.n_materials = n_materials
        self.unseen = unseen
        self.rng = random.Random(f"sama-nmc:{seed}:{'unseen' if unseen else 'main'}")
        self.v = load_vocab()
        self.grids = load_grids()
        N._check_risk_words()
        self.cpses = UNSEEN_CPSES if unseen else MAIN_CPSES
        self.materials: list[Material] = []
        self.by_id: dict[str, Material] = {}
        self.keys: set[tuple] = set()
        self.records: list[Record] = []
        self.matnrs = MatnrPool(self.rng)
        self._seq = 0

    # ---------------------------------------------------------------- materials
    def _new_material(self, canon: dict, kind: str, **kw) -> Material:
        self._seq += 1
        m = Material(tmid=f"TM-{self._seq:05d}", canon=canon, kind=kind, **kw)
        m.root = self.by_id[m.variant_of].root if m.variant_of else m.tmid
        m.base_price = price_for(canon, self.rng)
        self.materials.append(m)
        self.by_id[m.tmid] = m
        self.keys.add(critical_key(canon))
        return m

    def build_catalogue(self) -> None:
        rng = self.rng
        worked_ids: dict[str, str] = {}
        for key, canon in WORKED_MATERIALS:
            if key in WORKED_VARIANTS:
                parent, _ptype, vk = WORKED_VARIANTS[key]
                m = self._new_material(dict(canon), "worked", variant_of=worked_ids[parent],
                                       variant_kind=vk)
            else:
                m = self._new_material(dict(canon), "worked")
            if key == "W-MPN":
                m.mfr, m.mpn = "ACME VALVES", "GV-300-4-WCB-F"
            worked_ids[key] = m.tmid
        self.worked_ids = worked_ids

        n_fixed = len(WORKED_MATERIALS)
        n_twins = round(self.grids["trap_twins"]["rate"] * self.n_materials)
        n_base = max(1, self.n_materials - n_fixed - n_twins)
        weights = self.grids["class_weights"]
        codes = sorted(weights)
        w = [weights[c] for c in codes]
        made = tries = 0
        while made < n_base and tries < n_base * 200:
            tries += 1
            code = rng.choices(codes, weights=w)[0]
            canon = sample_item(code, self.grids["classes"][code], rng)
            if critical_key(canon) in self.keys:
                continue
            self._new_material(canon, "base")
            made += 1

        # trap twins: round-robin over kinds so every kind is represented
        kinds = self.grids["trap_twins"]["kinds"]
        bases = [m for m in self.materials if m.kind == "base"]
        cands: dict[str, list[tuple[Material, dict]]] = {}
        for k in kinds:
            lst = []
            for m in bases:
                t = twin_of(m.canon, k)
                if t is not None and critical_key(t) not in self.keys:
                    lst.append((m, t))
            rng.shuffle(lst)
            cands[k["id"]] = lst
        used_bases: set[str] = set()
        made = 0
        while made < n_twins and any(cands.values()):
            for k in kinds:
                if made >= n_twins:
                    break
                lst = cands[k["id"]]
                while lst:
                    m, t = lst.pop()
                    if m.tmid in used_bases or critical_key(t) in self.keys:
                        continue
                    used_bases.add(m.tmid)
                    self._new_material(t, "twin", variant_of=m.tmid, variant_kind=k["id"])
                    made += 1
                    break

        # MPN on ~20% of valve items (base + twin)
        for m in [m for m in self.materials if m.kind in ("base", "twin") and m.class_code in VALVES]:
            if rng.random() < 0.20:
                m.mfr = rng.choice(MAKERS)
                m.mpn = mpn_for(m.canon)

        # material-level variants
        pool = [m for m in self.materials if m.kind in ("base", "twin")]
        for m in pool:
            if rng.random() < N.MATERIAL_OPS["N-RISKWORD"]:
                fam = family_of_class(m.class_code)
                canon = dict(m.canon)
                canon["risk_word"] = rng.choice(N.RISK_WORDS_BY_FAMILY[fam])
                self._new_material(canon, "riskword", variant_of=m.tmid, variant_kind="N-RISKWORD")
        mpn_mats = [m for m in pool if m.mpn]
        n_suffix = 0
        for i, m in enumerate(mpn_mats):
            force = (i == len(mpn_mats) - 1 and n_suffix == 0)
            if force or rng.random() < N.MATERIAL_OPS["N-MPN-SUFFIX"]:
                canon = dict(m.canon)
                suffix = rng.choice(N.MPN_SUFFIXES)
                canon["mpn_suffix"] = suffix
                vm = self._new_material(canon, "mpn_suffix", variant_of=m.tmid, variant_kind="N-MPN-SUFFIX")
                vm.mfr, vm.mpn = m.mfr, m.mpn + suffix
                n_suffix += 1

    # ---------------------------------------------------------------- records
    def _meta(self, rec: Record, m: Material) -> None:
        rng = self.rng
        fam = family_of_class(m.class_code)
        meta = CPSE_META[rec.cpse]
        rec.plant = rng.choice(meta["plants"])
        rec.meins = meta["metres"] if fam == "pipe" else meta["eaches"]
        rec.matkl = meta["matkl"][fam]
        rec.mtart = "ERSA" if fam == "valve" else "HIBE"
        rec.price = round(m.base_price * rng.uniform(0.75, 1.25), 2)
        lo, hi = QTY_RANGE[fam]
        rec.qty = float(rng.randint(lo, hi))

    def make_record(self, m: Material, cpse: str, force_mpn: bool = False) -> Record:
        rng = self.rng
        style = cpse
        spec = S.SPECS[style]
        code = m.class_code
        ops: list[str] = []
        item = {k: val for k, val in m.canon.items() if k != "mpn_suffix"}
        opts: dict = {}
        mprop = material_prop(code)
        wprop = wall_prop(code)

        # --- pre-render (structural) noise
        if mprop and item.get(mprop) and rng.random() < N.RECORD_OPS["N-DOWNGRADE"]:
            opts["material_level"] = "family"
            ops.append("N-DOWNGRADE")
        if wprop:
            swap = N.designation_swap(item.get("size_nps"), item.get(wprop), self.grids["designation_swaps"])
            if swap and rng.random() < N.RECORD_OPS["N-DESIG"]:
                opts["designation"] = swap
                ops.append("N-DESIG")
        if "size_nps" in item and rng.random() < N.RECORD_OPS["N-UNIT"]:
            opts["size_form"] = N.op_unit(style, rng)
            ops.append("N-UNIT")
        item["_opts"] = opts
        chunks = S.render_chunks(item, style)
        if m.kind == "riskword" or item.get("risk_word"):
            ops.append("N-RISKWORD")

        # --- chunk noise
        dropped: list[str] = []
        if rng.random() < N.RECORD_OPS["N-MISSING"]:
            p = N.op_missing(chunks, rng)
            if p:
                dropped.append(p)
                ops.append("N-MISSING")
        if rng.random() < N.RECORD_OPS["N-ABBR"] and N.op_abbr(chunks, rng):
            ops.append("N-ABBR")
        if rng.random() < N.RECORD_OPS["N-REORDER"] and N.op_reorder(chunks, rng):
            ops.append("N-REORDER")
        if rng.random() < N.RECORD_OPS["N-FILLER"]:
            N.op_filler(chunks, rng, title=(spec.case == "title"))
            ops.append("N-FILLER")
        if rng.random() < N.RECORD_OPS["N-TYPO"] and N.op_typo(chunks, rng):
            ops.append("N-TYPO")

        # --- unseen-only noise (never used in the main set)
        characteristics: dict[str, str] = {}
        if self.unseen:
            unseen_ops: list[str] = []
            if style == S.HELD_OUT_STYLE:
                unseen_ops.append("STYLE-F")
            if rng.random() < N.UNSEEN_OPS["N-ABBR2"] and style != S.HELD_OUT_STYLE:
                if N.op_abbr2(chunks, code, item.get("face")):
                    unseen_ops.append("N-ABBR2")
            if rng.random() < N.UNSEEN_OPS["N-FIELDSWAP"]:
                characteristics = N.op_fieldswap(chunks, rng)
                if characteristics:
                    unseen_ops.append("N-FIELDSWAP")
            if rng.random() < N.UNSEEN_OPS["N-FILLER2"]:
                N.op_filler2(chunks, rng)
                unseen_ops.append("N-FILLER2")
            if not unseen_ops:      # every unseen-set record carries at least one held-out feature
                N.op_filler2(chunks, rng)
                unseen_ops.append("N-FILLER2")
            ops.extend(o for o in unseen_ops if o != "STYLE-F")

        text = S.join_chunks(chunks, style)
        rec = Record(cpse=cpse, matnr=self.matnrs.new(cpse), maktx=text, tmid=m.tmid, style=style,
                     ops=ops, characteristics=characteristics)
        self._meta(rec, m)
        if rng.random() < N.RECORD_OPS["N-UOM"]:
            rec.meins = N.op_uom(rec.meins, family_of_class(code), rng)
            ops.append("N-UOM")
        if rng.random() < N.RECORD_OPS["N-WRONG-MATKL"]:
            fam = family_of_class(code)
            others = sorted(f for f in CPSE_META[cpse]["matkl"] if f != fam)
            rec.matkl = CPSE_META[cpse]["matkl"][rng.choice(others)]
            ops.append("N-WRONG-MATKL")
        if m.mpn and (force_mpn or m.kind == "mpn_suffix" or rng.random() < 0.75):
            rec.mfr = render_mfr(m.mfr, rng)
            rec.mpn = render_mpn(m.mpn, rng)
            if m.kind == "mpn_suffix":
                ops.append("N-MPN-SUFFIX")

        # expressed state (for pair typing)
        moved = set(characteristics)
        if mprop and mprop in item:
            if mprop in dropped or mprop in moved:
                rec.material_level = "missing"
            else:
                rec.material_level = "family" if opts.get("material_level") == "family" else "grade"
        if wprop and wprop in item and wprop not in dropped and wprop not in moved:
            rec.designation = opts.get("designation", item[wprop])
        return rec

    def build_records(self) -> None:
        rng = self.rng
        # worked examples first (verbatim)
        for key, cpse, matnr, text, ops, level, desig, mfr, mpn in WORKED_RECORDS:
            m = self.by_id[self.worked_ids[key]]
            if matnr is None:
                matnr = self.matnrs.new(cpse)
            else:
                self.matnrs.reserve(cpse, matnr)
            rec = Record(cpse=cpse, matnr=matnr, maktx=text, tmid=m.tmid, style=cpse,
                         ops=["WORKED"] + ops, material_level=level, designation=desig, mfr=mfr, mpn=mpn)
            self._meta(rec, m)
            self.records.append(rec)

        for m in self.materials:
            if m.kind == "worked":
                continue
            if m.kind == "riskword":
                self.records.append(self.make_record(m, rng.choice(self.cpses)))
                continue
            if m.kind == "mpn_suffix":
                for c in rng.sample(self.cpses, rng.randint(1, 2)):
                    self.records.append(self.make_record(m, c))
                continue
            k = rng.randint(2, 4)
            first = True
            for c in sorted(rng.sample(self.cpses, k)):
                self.records.append(self.make_record(m, c, force_mpn=first))
                first = False
                if rng.random() < 0.10:      # within-CPSE duplicate
                    rec = self.make_record(m, c)
                    rec.ops.append("DUP-IN-CPSE")
                    self.records.append(rec)

    # ---------------------------------------------------------------- splits
    def assign_splits(self) -> dict[str, str]:
        if self.unseen:
            return {m.tmid: "test" for m in self.materials}
        roots = sorted({m.root for m in self.materials})
        self.rng.shuffle(roots)
        size = Counter(m.root for m in self.materials)
        total = sum(size.values())
        split_of_root: dict[str, str] = {}
        acc = 0
        for r in roots:
            frac = acc / total
            split_of_root[r] = "train" if frac < self.split_cuts[0] else ("calibration" if frac < self.split_cuts[1] else "test")
            acc += size[r]
        return {m.tmid: split_of_root[m.root] for m in self.materials}

    # ---------------------------------------------------------------- pairs
    def build_pairs(self, split_of: dict[str, str]) -> list[tuple[str, str, int, str]]:
        rng = self.rng
        by_mat: dict[str, list[Record]] = defaultdict(list)
        for r in self.records:
            by_mat[r.tmid].append(r)
        pairs: dict[tuple[str, str], tuple[int, str]] = {}

        def add(a: Record, b: Record, is_match: int, ptype: str) -> None:
            k = tuple(sorted((a.record_id, b.record_id)))
            pairs[k] = (is_match, ptype)  # type: ignore[index]

        # true matches
        for m in self.materials:
            for a, b in itertools.combinations(by_mat[m.tmid], 2):
                levels = {a.material_level, b.material_level}
                if levels == {"grade", "family"}:
                    t = "downgrade"
                elif a.designation and b.designation and a.designation != b.designation:
                    t = "desig"
                else:
                    t = "identical"
                add(a, b, 1, t)

        # constructed negatives
        for m in self.materials:
            if not m.variant_of:
                continue
            vk = m.variant_kind or ""
            if vk == "N-RISKWORD":
                t = "riskword"
            elif vk == "N-MPN-SUFFIX":
                t = "mpn_suffix"
            else:
                t = "trap"
            for a in by_mat[m.tmid]:
                for b in by_mat[m.variant_of]:
                    if t == "mpn_suffix" and not (a.mpn and b.mpn):
                        continue
                    add(a, b, 0, t)

        # random negatives: same split, different split-group, 70% same class
        n_pos = sum(1 for v in pairs.values() if v[0] == 1)
        target = max(50, round(0.4 * n_pos))
        root_of = {m.tmid: m.root for m in self.materials}
        cls_of = {m.tmid: m.class_code for m in self.materials}
        recs_by_split_cls: dict[tuple[str, str], list[Record]] = defaultdict(list)
        recs_by_split: dict[str, list[Record]] = defaultdict(list)
        for r in self.records:
            s = split_of[r.tmid]
            recs_by_split_cls[(s, cls_of[r.tmid])].append(r)
            recs_by_split[s].append(r)
        all_recs = list(self.records)
        made = tries = 0
        while made < target and tries < target * 50:
            tries += 1
            a = rng.choice(all_recs)
            s = split_of[a.tmid]
            pool = recs_by_split_cls[(s, cls_of[a.tmid])] if rng.random() < 0.7 else recs_by_split[s]
            b = rng.choice(pool)
            if root_of[a.tmid] == root_of[b.tmid]:
                continue
            k = tuple(sorted((a.record_id, b.record_id)))
            if k in pairs:
                continue
            add(a, b, 0, "random")
            made += 1
        return [(k[0], k[1], v[0], v[1]) for k, v in sorted(pairs.items())]

    # ---------------------------------------------------------------- run
    def run(self) -> dict:
        self.build_catalogue()
        self.build_records()
        split_of = self.assign_splits()
        pairs = self.build_pairs(split_of)
        self.split_of = split_of
        self.pairs = pairs
        return self.manifest(split_of, pairs)

    def manifest(self, split_of: dict[str, str], pairs: list) -> dict:
        rid_split = {r.record_id: split_of[r.tmid] for r in self.records}
        rid_cls = {r.record_id: self.by_id[r.tmid].class_code for r in self.records}
        ops = Counter(o for r in self.records for o in r.ops)
        pt = Counter(p[3] for p in pairs)
        pairs_split = Counter(rid_split[p[0]] for p in pairs)
        pairs_split_type: dict[str, dict[str, int]] = defaultdict(dict)
        for (s, t), n in sorted(Counter((rid_split[p[0]], p[3]) for p in pairs).items()):
            pairs_split_type[s][t] = n
        tier_e_cal = sum(1 for p in pairs if p[2] == 1 and p[3] == "identical"
                         and rid_split[p[0]] == "calibration" and self.v.tier(rid_cls[p[0]]) == "E")
        cpse_mats: dict[str, set[str]] = defaultdict(set)
        for r in self.records:
            cpse_mats[r.cpse].add(r.tmid)
        overlaps = {}
        for a, b in itertools.permutations(sorted(cpse_mats), 2):
            overlaps[f"{a}->{b}"] = round(len(cpse_mats[a] & cpse_mats[b]) / max(1, len(cpse_mats[a])), 3)
        mats_with_dup = Counter((r.cpse, r.tmid) for r in self.records)
        dup_rate = sum(1 for n in mats_with_dup.values() if n > 1) / max(1, len(mats_with_dup))
        twin_kinds = Counter(m.variant_kind for m in self.materials if m.kind == "twin")
        return {
            "generator_version": GENERATOR_VERSION,
            "seed": self.seed,
            "set": "unseen_noise" if self.unseen else "synthetic",
            "evidence_scope": "unseen_noise" if self.unseen else "synthetic",
            "n_materials_requested": self.n_materials,
            "counts": {
                "materials": len(self.materials),
                "materials_by_kind": dict(sorted(Counter(m.kind for m in self.materials).items())),
                "trap_twins_by_kind": dict(sorted(twin_kinds.items())),
                "records": len(self.records),
                "records_by_cpse": dict(sorted(Counter(r.cpse for r in self.records).items())),
                "records_by_style": dict(sorted(Counter(r.style for r in self.records).items())),
                "pairs": len(pairs),
                "pairs_by_type": {t: pt.get(t, 0) for t in PAIR_TYPES},
                "pairs_positive": sum(1 for p in pairs if p[2] == 1),
                "pairs_negative": sum(1 for p in pairs if p[2] == 0),
            },
            "per_split": {
                s: {"materials": sum(1 for m in self.materials if split_of[m.tmid] == s),
                    "records": sum(1 for r in self.records if split_of[r.tmid] == s),
                    "pairs": pairs_split.get(s, 0),
                    "pairs_by_type": pairs_split_type.get(s, {})}
                for s in ("train", "calibration", "test")
            },
            "per_class": {
                c: {"materials": sum(1 for m in self.materials if m.class_code == c),
                    "records": sum(1 for r in self.records if self.by_id[r.tmid].class_code == c),
                    "tier": self.v.tier(c)}
                for c in sorted({m.class_code for m in self.materials})
            },
            "noise_ops": dict(sorted(ops.items())),
            "noise_rates": {"record": N.RECORD_OPS, "material": N.MATERIAL_OPS,
                            "unseen": N.UNSEEN_OPS if self.unseen else {}},
            "within_cpse_duplicate_rate": round(dup_rate, 4),
            "cpse_overlap": overlaps,
            "calibration_tierE_identical_pairs": tier_e_cal,
            "fr_bench_05_min_n": 598,
            "notes": [
                "Prices (last_po_price) and quantities (annual_qty) are SYNTHETIC.",
                "Grid and noise rates are draft; N-FILLER rates must be replaced by Day-1 study rates.",
                "Splits are assigned per group (a base material with its twins/risk/MPN variants) so every "
                "constructed negative pair stays inside one split.",
                "Reference-token differences (N-FILLER DRG/TAG NO) keep the true_material_id (labelled identical).",
            ],
        }

    # ---------------------------------------------------------------- write
    def write(self, out: Path, manifest: dict) -> None:
        out.mkdir(parents=True, exist_ok=True)
        with open(out / "records.csv", "w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(RECORD_COLUMNS)
            for r in self.records:
                w.writerow([
                    r.record_id, r.cpse, r.matnr, r.maktx, r.long_text, r.mtart, r.matkl, r.meins,
                    json.dumps(r.characteristics, sort_keys=True, separators=(",", ":")),
                    r.mfr, r.mpn,
                    "" if r.price is None else f"{r.price:.2f}",
                    "" if r.qty is None else f"{r.qty:.0f}",
                    r.plant, r.tmid, self.split_of[r.tmid], r.style, ";".join(r.ops),
                ])
        with open(out / "truth.csv", "w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(["true_material_id", "class_code", "canonical_json"])
            for m in self.materials:
                w.writerow([m.tmid, m.class_code, m.truth_json()])
        with open(out / "pair_labels.csv", "w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(["left_id", "right_id", "is_match", "pair_type"])
            for p in self.pairs:
                w.writerow(list(p))
        with open(out / "manifest.json", "w", encoding="utf-8", newline="\n") as fh:
            json.dump(manifest, fh, indent=2, sort_keys=True)
            fh.write("\n")


def generate(seed: int, n_materials: int, out: str | Path, unseen: bool = False,
             split: tuple[float, float] = (0.6, 0.8)) -> dict:
    g = Generator(seed, n_materials, unseen, split)
    manifest = g.run()
    rids = [r.record_id for r in g.records]
    if len(rids) != len(set(rids)):
        raise RuntimeError("record_id collision")
    g.write(Path(out), manifest)
    return manifest


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="SAMA-NMC seeded synthetic benchmark generator")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--n-materials", type=int, default=400)
    ap.add_argument("--out", required=True)
    ap.add_argument("--unseen", action="store_true", help="produce the unseen-noise set (CPSE_F etc.)")
    ap.add_argument("--split", default="60,20,20",
                    help="train,calibration,test percentages; size calibration for >=598 eligible pairs (FR-BENCH-05)")
    a = ap.parse_args(argv)
    tr, ca, te = (float(x) for x in a.split.split(","))
    tot = tr + ca + te
    m = generate(a.seed, a.n_materials, a.out, unseen=a.unseen, split=(tr / tot, (tr + ca) / tot))
    c = m["counts"]
    print(f"[{m['set']}] seed={m['seed']} materials={c['materials']} records={c['records']} "
          f"pairs={c['pairs']} -> {a.out}")
    print("pairs_by_type:", json.dumps(c["pairs_by_type"]))


if __name__ == "__main__":
    main()
