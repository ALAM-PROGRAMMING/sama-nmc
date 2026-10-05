"""Safety invariants (PRD §19) testable at the decision layer in Phase 0.

Master-layer invariants (I-16..I-22) get their tests with the governance module in Phase 1.
Each test is named after its invariant so a failure points straight at the PRD.
"""
import math

from helpers import CFG, decide, rec
from hypothesis import given, settings
from hypothesis import strategies as st

from sama.contracts import CandidatePair, CompareRow, RuleOutcome, RULE_IDS
from sama.decide import zone, zone_baseline
from sama.score import ranker_from_gate, train_gate

MPN = dict(mfr="L&T", mpn="GV-150-2-WCB")
MPN_ALIAS = dict(mfr="LARSEN & TOUBRO", mpn="GV 150 2 WCB")


def test_I01_conflict_never_auto_even_with_mpn():
    _, z, step = decide("GATE VALVE 2IN CL150 A216 WCB FLANGED", "GATE VALVE 2IN CL300 A216 WCB FLANGED",
                        left_kw=MPN, right_kw=MPN_ALIAS)
    assert (z, step) == ("REVIEW", 1)
    _, z, step = decide('FLANGE WN 2" CL150 RF SCH40 A105', 'FLANGE WN 2" CL300 RF SCH40 A105')
    assert (z, step) == ("REJECT", 2)


def test_I02_less_specific_not_auto_without_mpn():
    _, z, _ = decide('FLANGE WN 2" CL150 RF SCH40 CARBON STEEL', 'FLANGE WN 2" CL150 RF SCH40 A105')
    assert z == "REVIEW"


def test_I03_less_specific_never_rejected_for_low_score():
    _, z, _ = decide('FLANGE WN 2" CL150 RF SCH40 CARBON STEEL', 'FLANGE WN 2" CL150 RF SCH40 A105', gate=0.0)
    assert z != "REJECT"


def test_I04_risk_word_forces_review_even_with_mpn():
    _, z, step = decide("BALL VLV 1IN CL300 SS316 NACE", 'BALL VALVE 1" 300# SS316', left_kw=MPN, right_kw=MPN_ALIAS)
    assert (z, step) == ("REVIEW", 3)


def test_I04_risk_word_inside_extractor_span_still_fires():
    a = rec('FLANGE WN 2" CL150 RF SCH40 A105 NACE MR0175')
    assert a.attributes.get("standard") and "NACE" in a.residuals.risk


def test_I05_sanity_flag_forces_review():
    _, z, step = decide("BALL VALVE 2IN CL150 DUPLEX FLGD", "BALL VALVE 2IN CL150 SS316 FLGD")
    assert (z, step) == ("REVIEW", 3)


def test_I06_unknown_residual_difference_blocks_auto():
    _, z, _ = decide('FLANGE WN 2" CL150 RF SCH40 A105', 'FLANGE WN 2" CL150 RF SCH40 A105 GALVANISED')
    assert z == "REVIEW"


def test_I06_ignorable_filler_does_not_block_auto():
    _, z, _ = decide('SUPPLY OF FLANGE WN 2" CL150 RF SCH40 A105 AS PER SPEC', 'FLANGE WN 2" CL150 RF SCH40 A105')
    assert z == "AUTO_MERGE"


def test_I07_same_mfr_different_mpn_never_auto():
    p, z, _ = decide("GATE VALVE 2IN", "GATE VLV", left_kw=MPN, right_kw=dict(mfr="L&T", mpn="GV-150-2-WCB-NACE"))
    assert p.fired("R-08") and not p.fired("R-07") and z != "AUTO_MERGE"


def test_I08_generic_never_auto_even_with_mpn():
    p, z, step = decide("CENTRIFUGAL PUMP 50 M3H", "CENTRIFUGAL PUMP 50 M3H", left_kw=MPN, right_kw=MPN_ALIAS)
    assert p.class_code == "9999" and p.fired("R-07") and (z, step) == ("REVIEW", 4)


def test_I09_tier_r_without_mpn_never_auto():
    _, z, step = decide("GATE VALVE 2IN CL150 A216 WCB FLANGED", "GATE VLV 50MM CL150 ASTM A216 WCB FLANGED END")
    assert (z, step) == ("REVIEW", 6)


def test_I09_qualifying_mpn_auto_in_tier_r():
    _, z, step = decide("GATE VALVE 2IN", "GATE VLV", left_kw=MPN, right_kw=MPN_ALIAS)
    assert (z, step) == ("AUTO_MERGE", 4)


def test_high_pressure_class_is_tier_r():
    a = rec('FLANGE WN 2" CL600 RF SCH40 A105')
    assert a.tier == "R" and any("T-01" in r for r in a.tier_reasons)


def test_pair_with_one_tier_r_record_is_tier_r():
    p, z, _ = decide('FLANGE WN 2" CL150 RF SCH40 A105 NACE', 'FLANGE WN 2" CL150 RF SCH40 A105')
    assert p.tier == "R" and z == "REVIEW"


def test_mpn_suffix_never_truncated():
    a, b = rec("GATE VALVE", "A:1", **MPN), rec("GATE VALVE", "B:2", mfr="L&T", mpn="GV-150-2-WCB-NACE")
    assert a.mpn_norm == "GV1502WCB" and b.mpn_norm == "GV1502WCBNACE"


# ---------------------------------------------------------------- property tests over the zone function
STATES = ["agree", "conflict", "less_specific", "left_missing", "right_missing", "both_missing"]


@st.composite
def pairs(draw):
    rows = [CompareRow(property=f"p{i}", critical=draw(st.booleans()), state=draw(st.sampled_from(STATES)),
                       via=draw(st.sampled_from([None, "size_table"])))
            for i in range(draw(st.integers(1, 6)))]
    fired = {r: draw(st.booleans()) for r in RULE_IDS}
    crit = [r for r in rows if r.critical]
    fired["R-01"] = any(r.state == "conflict" for r in crit)
    fired["R-02"] = any(r.state == "less_specific" for r in crit)
    fired["R-03"] = any(r.state.endswith("missing") for r in crit)
    if fired["R-07"]:
        fired["R-08"] = False
    return CandidatePair(left_id="a", right_id="b", class_code=draw(st.sampled_from(["1101", "1201", "9999"])),
                         tier=draw(st.sampled_from(["R", "E"])), comparison=rows,
                         rules=[RuleOutcome(id=k, fired=v) for k, v in fired.items()],
                         gate_score=draw(st.floats(0, 1)))


@settings(max_examples=600, deadline=None)
@given(pairs(), st.floats(0.0, 1.0))
def test_property_zone_safety(p, thr):
    z, step, _ = zone(p, thr, 0.10, CFG)
    f = p.fired
    if f("R-01"):
        assert z != "AUTO_MERGE"                                              # I-01
    if f("R-05") or f("R-06"):
        assert z != "AUTO_MERGE"                                              # I-04, I-05
        if not f("R-01"):
            assert z == "REVIEW"
    if p.class_code == "9999":
        assert z != "AUTO_MERGE"                                              # I-08
    if f("R-08") and not f("R-07"):
        assert z != "AUTO_MERGE"                                              # I-07
    qualifying = f("R-07") and p.class_code != "9999" and not (f("R-01") or f("R-05") or f("R-06"))
    if (f("R-02") or f("R-03") or f("R-04") or f("R-09")) and not qualifying:
        assert z != "AUTO_MERGE"                                              # I-02, I-06
    if p.tier == "R" and not qualifying:
        assert z != "AUTO_MERGE"                                              # I-09
    if f("R-02") and not f("R-01"):
        assert z != "REJECT"                                                  # I-03


def test_I13_ranker_change_cannot_change_zone():
    """Zones read gate_score only; overwriting rank_score with anything leaves every zone unchanged."""
    import random
    rng = random.Random(7)
    feats = [{k: rng.random() for k in ("n_crit_agree", "n_crit_conflict", "n_crit_less", "n_crit_missing",
                                         "n_noncrit_agree", "n_noncrit_conflict", "tfidf_cos", "embed_cos",
                                         "mfr_eq", "mpn_eq", "uom_compat", "same_cpse")} | {"token_set_ratio": rng.random() * 100}
             for _ in range(60)]
    gate = train_gate(feats, [i % 2 for i in range(60)])
    ranker = ranker_from_gate(gate)
    p, _, _ = decide('FLANGE WN 2" CL150 RF SCH40 A105', "WELD NECK FLG, NPS 2, 150#, RF, S40, ASTM A105")
    before = zone(p, 0.5, 0.1, CFG)
    for rs in (0.0, 0.5, 1.0):
        p.rank_score = rs
        assert zone(p, 0.5, 0.1, CFG) == before
    assert ranker.kind == "ranker" and not ranker.frozen and gate.frozen


def test_I14_rules_ignore_embeddings_and_scores():
    p1, _, _ = decide('FLANGE WN 2" CL150 RF SCH40 A105', 'FLANGE WN 2" CL300 RF SCH40 A105', gate=1.0)
    p2, _, _ = decide('FLANGE WN 2" CL150 RF SCH40 A105', 'FLANGE WN 2" CL300 RF SCH40 A105', gate=0.0)
    p1.features["embed_cos"] = 1.0
    assert [r.model_dump() for r in p1.rules] == [r.model_dump() for r in p2.rules]


def test_baseline_has_no_rules():
    p, _, _ = decide('FLANGE WN 2" CL150 RF SCH40 A105', 'FLANGE WN 2" CL300 RF SCH40 A105')
    p.baseline_score = 0.97
    assert zone_baseline(p, 0.9) == "AUTO_MERGE"       # the fuzzy matcher merges the trap twin
    assert not math.isnan(p.baseline_score)


def test_SC01_both_family_values_never_auto_merge():
    """Benchmark finding: two records that both say only 'STAINLESS STEEL' may be SS304 and SS316."""
    p, z, _ = decide("WELD NECK FLANGE 2IN CL300 SCH40S STAINLESS STEEL RTJ", "WN FLG 50MM CL300 40S SS RTJ")
    row = next(r for r in p.comparison if r.property == "material")
    assert row.state == "less_specific" and row.via == "both_family"
    assert p.fired("R-02") and z == "REVIEW"
    _, z, _ = decide("WELD NECK FLANGE 2IN CL300 SCH40S STAINLESS STEEL RTJ", "WN FLG 50MM CL300 40S SS RTJ", gate=0.0)
    assert z != "REJECT"
