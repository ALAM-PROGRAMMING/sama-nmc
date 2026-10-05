/**
 * Verified clustering (FR-CLU-01..03): port of backend/sama/cluster.py.
 * Plain deterministic algorithms (sorted iteration, BFS over sorted neighbours, ties resolved in path
 * order) so the browser engine reproduces exactly the same clusters.
 */
import { pairFired, qualifyingMpn } from "./decide";
import type { Pair } from "./decide";
import { pyCmp } from "./pyre";

const BAD_ALWAYS = ["R-01", "R-05", "R-06", "R-08"];
const BAD_UNLESS_MPN = ["R-02", "R-03", "R-04", "R-09"];

export function pairIsBad(p: Pick<Pair, "rules" | "class_code">): boolean {
  if (BAD_ALWAYS.some((r) => pairFired(p, r))) return true;
  return BAD_UNLESS_MPN.some((r) => pairFired(p, r)) && !qualifyingMpn(p);
}

export interface ClusterResult {
  clusters: string[][];
  bridges: Set<string>;
  alarms: string[][];
  removed_edges: Array<[string, string]>;
}

const edgeOf = (a: string, b: string): [string, string] => (pyCmp(a, b) < 0 ? [a, b] : [b, a]);
const ek = (e: [string, string]): string => e[0] + "\u0000" + e[1];

type Edges = Map<string, { e: [string, string]; g: number }>; // insertion order preserved

function adjacency(edges: Edges): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const add = (x: string, y: string) => {
    const l = adj.get(x);
    if (l) l.push(y);
    else adj.set(x, [y]);
  };
  for (const { e } of edges.values()) {
    add(e[0], e[1]);
    add(e[1], e[0]);
  }
  return adj;
}

/** Connected components; nodes sorted inside each, components sorted by first member. */
export function components(nodes: string[], edges: Edges): string[][] {
  const adj = adjacency(edges);
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const n of [...nodes].sort(pyCmp)) {
    if (seen.has(n)) continue;
    const comp: string[] = [];
    const queue = [n];
    let head = 0;
    seen.add(n);
    while (head < queue.length) {
      const x = queue[head++];
      comp.push(x);
      for (const y of adj.get(x) ?? []) {
        if (!seen.has(y)) {
          seen.add(y);
          queue.push(y);
        }
      }
    }
    out.push(comp.sort(pyCmp));
  }
  return out;
}

/** Shortest path; neighbours expanded in sorted order, so ties resolve deterministically. */
function bfsPath(adj: Map<string, string[]>, src: string, dst: string): string[] | null {
  const prev = new Map<string, string | null>([[src, null]]);
  const queue = [src];
  let head = 0;
  while (head < queue.length) {
    const x = queue[head++];
    if (x === dst) {
      const path = [x];
      while (prev.get(path[path.length - 1]) !== null) path.push(prev.get(path[path.length - 1]) as string);
      return path.reverse();
    }
    for (const y of adj.get(x) ?? []) {
      if (!prev.has(y)) {
        prev.set(y, x);
        queue.push(y);
      }
    }
  }
  return null;
}

export function verifiedClusters(
  autoPairs: Pair[],
  getPair: (a: string, b: string) => Pair,
  sizeAlarm = 25,
): ClusterResult {
  const edges: Edges = new Map();
  const sortedAuto = [...autoPairs].sort((p, q) => {
    const a = edgeOf(p.left_id, p.right_id);
    const b = edgeOf(q.left_id, q.right_id);
    return pyCmp(a[0], b[0]) || pyCmp(a[1], b[1]);
  });
  for (const p of sortedAuto) {
    const e = edgeOf(p.left_id, p.right_id);
    edges.set(ek(e), { e, g: p.gate_score !== null ? p.gate_score : 1.0 });
  }
  const nodeSet = new Set<string>();
  for (const { e } of edges.values()) {
    nodeSet.add(e[0]);
    nodeSet.add(e[1]);
  }
  const nodes = [...nodeSet].sort(pyCmp);
  const out: ClusterResult = { clusters: [], bridges: new Set(), alarms: [], removed_edges: [] };
  for (const comp of components(nodes, edges)) {
    if (comp.length > sizeAlarm) {
      out.alarms.push(comp);
      continue;
    }
    const members = new Set(comp);
    const H: Edges = new Map();
    for (const [k, v] of edges) if (members.has(v.e[0]) && members.has(v.e[1])) H.set(k, v);
    for (;;) {
      let bad: string[] | null = null;
      const adj = adjacency(H);
      for (const l of adj.values()) l.sort(pyCmp);
      outer: for (let x = 0; x < comp.length; x++) {
        for (let y = x + 1; y < comp.length; y++) {
          const path = bfsPath(adj, comp[x], comp[y]);
          if (path !== null && pairIsBad(getPair(comp[x], comp[y]))) {
            bad = path;
            break outer;
          }
        }
      }
      if (bad === null) break;
      const pathEdges: Array<[string, string]> = [];
      for (let i = 0; i + 1 < bad.length; i++) pathEdges.push(edgeOf(bad[i], bad[i + 1]));
      let weakest = pathEdges[0];
      for (const e of pathEdges) if (H.get(ek(e))!.g < H.get(ek(weakest))!.g) weakest = e; // first minimum in path order
      H.delete(ek(weakest));
      out.removed_edges.push(weakest);
      out.bridges.add(weakest[0]);
      out.bridges.add(weakest[1]);
    }
    for (const subc of components(comp, H)) {
      const kept = subc.filter((m) => !out.bridges.has(m));
      if (kept.length >= 2) out.clusters.push(kept);
    }
  }
  out.clusters.sort((a, b) => pyCmp(a[0], b[0]));
  return out;
}
