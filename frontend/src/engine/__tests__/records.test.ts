import { describe, expect, it } from "vitest";
import golden from "../golden/records.json";
import { classify } from "../classify";
import { assignTier } from "../decide";
import { extract } from "../extract";
import { applyPass2, normalizeRecord } from "../normalize";
import { assets, diffs, mk } from "./helpers";

describe("records parity: normalize -> classify -> pass 2 -> extract -> tier", () => {
  it("matches the Python reference for every fixture record", () => {
    const cfg = assets.config;
    const failures: string[] = [];
    let compared = 0;
    for (const [idx, g] of (golden as any[]).entries()) {
      const raw = mk(g.input);
      let norm = normalizeRecord(raw, cfg);
      const cls = classify(norm.norm_text, cfg);
      norm = applyPass2(norm, cls.class_code, cfg);
      const rec = assignTier(extract(raw, norm, cls, cfg), cfg);
      const actual = {
        normalized: norm.norm_text, uom: norm.uom_norm, transforms: norm.transforms, class_code: rec.class_code,
        class_confidence: rec.class_confidence, abstained: rec.abstained, tier: rec.tier, tier_reasons: rec.tier_reasons,
        attributes: rec.attributes, residuals: rec.residuals, sanity_flags: rec.sanity_flags, mfr_norm: rec.mfr_norm, mpn_norm: rec.mpn_norm,
      };
      const d = diffs(actual, g.expected);
      compared++;
      if (d.length) failures.push(`#${idx} ${JSON.stringify(g.input.maktx)}: ${d.slice(0, 3).join("; ")}`);
    }
    expect(compared).toBe((golden as any[]).length);
    expect(failures.slice(0, 10)).toEqual([]);
  });
});
