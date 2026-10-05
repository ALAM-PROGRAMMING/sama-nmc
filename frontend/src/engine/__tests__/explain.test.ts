import { describe, expect, it } from "vitest";
import golden from "../golden/sample_run.json";
import { attributeLabel, explainDecision, prettyValue, stateWord } from "../explain";
import type { Decision, RunOutput } from "../types";

const run = (golden as unknown as { expected: RunOutput }).expected;
const dec = (l: string, r: string) => run.decisions.find((d) => d.id === [l, r].sort().join("~")) as Decision;

describe("plain-language explanations", () => {
  it("states words and labels", () => {
    expect(stateWord("conflict")).toBe("DIFFERENT");
    expect(stateWord("less_specific")).toBe("TOO VAGUE");
    expect(stateWord("left_missing")).toBe("MISSING");
    expect(attributeLabel("pressure_class")).toBe("Class");
    expect(prettyValue("pressure_class", "CL150")).toBe("Class 150");
    expect(prettyValue("size_nps", "1-1/2")).toBe('1-1/2"');
  });

  it("CASE 1: Class 150 vs Class 300 is explained as R-01 with the real values", () => {
    const e = explainDecision(dec("DEMO_B:M-20427", "DEMO_A:10004108"));
    expect(e.rule_ids).toEqual(["R-01"]);
    expect(e.headline).toMatch(/Class differs \(Class (150 vs Class 300|300 vs Class 150)\)/);
    expect(e.bullets[0]).toMatch(/Class is Class (150|300) on one record and Class (300|150) on the other/);
  });

  it("CASE 2: carbon steel vs A216 WCB is too vague, for an engineer", () => {
    const e = explainDecision(dec("DEMO_A:10004107", "DEMO_B:M-20427"));
    expect(e.rule_ids).toContain("R-02");
    expect(e.headline).toMatch(/too vague/);
    expect(e.bullets.join(" ")).toContain("CARBON STEEL");
    expect(e.next_step).toContain("two approvals");
  });

  it("GENERIC is review only and says so", () => {
    const e = explainDecision(dec("DEMO_A:10004115", "DEMO_B:M-20435"));
    expect(e.bullets.join(" ")).toContain("GENERIC records are never auto-merged");
  });

  it("every kept decision gets a non-empty explanation", () => {
    for (const d of run.decisions) {
      const e = explainDecision(d);
      expect(e.headline.length).toBeGreaterThan(10);
      expect(e.bullets.length).toBeGreaterThan(0);
    }
  });
});
