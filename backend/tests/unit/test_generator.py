"""Tests for the seeded synthetic benchmark generator (bench/generate.py)."""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bench import generate as G  # noqa: E402
from bench import styles as S  # noqa: E402
from bench.vocab import load_grids, load_vocab, validate_grids  # noqa: E402

FILES = ("records.csv", "truth.csv", "pair_labels.csv", "manifest.json")


def _read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


@pytest.fixture(scope="module")
def main_set(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("main")
    G.generate(7, 160, out)
    return out


@pytest.fixture(scope="module")
def unseen_set(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("unseen")
    G.generate(7, 160, out, unseen=True)
    return out


def test_deterministic_byte_identical(main_set, tmp_path):
    again = tmp_path / "again"
    G.generate(7, 160, again)
    for f in FILES:
        assert (main_set / f).read_bytes() == (again / f).read_bytes(), f


def test_different_seed_differs(main_set, tmp_path):
    other = tmp_path / "other"
    G.generate(8, 160, other)
    assert (main_set / "records.csv").read_bytes() != (other / "records.csv").read_bytes()


def test_unseen_deterministic(unseen_set, tmp_path):
    again = tmp_path / "again_unseen"
    G.generate(7, 160, again, unseen=True)
    for f in FILES:
        assert (unseen_set / f).read_bytes() == (again / f).read_bytes(), f


def test_record_columns_and_unique_ids(main_set, unseen_set):
    for d in (main_set, unseen_set):
        rows = _read_csv(d / "records.csv")
        assert list(rows[0].keys()) == G.RECORD_COLUMNS
        ids = [r["record_id"] for r in rows]
        assert len(ids) == len(set(ids))
        for r in rows:
            assert r["record_id"] == f"{r['cpse']}:{r['matnr']}"
            assert isinstance(json.loads(r["characteristics"]), dict)


def test_worked_examples_present(main_set, unseen_set):
    for d in (main_set, unseen_set):
        rows = _read_csv(d / "records.csv")
        by_text = {r["maktx"]: r for r in rows}
        for text in G.WORKED_TEXTS:
            assert text in by_text, text
        assert by_text["VALVE GATE 2IN 150# CS FLGD"]["record_id"] == "CPSE_A:10004521"
        assert by_text["GATE VLV 50MM CL150 A216 WCB FLANGED END"]["record_id"] == "CPSE_B:M-77320"
        assert by_text["Valve, Gate, NPS 2, Class 150, Carbon Steel, RF"]["record_id"] == "CPSE_C:4500-118"

        tm = {t: by_text[t]["true_material_id"] for t in G.WORKED_TEXTS}
        # CS vs WCB: same material (downgrade)
        assert tm["VALVE GATE 2IN 150# CS FLGD"] == tm["GATE VLV 50MM CL150 A216 WCB FLANGED END"]
        assert tm["VALVE GATE 2IN 150# CS FLGD"] == tm["Valve, Gate, NPS 2, Class 150, Carbon Steel, RF"]
        # trap twin and NACE pair: different materials
        assert tm["GATE VLV 50MM CL150 A216 WCB FLGD RF"] != tm["GATE VLV 50MM CL300 A216 WCB FLGD RF"]
        assert tm["BALL VLV 1IN CL300 SS316 NACE"] != tm['BALL VALVE 1" 300# SS316']
        # flange and pipe pairs: same material
        assert tm['FLANGE WN 2" CL150 RF SCH40 A105'] == tm["WELD NECK FLG, NPS 2, 150#, RF, S40, ASTM A105"]
        assert tm["PIPE SMLS NPS 2 STD A106 GR B"] == tm['PIPE SEAMLESS 2" SCH40 ASTM A106 B']
        # MPN pair: same mfr, same normalised MPN
        assert tm["VALVE GATE"] == tm["GATE VLV"]
        norm = lambda s: re.sub(r"[^A-Z0-9]", "", s.upper())  # noqa: E731
        assert by_text["VALVE GATE"]["mfr"] == by_text["GATE VLV"]["mfr"] != ""
        assert norm(by_text["VALVE GATE"]["mpn"]) == norm(by_text["GATE VLV"]["mpn"]) != ""

        pairs = {(p["left_id"], p["right_id"]): p for p in _read_csv(d / "pair_labels.csv")}

        def label(a: str, b: str) -> dict:
            ia, ib = sorted((by_text[a]["record_id"], by_text[b]["record_id"]))
            return pairs[(ia, ib)]

        p = label("VALVE GATE 2IN 150# CS FLGD", "GATE VLV 50MM CL150 A216 WCB FLANGED END")
        assert (p["is_match"], p["pair_type"]) == ("1", "downgrade")
        p = label("GATE VLV 50MM CL150 A216 WCB FLGD RF", "GATE VLV 50MM CL300 A216 WCB FLGD RF")
        assert (p["is_match"], p["pair_type"]) == ("0", "trap")
        p = label("BALL VLV 1IN CL300 SS316 NACE", 'BALL VALVE 1" 300# SS316')
        assert (p["is_match"], p["pair_type"]) == ("0", "riskword")
        p = label("PIPE SMLS NPS 2 STD A106 GR B", 'PIPE SEAMLESS 2" SCH40 ASTM A106 B')
        assert (p["is_match"], p["pair_type"]) == ("1", "desig")
        p = label('FLANGE WN 2" CL150 RF SCH40 A105', "WELD NECK FLG, NPS 2, 150#, RF, S40, ASTM A105")
        assert (p["is_match"], p["pair_type"]) == ("1", "identical")


def test_every_pair_type_present(main_set):
    pairs = _read_csv(main_set / "pair_labels.csv")
    types = {p["pair_type"] for p in pairs}
    assert set(G.PAIR_TYPES) <= types
    for p in pairs:
        assert p["left_id"] < p["right_id"]
        expected = "1" if p["pair_type"] in ("identical", "downgrade", "desig") else "0"
        assert p["is_match"] == expected, p
    manifest = json.loads((main_set / "manifest.json").read_text(encoding="utf-8"))
    assert all(manifest["counts"]["pairs_by_type"][t] > 0 for t in G.PAIR_TYPES)


def test_pair_labels_consistent_with_truth(main_set):
    tm = {r["record_id"]: r["true_material_id"] for r in _read_csv(main_set / "records.csv")}
    split = {r["record_id"]: r["split"] for r in _read_csv(main_set / "records.csv")}
    for p in _read_csv(main_set / "pair_labels.csv"):
        same = tm[p["left_id"]] == tm[p["right_id"]]
        assert same == (p["is_match"] == "1")
        assert split[p["left_id"]] == split[p["right_id"]]


def test_splits(main_set, unseen_set):
    rows = _read_csv(main_set / "records.csv")
    assert {r["split"] for r in rows} == {"train", "calibration", "test"}
    split_of: dict[str, str] = {}
    for r in rows:   # a material never spans two splits
        assert split_of.setdefault(r["true_material_id"], r["split"]) == r["split"]
    assert {r["split"] for r in _read_csv(unseen_set / "records.csv")} == {"test"}


def test_vocabulary_only_from_config(main_set, unseen_set):
    v = load_vocab()
    validate_grids(load_grids(), v)
    grades = set(v.grade_to_family)
    for d in (main_set, unseen_set):
        for t in _read_csv(d / "truth.csv"):
            c = json.loads(t["canonical_json"])
            code = c["class_code"]
            assert code == t["class_code"] and code in v.classes
            props = set(v.props(code))
            for k, val in c.items():
                if k in ("class_code", "kind", "variant_of", "variant_kind", "mfr", "mpn", "mpn_suffix"):
                    continue
                if k == "risk_word":
                    assert val in v.risk_words
                    continue
                assert k in props, (code, k)
                if k in ("material", "body_material"):
                    assert val in grades, val
                elif k == "size_nps":
                    assert val in v.nps_dn
                elif k == "pressure_class":
                    assert val in v.pressure_class_aliases
                elif k in ("wall", "bore_wall"):
                    assert v.wall_mm(c["size_nps"], val) is not None, (c["size_nps"], val)
                    assert c["size_nps"] in ("2", "12")
                elif k == "property_class":
                    assert val in v.allowed("1402", "property_class")
                elif k in ("face", "end_connection", "ends"):
                    assert val in v.allowed(code, k)
                elif k == "thread_size":
                    assert val in ("M12", "M16", "M20", "M24")
                elif k == "length_mm":
                    assert 50 <= int(val) <= 300


def test_style_spellings_come_from_config():
    v = load_vocab()
    for sched in S.SCHED_TEXT.values():
        for desig, text in sched.items():
            assert text in v.schedule_spelling[desig], (desig, text)
    for pc in v.pressure_class_aliases:
        for form in ("HASH", "CL", "CLASS_TITLE", "LB", "CL_SP", "LB_NOSP"):
            assert S.class_text(pc, form).upper() in v.pressure_class_aliases[pc]


def test_styles_render_worked_valve():
    item = {"class_code": "1101", "size_nps": "2", "pressure_class": "CL150",
            "body_material": "ASTM A216 WCB", "end_connection": "FLANGED", "face": "RF"}
    assert S.CPSE_A(item) == "VALVE GATE 2IN 150# A216 WCB FLGD"
    assert S.CPSE_B(item) == "GATE VLV 50MM CL150 A216 WCB FLANGED END"
    assert S.CPSE_C(item) == "Valve, Gate, NPS 2, Class 150, ASTM A216 WCB, Flanged, RF"
    assert S.CPSE_A({**item, "_opts": {"material_level": "family"}}) == "VALVE GATE 2IN 150# CS FLGD"
    outs = {S.RENDERERS[s](item) for s in S.STYLE_IDS}
    assert len(outs) == 5


def test_trap_twins_differ_in_one_critical_attribute(main_set):
    v = load_vocab()
    truth = {t["true_material_id"]: json.loads(t["canonical_json"]) for t in _read_csv(main_set / "truth.csv")}
    twins = [c for c in truth.values() if c["kind"] == "twin"]
    assert twins
    for c in twins:
        base = truth[c["variant_of"]]
        diff = [p for p in v.critical_props(c["class_code"]) if c.get(p) != base.get(p)]
        assert len(diff) == 1, (c, base)


def test_main_set_has_no_unseen_features(main_set):
    for r in _read_csv(main_set / "records.csv"):
        assert r["house_style"] != "CPSE_F"
        assert r["characteristics"] == "{}"
        for o in ("N-FIELDSWAP", "N-FILLER2", "N-ABBR2"):
            assert o not in r["noise_ops"]
        assert "FOR PLANT USE" not in r["maktx"] and "REF ENQ" not in r["maktx"]


def test_unseen_records_carry_held_out_feature(unseen_set):
    rows = _read_csv(unseen_set / "records.csv")
    assert any(r["house_style"] == "CPSE_F" for r in rows)
    for r in rows:
        if "WORKED" in r["noise_ops"]:
            continue
        assert (r["house_style"] == "CPSE_F"
                or any(o in r["noise_ops"] for o in ("N-FIELDSWAP", "N-FILLER2", "N-ABBR2"))), r
