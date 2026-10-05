"""The shared pure-Python token_set_ratio must equal rapidfuzz exactly (to float rounding)."""
import random

from rapidfuzz import fuzz

from sama.fuzzy import token_set_ratio

WORDS = ("FLANGE WELD NECK GATE VALVE NPS 2 12 CL150 CL300 RF FF RTJ SCH40 SCH80 STD A105 A216 WCB CARBON STEEL "
         "SS316 SS304 FLANGED BUTTWELD THREADED PIPE SEAMLESS BOLT STUD M16 X 100 NACE SUPPLY OF AS PER SPEC DRG NO "
         "4471-A PUMP CENTRIFUGAL 50 M3H").split()


def _rand_text(rng: random.Random) -> str:
    return " ".join(rng.choice(WORDS) for _ in range(rng.randint(0, 9)))


def test_matches_rapidfuzz_on_random_pairs():
    rng = random.Random(7)
    for _ in range(30000):
        a, b = _rand_text(rng), _rand_text(rng)
        assert abs(token_set_ratio(a, b) - fuzz.token_set_ratio(a, b)) < 1e-9, (a, b)


def test_edge_cases():
    for a, b in [("", ""), ("A", ""), ("A B", "A B"), ("A B", "B A"), ("A B C", "A"), ("X", "Y"), ("AB CD", "AB CE")]:
        assert abs(token_set_ratio(a, b) - fuzz.token_set_ratio(a, b)) < 1e-9, (a, b)
