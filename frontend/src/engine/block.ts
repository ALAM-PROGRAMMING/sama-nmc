/**
 * Candidate generation within class: port of backend/sama/block.py.
 * Critical-attribute key / key2 / key1 blockers plus deterministic char-n-gram TF-IDF top-k
 * (similarities quantised to 1e-9, ties broken by member order; SC-04).
 */
import type { ConfigAsset } from "./types";
import type { RecAttrs } from "./extract";
import { TextModel, type SparseVec } from "./textmodel";
import { pyCmp } from "./pyre";

const GENERIC = "9999";

/** Frozen-model TF-IDF vectors over pass-2 normalized text; also the tfidf_cos feature. */
export class TextIndex {
  readonly vecs: SparseVec[];
  private sorted: Array<{ keys: Int32Array; vals: Float64Array } | undefined>;

  constructor(texts: string[], readonly model: TextModel) {
    this.vecs = texts.map((t) => model.vector(t));
    this.sorted = new Array(texts.length);
  }

  cos(i: number, j: number): number {
    return TextModel.cosine(this.vecs[i], this.vecs[j]);
  }

  /** Terms in ascending bucket order (the order scipy accumulates a sparse product in). */
  terms(i: number): { keys: Int32Array; vals: Float64Array } {
    let s = this.sorted[i];
    if (!s) {
      const e = [...this.vecs[i].entries()].sort((a, b) => a[0] - b[0]);
      s = { keys: Int32Array.from(e.map((x) => x[0])), vals: Float64Array.from(e.map((x) => x[1])) };
      this.sorted[i] = s;
    }
    return s;
  }
}

function criticalProps(rec: RecAttrs, cfg: ConfigAsset) {
  const tmpl = cfg.classes[rec.class_code];
  if (!tmpl || rec.class_code === GENERIC) return null;
  return tmpl.properties.filter((p) => p.critical);
}

function keyPart(rec: RecAttrs, p: { name: string; resolver?: string }): string | number | null {
  const a = rec.attributes[p.name];
  if (a === undefined || a.value === null) return null;
  return p.resolver && a.resolved !== null ? a.resolved : a.value;
}

function fullKey(rec: RecAttrs, cfg: ConfigAsset): string | null {
  const props = criticalProps(rec, cfg);
  if (!props) return null;
  const parts: Array<[string, string | number]> = [];
  for (const p of props) {
    const v = keyPart(rec, p);
    if (v === null) return null; // key blocking needs every critical value
    parts.push([p.name, v]);
  }
  return JSON.stringify([rec.class_code, ...parts]);
}

/** Coarse key on the first n critical properties. Returns [classCode, ...parts] encoded, or null. */
function key2(rec: RecAttrs, cfg: ConfigAsset, n = 2): string | null {
  const props = criticalProps(rec, cfg);
  if (!props) return null;
  const parts: Array<string | number> = [];
  for (const p of props.slice(0, n)) {
    const v = keyPart(rec, p);
    if (v === null) return null;
    parts.push(v);
  }
  return JSON.stringify([rec.class_code, ...parts]);
}

export interface BlockedPair {
  i: number; // input index of the left record (id sorts first)
  j: number;
  how: string[]; // sorted blocker names
}

/** All candidate pairs, sorted by (left id, right id) in Python string order. */
export function block(recs: RecAttrs[], index: TextIndex, cfg: ConfigAsset, topK?: number): BlockedPair[] {
  const n = recs.length;
  const k = topK ?? Number((cfg.tables.models.tfidf ?? {}).top_k ?? 20);
  const bucketMax = Number(cfg.tables.tiers.block_bucket_max ?? 200);
  // rank[i] = position of record i in Python sorted() order of ids; pair key uses ranks so that
  // numeric order of the key equals (left id, right id) string order
  const order = recs.map((_, i) => i).sort((a, b) => pyCmp(recs[a].record_id, recs[b].record_id));
  const rank = new Int32Array(n);
  order.forEach((idx, r) => (rank[idx] = r));

  const pairs = new Map<number, Set<string>>();
  const add = (a: number, b: number, how: string) => {
    if (a === b) return;
    const [lo, hi] = rank[a] < rank[b] ? [a, b] : [b, a];
    const key = rank[lo] * n + rank[hi];
    let s = pairs.get(key);
    if (!s) pairs.set(key, (s = new Set()));
    s.add(how);
  };

  const byKey = new Map<string, number[]>();
  const byKey2 = new Map<string, number[]>();
  const byKey1 = new Map<string, number[]>();
  const byClass = new Map<string, number[]>();
  const push = (m: Map<string, number[]>, key: string, v: number) => {
    const l = m.get(key);
    if (l) l.push(v);
    else m.set(key, [v]);
  };
  for (let i = 0; i < n; i++) {
    const rec = recs[i];
    push(byClass, rec.class_code, i);
    const kk = fullKey(rec, cfg);
    if (kk !== null) push(byKey, kk, i);
    const k2 = key2(rec, cfg);
    if (k2 !== null) push(byKey2, k2, i);
    else {
      // second critical value missing: size-only bucket
      const k1 = key2(rec, cfg, 1);
      if (k1 !== null) push(byKey1, k1, i);
    }
  }
  const fullByK1 = new Map<string, number[]>();
  for (const [k2, ms] of byKey2) {
    const prefix = JSON.stringify((JSON.parse(k2) as unknown[]).slice(0, 2));
    let l = fullByK1.get(prefix);
    if (!l) fullByK1.set(prefix, (l = []));
    for (const m of ms) l.push(m);
  }
  for (const [k1, partial] of byKey1) {
    // partial records x their size bucket only
    const full = fullByK1.get(k1) ?? [];
    for (const a of partial) for (const b of [...full, ...partial]) add(a, b, "key1");
  }
  for (const [name, buckets] of [["key", byKey], ["key2", byKey2]] as const) {
    for (const members of buckets.values()) {
      if (members.length > bucketMax) continue; // oversized bucket: leave it to TF-IDF
      for (let x = 0; x < members.length; x++) for (let y = x + 1; y < members.length; y++) add(members[x], members[y], name);
    }
  }

  // TF-IDF top-k within each class
  for (const members of byClass.values()) {
    const m = members.length;
    if (m < 2) continue;
    // inverted index over the class: bucket -> parallel arrays of (member position, weight)
    const post = new Map<number, { rows: number[]; ws: number[] }>();
    for (let r = 0; r < m; r++) {
      const t = index.terms(members[r]);
      for (let x = 0; x < t.keys.length; x++) {
        let p = post.get(t.keys[x]);
        if (!p) post.set(t.keys[x], (p = { rows: [], ws: [] }));
        p.rows.push(r);
        p.ws.push(t.vals[x]);
      }
    }
    const kk = Math.min(k, m - 1);
    const acc = new Float64Array(m);
    const touchedMark = new Int32Array(m).fill(-1);
    for (let i = 0; i < m; i++) {
      const touched: number[] = [];
      const t = index.terms(members[i]);
      for (let x = 0; x < t.keys.length; x++) {
        const p = post.get(t.keys[x])!;
        const wi = t.vals[x];
        for (let y = 0; y < p.rows.length; y++) {
          const j = p.rows[y];
          if (touchedMark[j] !== i) {
            touchedMark[j] = i;
            acc[j] = 0;
            touched.push(j);
          }
          acc[j] += wi * p.ws[y];
        }
      }
      const cand: Array<[number, number]> = []; // [quantised, member position]
      for (const j of touched) {
        if (j === i) continue;
        const q = Math.floor(acc[j] * 1e9 + 0.5);
        if (q > 0) cand.push([q, j]);
      }
      cand.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      for (let c = 0; c < Math.min(kk, cand.length); c++) add(members[i], members[cand[c][1]], "tfidf");
    }
  }

  const out: BlockedPair[] = [];
  for (const [key, how] of [...pairs.entries()].sort((a, b) => a[0] - b[0])) {
    const ri = Math.floor(key / n);
    const rj = key % n;
    out.push({ i: order[ri], j: order[rj], how: [...how].sort(pyCmp) });
  }
  return out;
}
