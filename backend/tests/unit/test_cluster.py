from sama.cluster import bfs_path, components, verified_clusters
from sama.contracts import CandidatePair, RuleOutcome


def _pair(a, b, gate=0.9, fired=()):
    return CandidatePair(left_id=a, right_id=b, class_code="1201", tier="E", gate_score=gate,
                         rules=[RuleOutcome(id=f"R-0{i}", fired=(f"R-0{i}" in fired)) for i in range(1, 10)])


def test_components_and_path_are_deterministic():
    edges = {("a", "b"): 1.0, ("b", "c"): 1.0, ("x", "y"): 1.0}
    assert components(["a", "b", "c", "x", "y", "z"], edges) == [["a", "b", "c"], ["x", "y"], ["z"]]
    assert bfs_path(edges, "a", "c") == ["a", "b", "c"]
    assert bfs_path(edges, "a", "x") is None


def test_chain_with_a_conflicting_end_is_split_at_the_weakest_edge():
    # a-b strong, b-c weak; a vs c conflict (R-01) -> the weakest edge b-c is removed, c becomes a bridge
    pairs = {("a", "b"): _pair("a", "b", 0.99), ("b", "c"): _pair("b", "c", 0.80), ("a", "c"): _pair("a", "c", fired=("R-01",))}
    res = verified_clusters([pairs[("a", "b")], pairs[("b", "c")]], lambda x, y: pairs[(min(x, y), max(x, y))])
    assert res.clusters == [["a"]] or res.clusters == []          # a-b alone is a pair: b is also a bridge endpoint
    assert {"b", "c"} <= res.bridges and ("b", "c") in res.removed_edges


def test_clean_cluster_is_kept():
    pairs = {("a", "b"): _pair("a", "b"), ("b", "c"): _pair("b", "c"), ("a", "c"): _pair("a", "c")}
    res = verified_clusters(list(pairs.values()), lambda x, y: pairs[(min(x, y), max(x, y))])
    assert res.clusters == [["a", "b", "c"]] and not res.bridges


def test_size_alarm():
    ids = [f"r{i:02d}" for i in range(30)]
    ps = [_pair(a, b) for a, b in zip(ids, ids[1:])]
    res = verified_clusters(ps, lambda x, y: _pair(x, y), size_alarm=25)
    assert res.alarms and not res.clusters
