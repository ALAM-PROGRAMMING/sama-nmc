/**
 * Frozen hashed character n-gram TF-IDF text model (SC-02): port of backend/sama/textmodel.py.
 * FNV-1a 32-bit over UTF-8 bytes; char_wb n-grams 3..5 including the short-word rule; vectors are
 * Maps in FIRST-OCCURRENCE order because float summation order matters for bit-identical cosines.
 */
import type { TextModelAsset } from "./types";
import { pySplit, pySum } from "./pyre";

export const NGRAM_MIN = 3;
export const NGRAM_MAX = 5;

const SURROGATE = /[\ud800-\udfff]/;

export function charWbNgrams(text: string): string[] {
  const out: string[] = [];
  for (const word of pySplit(text.toLowerCase())) {
    const w = " " + word + " ";
    if (SURROGATE.test(w)) {
      const cps = Array.from(w);
      const wl = cps.length;
      for (let n = NGRAM_MIN; n <= NGRAM_MAX; n++) {
        let offset = 0;
        out.push(cps.slice(offset, offset + n).join(""));
        while (offset + n < wl) {
          offset++;
          out.push(cps.slice(offset, offset + n).join(""));
        }
        if (offset === 0) break;
      }
      continue;
    }
    const wl = w.length;
    for (let n = NGRAM_MIN; n <= NGRAM_MAX; n++) {
      let offset = 0;
      out.push(w.slice(offset, offset + n));
      while (offset + n < wl) {
        offset++;
        out.push(w.slice(offset, offset + n));
      }
      if (offset === 0) break; // a word shorter than n is counted once
    }
  }
  return out;
}

/** FNV-1a 32-bit over the UTF-8 bytes of `s`. */
export function fnv1a32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) {
      h = Math.imul(h ^ c, 16777619) >>> 0;
    } else if (c < 0x800) {
      h = Math.imul(h ^ (0xc0 | (c >> 6)), 16777619) >>> 0;
      h = Math.imul(h ^ (0x80 | (c & 63)), 16777619) >>> 0;
    } else if (c < 0x10000) {
      h = Math.imul(h ^ (0xe0 | (c >> 12)), 16777619) >>> 0;
      h = Math.imul(h ^ (0x80 | ((c >> 6) & 63)), 16777619) >>> 0;
      h = Math.imul(h ^ (0x80 | (c & 63)), 16777619) >>> 0;
    } else {
      h = Math.imul(h ^ (0xf0 | (c >> 18)), 16777619) >>> 0;
      h = Math.imul(h ^ (0x80 | ((c >> 12) & 63)), 16777619) >>> 0;
      h = Math.imul(h ^ (0x80 | ((c >> 6) & 63)), 16777619) >>> 0;
      h = Math.imul(h ^ (0x80 | (c & 63)), 16777619) >>> 0;
    }
  }
  return h;
}

export type SparseVec = Map<number, number>;

export class TextModel {
  readonly nBuckets: number;
  readonly defaultIdf: number;
  readonly idf: Float64Array; // dense: default_idf for buckets unseen in the fit
  readonly meta: Record<string, unknown>;
  private bucketCache = new Map<string, number>();

  constructor(asset: TextModelAsset) {
    this.nBuckets = asset.n_buckets;
    this.defaultIdf = asset.default_idf;
    this.meta = asset.meta;
    this.idf = new Float64Array(this.nBuckets).fill(this.defaultIdf);
    for (const [k, v] of Object.entries(asset.idf)) this.idf[Number(k)] = v;
  }

  bucketOf(ngram: string): number {
    let b = this.bucketCache.get(ngram);
    if (b === undefined) {
      b = fnv1a32(ngram) % this.nBuckets;
      if (this.bucketCache.size > 400000) this.bucketCache.clear();
      this.bucketCache.set(ngram, b);
    }
    return b;
  }

  /** Sparse L2-normalised TF-IDF vector, in first-occurrence order of the buckets. */
  vector(text: string): SparseVec {
    const counts = new Map<number, number>();
    for (const g of charWbNgrams(text)) {
      const b = this.bucketOf(g);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    const keys: number[] = [];
    const vals: number[] = [];
    for (const [b, c] of counts) {
      keys.push(b);
      vals.push((1.0 + Math.log(c)) * this.idf[b]);
    }
    const sq = vals.map((v) => v * v);
    const norm = Math.sqrt(pySum(sq));
    const out: SparseVec = new Map();
    if (norm > 0) for (let i = 0; i < keys.length; i++) out.set(keys[i], vals[i] / norm);
    return out;
  }

  static cosine(a: SparseVec, b: SparseVec): number {
    if (a.size > b.size) [a, b] = [b, a];
    const terms: number[] = [];
    for (const [k, v] of a) {
      const w = b.get(k);
      if (w !== undefined) terms.push(v * w);
    }
    return pySum(terms);
  }
}

const modelCache = new WeakMap<TextModelAsset, TextModel>();

export function textModelFor(asset: TextModelAsset): TextModel {
  let m = modelCache.get(asset);
  if (!m) {
    m = new TextModel(asset);
    modelCache.set(asset, m);
  }
  return m;
}
