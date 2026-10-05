import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sample from "../golden/sample_run.json";
import { buildCertificate } from "../certificate";
import { runEngineSync } from "../engine";
import { applyReviewAction, createMaster } from "../master";
import type { BenchmarkAsset, MasterState, RunOutput } from "../types";
import { assets, mk } from "./helpers";

const NOW = "2026-10-03T10:00:00.000Z";
const benchmark = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../public/data/benchmark.json"), "utf-8")) as BenchmarkAsset;
let run: RunOutput;
let m0: MasterState;
const cert = (m: MasterState, id: string, b: BenchmarkAsset | null = benchmark) =>
  buildCertificate(m, id, { now: NOW, certificate_id: "CERT-1", benchmark: b, assets });

beforeAll(() => {
  run = runEngineSync((sample as any).input.map(mk), assets, { scope: "sample", runId: "RUN-C", now: () => NOW });
  m0 = createMaster(run);
});

describe("certificate", () => {
  it("AUTO decision: approved by the rules, real audit event, local-trail limitation", () => {
    const d = run.decisions.find((x) => x.kind === "verified")!;
    const c = cert(m0, d.id);
    expect(c.schema_version).toBe("5.0");
    expect(c.data_label).toBe("DEMO SAMPLE DATA");
    expect(c.issued_at).toBe(NOW);
    expect(c.decision.status).toBe("approved");
    expect(c.decision.approvals.map((a) => a.actor)).toEqual(["SAMA-NMC rules (automatic)"]);
    const ev = run.audit.find((e) => e.action === "DECISION_RECORDED" && e.entity_id === d.id)!;
    expect(c.audit).toEqual({ seq: ev.seq, hash: ev.hash, note: expect.any(String) });
    expect(c.limitations[0]).toBe("Benchmark figures are measurements on synthetic data, not production guarantees.");
    expect(c.limitations).toContain("This audit trail is a local demonstration trail in this browser.");
    expect(c.limitations.some((l) => /not reviewed yet/.test(l))).toBe(true);
    expect(c.identity.nmc).toBe(m0.record_nmc[d.left]);
    expect(c.identity.crosswalk.length).toBeGreaterThanOrEqual(2);
    expect(c.scores.top_features).toHaveLength(4);
    expect(c.scores.gate_score).toBe(d.gate_score);
    expect(c.records.map((r) => r.id)).toEqual([d.left, d.right]);
  });

  it("measured precision rows come from the benchmark; real_labelled is not yet measured", () => {
    const d = run.decisions[0];
    const c = cert(m0, d.id);
    const syn = benchmark.synthetic.modes.sama;
    expect(c.measured_precision[0]).toEqual({ evidence_scope: "synthetic", n: syn.auto_correct + syn.auto_wrong, false_merges: syn.auto_wrong, upper_bound_95: syn.upper_bound_95 });
    expect(c.measured_precision[1].evidence_scope).toBe("unseen_noise");
    expect(c.measured_precision[2]).toEqual({ evidence_scope: "real_labelled", n: null, false_merges: null, upper_bound_95: null, note: "not yet measured" });
    const none = cert(m0, d.id, null);
    expect(none.measured_precision[0].n).toBeNull();
  });

  it("REVIEW decision: pending, then approved with only the personas that acted", () => {
    const id = "DEMO_A:10004107~DEMO_B:M-20427";
    let c = cert(m0, id);
    expect(c.decision.status).toBe("pending_review");
    expect(c.decision.approvals).toEqual([]);
    expect(c.decision.approvals_required).toBe(2);
    expect(c.identity.nmc).toBeNull();
    let r = applyReviewAction(m0, id, "Demo analyst", "approve", { now: NOW, assets });
    r = applyReviewAction(r.master, id, "Demo engineer", "approve", { now: "2026-10-03T10:05:00.000Z", assets });
    c = cert(r.master, id);
    expect(c.decision.status).toBe("approved");
    expect(c.decision.approvals.map((a) => [a.actor, a.role, a.at])).toEqual([
      ["Demo analyst", "Analyst", NOW],
      ["Demo engineer", "Engineer", "2026-10-03T10:05:00.000Z"],
    ]);
    expect(c.identity.nmc).toBe(r.master.record_nmc["DEMO_A:10004107"]);
    expect(c.identity.crosswalk).toEqual([{ cpse: "DEMO_A", matnr: "10004107" }, { cpse: "DEMO_B", matnr: "M-20427" }]);
  });

  it("rejected review and REJECT zone: rejected, no approvals", () => {
    const id = "DEMO_A:10004107~DEMO_B:M-20427";
    const r = applyReviewAction(m0, id, "Demo analyst", "reject", { now: NOW, assets });
    const c = cert(r.master, id);
    expect(c.decision.status).toBe("rejected");
    expect(c.decision.approvals).toEqual([]);
    const look = run.decisions.find((x) => x.kind === "lookalike")!;
    const c2 = cert(m0, look.id);
    expect(c2.decision.status).toBe("rejected");
    expect(c2.decision.approvals).toEqual([]);
  });

  it("GENERIC adds the never-auto-merged sentence; uploads are labelled as uploads", () => {
    const generic = run.decisions.find((x) => x.class_code === "9999");
    if (generic) expect(cert(m0, generic.id).limitations.some((l) => /never auto-merged/.test(l))).toBe(true);
    const up = runEngineSync([mk({ cpse: "U", matnr: "1", maktx: "CENTRIFUGAL PUMP 50 M3H" }), mk({ cpse: "V", matnr: "2", maktx: "CENTRIFUGAL PUMP 50 M3H" })], assets, { scope: "upload", now: () => NOW });
    const mu = createMaster(up);
    const c = cert(mu, up.decisions[0].id);
    expect(c.data_label).toBe("UPLOADED DATA (processed locally in this browser)");
    expect(c.evidence_scope).toBe("uploaded run");
    expect(c.limitations.some((l) => /never auto-merged/.test(l))).toBe(true);
  });
});
