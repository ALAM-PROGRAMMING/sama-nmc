/**
 * Plain text similarity shared with the Python reference: port of backend/sama/fuzzy.py.
 * `tokenSetRatio` re-implements rapidfuzz's default token_set_ratio (no preprocessing).
 */
import { pyCmp, pySplit } from "./pyre";

function cps(s: string): Int32Array {
  const out: number[] = [];
  for (const ch of s) out.push(ch.codePointAt(0)!);
  return Int32Array.from(out);
}

/** Insertions + deletions needed to turn a into b (= len(a)+len(b)-2*LCS). */
export function indelDistance(a: string, b: string): number {
  const x = cps(a);
  const y = cps(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = new Int32Array(y.length + 1);
  let cur = new Int32Array(y.length + 1);
  for (let i = 0; i < x.length; i++) {
    const ca = x[i];
    cur[0] = 0;
    for (let j = 1; j <= y.length; j++) {
      if (ca === y[j - 1]) cur[j] = prev[j - 1] + 1;
      else cur[j] = prev[j] > cur[j - 1] ? prev[j] : cur[j - 1];
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return x.length + y.length - 2 * prev[y.length];
}

function normSim(dist: number, lensum: number): number {
  if (lensum === 0) return 100.0;
  return (1.0 - dist / lensum) * 100.0;
}

const cpLen = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

export function ratio(a: string, b: string): number {
  return normSim(indelDistance(a, b), cpLen(a) + cpLen(b));
}

export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(pySplit(a));
  const tb = new Set(pySplit(b));
  if (ta.size === 0 || tb.size === 0) return 0.0;
  const inter: string[] = [];
  const diffAB: string[] = [];
  const diffBA: string[] = [];
  for (const t of ta) (tb.has(t) ? inter : diffAB).push(t);
  for (const t of tb) if (!ta.has(t)) diffBA.push(t);
  if (inter.length && (diffAB.length === 0 || diffBA.length === 0)) return 100.0;
  const sect = inter.sort(pyCmp).join(" ");
  const ab = diffAB.sort(pyCmp).join(" ");
  const ba = diffBA.sort(pyCmp).join(" ");
  if (!sect) return ratio(ab, ba); // the sect-based candidates are 0
  const c12 = sect + " " + ab;
  const c21 = sect + " " + ba;
  const sectLen = cpLen(sect);
  return Math.max(
    normSim(cpLen(c12) - sectLen, sectLen + cpLen(c12)),
    normSim(cpLen(c21) - sectLen, sectLen + cpLen(c21)),
    ratio(c12, c21),
  );
}
