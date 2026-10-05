"""Verified clustering (FR-CLU-01..03, Architecture §7.9).

Components come from AUTO_MERGE edges only. Every member pair, blocked together or not, is
re-checked; failing components are split by removing the lowest-gate-score edge on a path
joining a bad pair. Endpoints of removed edges become bridge records and go to review.

Plain deterministic algorithms (sorted iteration, BFS over sorted neighbours, ties resolved in
path order) so the browser engine reproduces exactly the same clusters.
"""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from itertools import combinations
from typing import Callable

from .contracts import CandidatePair

BAD_ALWAYS = ("R-01", "R-05", "R-06", "R-08")
BAD_UNLESS_MPN = ("R-02", "R-03", "R-04", "R-09")


def pair_is_bad(p: CandidatePair) -> bool:
    from .decide import qualifying_mpn
    if any(p.fired(r) for r in BAD_ALWAYS):
        return True
    return any(p.fired(r) for r in BAD_UNLESS_MPN) and not qualifying_mpn(p)


@dataclass
class ClusterResult:
    clusters: list[list[str]] = field(default_factory=list)          # verified, size >= 2
    bridges: set[str] = field(default_factory=set)                    # records sent to review
    alarms: list[list[str]] = field(default_factory=list)             # size alarm -> review
    removed_edges: list[tuple[str, str]] = field(default_factory=list)


def _edge(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def components(nodes: list[str], edges: dict[tuple[str, str], float]) -> list[list[str]]:
    """Connected components; nodes sorted inside each, components sorted by first member."""
    adj: dict[str, list[str]] = defaultdict(list)
    for a, b in edges:
        adj[a].append(b)
        adj[b].append(a)
    seen: set[str] = set()
    out: list[list[str]] = []
    for n in sorted(nodes):
        if n in seen:
            continue
        comp, queue = [], deque([n])
        seen.add(n)
        while queue:
            x = queue.popleft()
            comp.append(x)
            for y in adj[x]:
                if y not in seen:
                    seen.add(y)
                    queue.append(y)
        out.append(sorted(comp))
    return out


def bfs_path(edges: dict[tuple[str, str], float], src: str, dst: str) -> list[str] | None:
    """Shortest path; neighbours expanded in sorted order, so ties resolve deterministically."""
    adj: dict[str, list[str]] = defaultdict(list)
    for a, b in edges:
        adj[a].append(b)
        adj[b].append(a)
    for k in adj:
        adj[k].sort()
    prev: dict[str, str | None] = {src: None}
    queue = deque([src])
    while queue:
        x = queue.popleft()
        if x == dst:
            path = [x]
            while prev[path[-1]] is not None:
                path.append(prev[path[-1]])
            return path[::-1]
        for y in adj[x]:
            if y not in prev:
                prev[y] = x
                queue.append(y)
    return None


def verified_clusters(auto_pairs: list[CandidatePair], get_pair: Callable[[str, str], CandidatePair],
                      size_alarm: int = 25) -> ClusterResult:
    edges: dict[tuple[str, str], float] = {}
    for p in sorted(auto_pairs, key=lambda p: _edge(p.left_id, p.right_id)):
        edges[_edge(p.left_id, p.right_id)] = p.gate_score if p.gate_score is not None else 1.0
    nodes = sorted({n for e in edges for n in e})
    out = ClusterResult()
    for comp in components(nodes, edges):
        if len(comp) > size_alarm:
            out.alarms.append(comp)
            continue
        members = set(comp)
        H = {e: g for e, g in edges.items() if e[0] in members and e[1] in members}
        while True:
            bad = None
            for u, v in combinations(comp, 2):
                path = bfs_path(H, u, v)
                if path is not None and pair_is_bad(get_pair(u, v)):
                    bad = path
                    break
            if bad is None:
                break
            path_edges = [_edge(a, b) for a, b in zip(bad, bad[1:])]
            weakest = min(path_edges, key=lambda e: H[e])      # first minimum in path order
            del H[weakest]
            out.removed_edges.append(weakest)
            out.bridges.update(weakest)
        for sub in components(comp, H):
            kept = [m for m in sub if m not in out.bridges]
            if len(kept) >= 2:
                out.clusters.append(kept)
    out.clusters.sort(key=lambda c: c[0])
    return out
