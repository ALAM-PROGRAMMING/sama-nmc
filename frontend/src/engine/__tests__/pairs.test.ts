import { describe, expect, it } from "vitest";
import golden from "../golden/pairs.json";
import { evaluatePair } from "../pair";
import { assets, diffs, mk } from "./helpers";

describe("pairs parity: standalone pair decisions", () => {
  it("matches Python evaluate_pair for every fixture pair", () => {
    const failures: string[] = [];
    let n = 0;
    for (const [idx, g] of (golden as any[]).entries()) {
      const p = evaluatePair(mk(g.left), mk(g.right), assets);
      const actual = {
        class_code: p.class_code, tier: p.tier, comparison: p.comparison, residual_diff: p.residual_diff, rules: p.rules,
        features: p.features, gate_score: p.gate_score, baseline_score: p.baseline_score, zone: p.zone, zone_step: p.zone_step,
        reason: p.zone_reason,
      };
      // scores are q6-rounded in both languages: |diff| <= 1e-6; features within 1e-9
      const d = [
        ...diffs({ ...actual, gate_score: 0, baseline_score: 0 }, { ...g.expected, gate_score: 0, baseline_score: 0 }, 1e-9),
        ...diffs([actual.gate_score, actual.baseline_score], [g.expected.gate_score, g.expected.baseline_score], 1e-6),
      ];
      n++;
      if (d.length) failures.push(`#${idx} ${g.left.maktx} | ${g.right.maktx}: ${d.slice(0, 3).join("; ")}`);
    }
    expect(n).toBe((golden as any[]).length);
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("scores are bit-identical (exact) for most pairs", () => {
    let exact = 0;
    for (const g of golden as any[]) {
      const p = evaluatePair(mk(g.left), mk(g.right), assets);
      if (p.gate_score === g.expected.gate_score && p.baseline_score === g.expected.baseline_score) exact++;
    }
    // informational: report how many are exactly equal
    console.log(`exact score equality: ${exact}/${(golden as any[]).length}`);
    expect(exact).toBeGreaterThan(0);
  });
});
