import { describe, expect, it } from "vitest";
import scenarios from "../golden/scenarios.json";
import { runEngineSync } from "../engine";
import { evaluatePair } from "../pair";
import { assets, mk } from "./helpers";

describe("golden scenarios A..E2 (pairs)", () => {
  for (const s of scenarios.pairs as any[]) {
    it(`${s.case}: ${s.title}`, () => {
      const p = evaluatePair(mk(s.left), mk(s.right), assets);
      expect(p.zone).toBe(s.expect.zone);
      expect(p.zone_step).toBe(s.expect.zone_step);
      expect(p.rules.filter((r) => r.fired).map((r) => r.id)).toEqual(s.expect.rules_fired);
      if (s.expect.class_code) expect(p.class_code).toBe(s.expect.class_code);
      for (const [prop, state] of Object.entries(s.expect.states ?? {})) {
        expect(p.comparison.find((r) => r.property === prop)?.state, prop).toBe(state);
      }
    });
  }
});

describe("golden scenario F (run -> NMC -> crosswalk)", () => {
  it("verifies the three spellings into one cluster with one NMC", () => {
    const f = (scenarios as any).run;
    const out = runEngineSync(f.records.map(mk), assets, { scope: "sample" });
    expect(out.summary.groups).toBe(f.expect.groups);
    expect(out.summary.nmcs).toBe(f.expect.nmcs);
    expect(out.nmcs[0].class_code).toBe(f.expect.class_code);
    expect(out.nmcs[0].members).toEqual(f.expect.members);
    expect(out.records.map((r) => r.status)).toEqual(f.expect.statuses);
    expect(out.summary.auto).toBe(f.expect.auto);
    expect(out.summary.review).toBe(f.expect.review);
    expect(out.summary.reject).toBe(f.expect.reject);
  });
});
