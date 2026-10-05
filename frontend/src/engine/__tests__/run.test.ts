import { describe, expect, it } from "vitest";
import sample from "../golden/sample_run.json";
import subset from "../golden/subset_run.json";
import { runEngine, runEngineSync } from "../engine";
import { verifyChain } from "../audit";
import truth from "../../../public/sample/sample_truth.json";
import { assets, diffs, mk } from "./helpers";

function fixedNow(): () => string {
  const ts = ["2026-10-03T00:00:00Z", "2026-10-03T00:00:01Z"];
  let i = 0;
  return () => ts[Math.min(i++, 1)];
}

function strip(run: any): any {
  const { run_id, started_at, finished_at, audit, ...rest } = run;
  return { ...rest, audit: audit.map((e: any) => ({ seq: e.seq, actor: e.actor, action: e.action, entity_type: e.entity_type, entity_id: e.entity_id, payload: e.payload })) };
}

function check(name: string, golden: any, runId: string, scope: "sample" | "upload", tr?: Record<string, string>) {
  describe(`run parity: ${name}`, () => {
    const out = runEngineSync(golden.input.map(mk), assets, { scope, runId, now: fixedNow(), truth: tr });

    it("equals the Python RunOutput (volatile fields removed)", () => {
      const d = diffs(strip(out), strip(golden.expected), 1e-9);
      if (d.length) console.log(name, "differences:", d.length, d.slice(0, 10));
      expect(d.slice(0, 10)).toEqual([]);
      console.log(`${name}: ${out.records.length} records, ${out.summary.candidate_pairs} candidate pairs, ${out.decisions.length} decisions, ${out.audit.length} audit events, ${out.nmcs.length} NMCs`);
    });

    it("audit hashes equal Python's with the same timestamps", () => {
      expect(out.audit).toEqual(golden.expected.audit);
      expect(verifyChain(out.audit)).toEqual({ ok: true, broken_at: null });
    });

    it("whole output is identical including run fields and scores bit-for-bit", () => {
      expect(out.run_id).toBe(golden.expected.run_id);
      expect(out.started_at).toBe(golden.expected.started_at);
      expect(out.finished_at).toBe(golden.expected.finished_at);
      expect(out.decisions.map((x) => [x.gate_score, x.baseline_score])).toEqual(golden.expected.decisions.map((x: any) => [x.gate_score, x.baseline_score]));
    });
  });
}

check("sample_run", sample, "RUN-GOLDEN", "sample", truth as Record<string, string>);
check("subset_run (250 records)", subset, "RUN-GOLDEN-2", "upload");

describe("async engine", () => {
  it("gives the same result as the sync engine and reports the six stages", async () => {
    const progress: number[] = [];
    const a = await runEngine((sample as any).input.map(mk), assets, { scope: "sample", runId: "RUN-GOLDEN", now: fixedNow(), truth: truth as Record<string, string>, onProgress: (p) => progress.push(p.stage) });
    const b = runEngineSync((sample as any).input.map(mk), assets, { scope: "sample", runId: "RUN-GOLDEN", now: fixedNow(), truth: truth as Record<string, string> });
    expect(a).toEqual(b);
    expect([...new Set(progress)]).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
