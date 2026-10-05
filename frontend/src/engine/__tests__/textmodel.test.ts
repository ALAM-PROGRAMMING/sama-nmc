import { describe, expect, it } from "vitest";
import golden from "../golden/textmodel.json";
import { tokenSetRatio } from "../fuzzy";
import { TextModel, charWbNgrams, fnv1a32, textModelFor } from "../textmodel";
import { assets } from "./helpers";

const model = textModelFor(assets.textModel);

describe("text model parity", () => {
  it("buckets (FNV-1a over UTF-8, n-grams)", () => {
    for (const b of golden.buckets as any[]) expect(model.bucketOf(b.ngram), b.ngram).toBe(b.bucket);
  });

  it("vectors: same buckets, same order, weights within 1e-9", () => {
    let n = 0;
    for (const t of golden.texts as any[]) {
      const v = [...model.vector(t.text).entries()];
      expect(charWbNgrams(t.text).length, t.text).toBe(t.ngrams);
      expect(v.length, t.text).toBe(t.vector.length);
      t.vector.forEach(([k, w]: [number, number], i: number) => {
        expect(v[i][0], `${t.text} bucket #${i}`).toBe(k);
        expect(Math.abs(v[i][1] - w), `${t.text} weight #${i}`).toBeLessThan(1e-9);
      });
      n++;
    }
    expect(n).toBe(golden.texts.length);
  });

  it("cosines within 1e-9", () => {
    const texts = golden.texts as any[];
    for (const c of golden.cosines as any[]) {
      const cos = TextModel.cosine(model.vector(texts[c.a].text), model.vector(texts[c.b].text));
      expect(Math.abs(cos - c.cos), `${c.a}/${c.b}`).toBeLessThan(1e-9);
    }
  });

  it("token_set_ratio within 1e-9", () => {
    for (const r of golden.token_set_ratio as any[]) expect(Math.abs(tokenSetRatio(r.a, r.b) - r.ratio), `${r.a} | ${r.b}`).toBeLessThan(1e-9);
  });

  it("FNV-1a hashes non-ASCII as UTF-8 bytes", () => {
    // Python: fnv1a32("ÄÖ") computed over bytes c3 84 c3 96
    let h = 2166136261;
    for (const b of [0xc3, 0x84, 0xc3, 0x96]) h = Math.imul(h ^ b, 16777619) >>> 0;
    expect(fnv1a32("ÄÖ")).toBe(h);
  });
});
