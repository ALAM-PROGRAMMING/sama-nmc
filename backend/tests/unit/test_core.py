"""Unit tests: normalization, NMC, six-state compare, thresholds (Architecture §14 'Unit')."""
import math

import pytest
from helpers import CFG, decide, rec

from sama.decide import compare_prop
from sama.contracts import Attribute
from sama.nmc import format_nmc, mod11_2_check, validate
from sama.normalize import normalize_pass1
from sama.score import best_f1_threshold, cp_upper, min_n_for, select_threshold


@pytest.mark.parametrize("raw,expected", [
    ("150#", "CL150"), ("CLASS 150", "CL150"), ("Class-150", "CL150"), ("300 LB", "CL300"),
    ("50NB", "NPS 2"), ("DN50", "NPS 2"), ('2"', "2 IN"), ("2INCH", "2 IN"), ("S40", "SCH40"), ("SCH 80", "SCH80"),
    ("A216-WCB", "A216 WCB"), ("M16X100", "M16 X 100"), ("8.8", "8.8"),
])
def test_normalize_aliases(raw, expected):
    assert normalize_pass1(raw, CFG) == expected


def test_mod11_2_orcid_vector_and_examples():
    assert mod11_2_check("000000021825009") == "7"
    assert mod11_2_check("11010000123") == "6"
    assert format_nmc("1101", 123) == "NMC:1101-0000123-6"
    assert format_nmc("1201", 456) == "NMC:1201-0000456-7"
    assert format_nmc("1301", 789) == "NMC:1301-0000789-8"
    assert len("NMC:1101-0000123-6") == 18


def test_validate_rejects_typo():
    assert validate("NMC:1101-0000123-6")
    assert not validate("NMC:1101-0000123-5")
    assert not validate("NMC:1101-0000132-6")          # transposed digits caught


MAT = {"name": "material", "critical": True, "hierarchy": "material"}
WALL = {"name": "wall", "critical": True, "resolver": "schedules"}


def A(v, **kw):
    return Attribute(value=v, **kw)


@pytest.mark.parametrize("a,b,state", [
    (A("ASTM A105"), A("ASTM A105"), "agree"),
    (A("ASTM A105"), A("ASTM A350 LF2"), "conflict"),
    (A("CARBON STEEL"), A("ASTM A216 WCB"), "less_specific"),
    (A("ASTM A216 WCB"), A("CARBON STEEL"), "less_specific"),
    (A("SS304"), A("SS304L"), "conflict"),             # siblings, per hierarchies.yaml note
    (None, A("ASTM A105"), "left_missing"),
    (A("ASTM A105"), None, "right_missing"),
    (None, None, "both_missing"),
    (A(None, raw_value="DUPLEX"), A("SS316"), "left_missing"),   # unrecognised value never conflicts
])
def test_compare_truth_table(a, b, state):
    assert compare_prop(MAT, a, b, CFG).state == state


def test_size_table_agree_and_conflict():
    std2, sch40_2 = A("STD", designation="STD", resolved=3.91), A("SCH40", designation="SCH40", resolved=3.91)
    row = compare_prop(WALL, std2, sch40_2, CFG)
    assert row.state == "agree" and row.via == "size_table"
    std12, sch40_12 = A("STD", designation="STD", resolved=9.53), A("SCH40", designation="SCH40", resolved=10.31)
    assert compare_prop(WALL, std12, sch40_12, CFG).state == "conflict"
    unknown = A("SCH160", designation="SCH160", resolved=None)
    assert compare_prop(WALL, unknown, sch40_2, CFG).state == "left_missing"
    assert compare_prop(WALL, unknown, A("SCH160", designation="SCH160"), CFG).state == "agree"


def test_select_threshold_needs_598():
    assert min_n_for(0.005, 0.95) == 598
    assert not math.isfinite(select_threshold([(0.99, True)] * 300).threshold)
    r = select_threshold([(0.99, True)] * 598)
    assert r.threshold == 0.99 and r.upper_bound_95 <= 0.005
    assert abs(cp_upper(0, 1840) - 0.00163) < 1e-5


def test_best_f1_threshold():
    t, f1 = best_f1_threshold([(0.9, True), (0.8, True), (0.7, False), (0.6, True), (0.2, False)])
    assert f1 > 0.8 and t in (0.6, 0.8)


def test_extraction_spans_cover_units():
    r = rec('WELD NECK FLG, NPS 2, 150#, RF, S40, ASTM A105')
    assert r.class_code == "1201"
    assert {k: v.value for k, v in r.attributes.items()} == {
        "size_nps": "2", "pressure_class": "CL150", "face": "RF", "bore_wall": "SCH40", "material": "ASTM A105"}
    assert r.residuals.unknown == [] and r.residuals.ignorable == []


def test_family_plus_member_is_one_value():
    r = rec("GATE VALVE 2IN CL150 CARBON STEEL A216 WCB FLANGED")
    assert r.attributes["body_material"].value == "ASTM A216 WCB"
    assert not r.sanity_flags


def test_multi_value_is_flagged():
    r = rec("GATE VALVE 2IN CL150 CL300 A216 WCB FLANGED")
    assert any(f.type == "multi_value" and f.prop == "pressure_class" for f in r.sanity_flags)
    assert r.attributes["pressure_class"].value is None


def test_worked_examples_prd_3_5():
    _, z, step = decide("VALVE GATE 2IN 150# CS FLGD", "GATE VLV 50MM CL150 A216 WCB FLANGED END")
    assert (z, step) == ("REVIEW", 6)
    _, z, _ = decide("VALVE GATE 2IN 150# CS FLGD", "Valve, Gate, NPS 2, Class 150, Carbon Steel, RF")
    assert z == "REVIEW"
    _, z, step = decide("GATE VLV 50MM CL150 A216 WCB FLGD RF", "GATE VLV 50MM CL300 A216 WCB FLGD RF")
    assert (z, step) == ("REJECT", 2)
    _, z, step = decide('FLANGE WN 2" CL150 RF SCH40 A105', "WELD NECK FLG, NPS 2, 150#, RF, S40, ASTM A105")
    assert (z, step) == ("AUTO_MERGE", 8)
    p, z, step = decide("PIPE SMLS NPS 2 STD A106 GR B", 'PIPE SEAMLESS 2" SCH40 ASTM A106 B')
    assert (z, step) == ("REVIEW", 7) and p.fired("R-09")


@pytest.mark.parametrize("text,size", [
    ("BLIND FLANGE 1/2\" SS316L 600 LB RTJ", "1/2"), ("Flange, Blind, NPS 1/2, Class 600, SS316L, RTJ", "1/2"),
    ("VALVE GATE 3/4IN 150# A216 WCC BUTTWELD", "3/4"), ("GATE VLV 20MM CL150 A216 WCC BUTTWELD END", "3/4"),
    ("PIPE ERW 1-1/2\" SCH40 A53 GR B", "1-1/2"), ("FLG SO CL 150 DN15 RTJ ASTM A105", "1/2"),
])
def test_fractional_sizes(text, size):
    assert rec(text).attributes["size_nps"].value == size


@pytest.mark.parametrize("raw,expected", [
    ("GLB VLV 2IN", "GLOBE VALVE 2 IN"), ("BLV 1IN", "BALL VALVE 1 IN"), ("CHK VLV 3IN", "CHECK VALVE 3 IN"),
    ("NON-RETURN VALVE 2IN", "CHECK VALVE 2 IN"), ("SEML PIPE", "SEAMLESS PIPE"), ("STUD BOLT THD", "STUD BOLT THREADED"),
    ("GATE VL 2IN", "GATE VALVE 2 IN"), ("FLGS", "FLANGE"),
])
def test_reference_table_abbreviations(raw, expected):
    assert normalize_pass1(raw, CFG) == expected


def test_unit_NO_is_a_string_not_yaml_false():
    from sama.normalize import normalize_uom
    assert normalize_uom("NO", CFG) == "EA" and normalize_uom("NOS", CFG) == "EA"
