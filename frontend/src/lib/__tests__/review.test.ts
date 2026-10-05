import { describe, expect, it } from "vitest";
import sample from "@/engine/golden/sample_run.json";
import { applyReviewAction, createMaster } from "@/engine/master";
import type { RunOutput } from "@/engine/types";
import { assets } from "@/engine/__tests__/helpers";
import { certificateIdFor, compareOpen, decidingRules, groupAudit, humanState, listDecisions, reviewCounts, stepWords } from "../review";

const run = (sample as unknown as { expected: RunOutput }).expected;
const WCB = "DEMO_A:10004107~DEMO_B:M-20427";
const A105 = "DEMO_A:10004107~DEMO_C:4500-319";
const NOW = "2026-10-03T10:00:00.000Z";

describe("review helpers", () => {
  it("counts every decision exactly once", () => {
    const m = createMaster(run);
    const c = reviewCounts(m);
    expect(c.all).toBe(run.decisions.length);
    expect(c.open + c.approved + c.rejected + c.blocked + c.lookalike + c.verified).toBe(c.all);
    expect(c.open).toBe(run.summary.review);
    expect(c.lookalike).toBe(run.summary.reject);
    expect(c.verified).toBe(run.summary.auto);
  });

  it("tracks human state through the chain trap", () => {
    let m = createMaster(run);
    const step = (id: string, actor: "Demo analyst" | "Demo engineer") => {
      const r = applyReviewAction(m, id, actor, "approve", { now: NOW, assets });
      m = r.master;
      return r.outcome;
    };
    step(WCB, "Demo analyst");
    expect(humanState(m, run.decisions.find((d) => d.id === WCB)!)).toBe("open");
    step(WCB, "Demo engineer");
    expect(humanState(m, run.decisions.find((d) => d.id === WCB)!)).toBe("approved");
    step(A105, "Demo engineer");
    const o = step(A105, "Demo analyst");
    expect(o.blocked).toBeTruthy();
    expect(humanState(m, run.decisions.find((d) => d.id === A105)!)).toBe("blocked");
    expect(listDecisions(m, "blocked").map((d) => d.id)).toEqual([A105]);
  });

  it("puts featured cases first and engineer-needed items ahead in the open queue", () => {
    const m = createMaster(run);
    const l = listDecisions(m, "open", [A105]);
    expect(l[0].id).toBe(A105);
    const rest = l.slice(1);
    expect([...rest].sort((a, b) => compareOpen(m, a, b)).map((d) => d.id)).toEqual(rest.map((d) => d.id));
  });

  it("names the deciding rule", () => {
    const lookalike = run.decisions.find((d) => d.id === "DEMO_A:10004108~DEMO_B:M-20427")!;
    expect(decidingRules(lookalike)).toEqual(["R-01"]);
    expect(stepWords(lookalike.zone_step)).toMatch(/rejected/);
    // an engineered item stops at the step-6 policy, but the rule that explains it (too vague) is named
    expect(decidingRules(run.decisions.find((d) => d.id === WCB)!)).toEqual(["R-02"]);
  });

  it("groups automatic records and keeps reviewer events visible", () => {
    const m = createMaster(run);
    const g = groupAudit(m.audit);
    expect(g.some((x) => x.kind === "auto" && x.events.length > 1)).toBe(true);
    expect(g.flatMap((x) => x.events)).toHaveLength(m.audit.length);
  });

  it("issues sequential certificate ids, stable per decision", () => {
    const a = certificateIdFor("x1");
    const b = certificateIdFor("x2");
    expect(a).toMatch(/^CERT-\d{4}$/);
    expect(b).not.toBe(a);
    expect(certificateIdFor("x1")).toBe(a);
  });
});
