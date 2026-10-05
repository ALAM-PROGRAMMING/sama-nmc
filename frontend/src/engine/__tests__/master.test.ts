import { beforeAll, describe, expect, it } from "vitest";
import sample from "../golden/sample_run.json";
import { runEngineSync } from "../engine";
import { verifyChain } from "../audit";
import { applyReviewAction, createMaster } from "../master";
import { validateNmc } from "../nmc";
import type { MasterState, RunOutput } from "../types";
import { assets, mk } from "./helpers";

const NOW = "2026-10-03T10:00:00.000Z";
const ctx = { now: NOW, assets };
let run: RunOutput;
let master0: MasterState;

beforeAll(() => {
  run = runEngineSync((sample as any).input.map(mk), assets, { scope: "sample", runId: "RUN-T", now: () => NOW });
  master0 = createMaster(run);
});

const AB = "DEMO_A:10004107~DEMO_B:M-20427";
const AC = "DEMO_A:10004107~DEMO_C:4500-319";

describe("createMaster", () => {
  it("opens exactly one review item per review decision, approvals by tier", () => {
    const reviews = run.decisions.filter((d) => d.kind === "review");
    expect(Object.keys(master0.reviews).sort()).toEqual(reviews.map((d) => d.id).sort());
    for (const d of reviews) {
      expect(master0.reviews[d.id].status).toBe("open");
      expect(master0.reviews[d.id].approvals_required).toBe(d.tier === "R" ? 2 : 1);
    }
    expect(master0.nmcs).toEqual(run.nmcs);
    expect(master0.audit).toEqual(run.audit);
  });
});

describe("maker-checker", () => {
  it("Tier R needs two different actors; the same person cannot approve twice", () => {
    let r = applyReviewAction(master0, AB, "Demo analyst", "approve", ctx);
    expect(r.outcome.ok).toBe(true);
    expect(r.outcome.status).toBe("open");
    expect(r.master.reviews[AB].approvals).toHaveLength(1);
    expect(r.master.nmcs).toEqual(master0.nmcs); // nothing written yet
    const again = applyReviewAction(r.master, AB, "Demo analyst", "approve", ctx);
    expect(again.outcome.ok).toBe(false);
    expect(again.outcome.error).toBe("The same person cannot approve twice. Switch role to give the second approval.");
    expect(again.master).toBe(r.master);
    r = applyReviewAction(r.master, AB, "Demo engineer", "approve", ctx);
    expect(r.outcome.ok).toBe(true);
    expect(r.master.reviews[AB].status).toBe("approved");
    expect(r.master.reviews[AB].approvals.map((a) => a.actor)).toEqual(["Demo analyst", "Demo engineer"]);
  });

  it("Tier E needs one approval", () => {
    const id = "DEMO_A:10004113~DEMO_C:4500-323";
    expect(master0.reviews[id].approvals_required).toBe(1);
    const r = applyReviewAction(master0, id, "Demo analyst", "approve", ctx);
    expect(r.master.reviews[id].status).toBe("approved");
    expect(r.outcome.nmc?.action).toBe("minted");
  });

  it("only review decisions can be reviewed", () => {
    const verified = run.decisions.find((d) => d.kind === "verified")!;
    const look = run.decisions.find((d) => d.kind === "lookalike")!;
    for (const d of [verified, look]) {
      const r = applyReviewAction(master0, d.id, "Demo engineer", "approve", ctx);
      expect(r.outcome.ok).toBe(false);
      expect(r.master).toBe(master0);
    }
    expect(applyReviewAction(master0, "nope~nope", "Demo engineer", "approve", ctx).outcome.ok).toBe(false);
  });

  it("never touches decisions, rules or the gate", () => {
    const before = JSON.stringify(run.decisions);
    let r = applyReviewAction(master0, AB, "Demo analyst", "approve", ctx);
    r = applyReviewAction(r.master, AB, "Demo engineer", "approve", ctx);
    r = applyReviewAction(r.master, AC, "Demo analyst", "approve", ctx);
    expect(JSON.stringify(r.master.run.decisions)).toBe(before);
    expect(r.master.run).toBe(run);
  });
});

describe("reject", () => {
  it("writes nothing to the master layer while the records still have open items", () => {
    const id = "DEMO_A:10004107~DEMO_C:4500-317";
    const r = applyReviewAction(master0, id, "Demo analyst", "reject", { ...ctx, reason_code: "WRONG_CLASS" });
    expect(r.outcome.ok).toBe(true);
    expect(r.master.reviews[id].status).toBe("rejected");
    expect(r.master.reviews[id].rejection).toEqual({ actor: "Demo analyst", at: NOW, reason_code: "WRONG_CLASS" });
    expect(r.master.nmcs).toEqual(master0.nmcs);
    expect(r.master.record_nmc).toEqual(master0.record_nmc);
    expect(r.master.approved_pairs).toEqual([]);
    expect(r.outcome.events.map((e) => e.action)).toEqual(["REVIEW_REJECTED"]);
  });

  it("reason code defaults to OTHER; any actor can reject a Tier R item", () => {
    const r = applyReviewAction(master0, AB, "Demo analyst", "reject", ctx);
    expect(r.master.reviews[AB].rejection?.reason_code).toBe("OTHER");
    expect(r.master.reviews[AB].status).toBe("rejected");
  });

  it("gives singleton identities once no open item remains (FR-NMC-07)", () => {
    const id = "DEMO_A:10004109~DEMO_B:M-20429";
    const r = applyReviewAction(master0, id, "Demo engineer", "reject", ctx);
    expect(r.outcome.events.map((e) => e.action)).toEqual(["REVIEW_REJECTED", "SINGLETON_MINTED", "SINGLETON_MINTED"]);
    for (const rid of ["DEMO_A:10004109", "DEMO_B:M-20429"]) {
      const code = r.master.record_nmc[rid]!;
      expect(validateNmc(code)).toBe(true);
      expect(r.master.nmcs.find((n) => n.code === code)!.kind).toBe("singleton");
    }
    expect(r.master.nmcs.length).toBe(master0.nmcs.length + 2);
    const serials = r.master.nmcs.map((n) => n.serial);
    expect(new Set(serials).size).toBe(serials.length);
    expect(applyReviewAction(r.master, id, "Demo engineer", "approve", ctx).outcome.ok).toBe(false);
  });
});

describe("identity changes after approval (FR-CLU-04, I-18, I-19)", () => {
  it("chain trap: A216 WCB ~ CARBON STEEL mints, then CARBON STEEL ~ A105 is blocked (R-01 with A216 WCB)", () => {
    let r = applyReviewAction(master0, AB, "Demo analyst", "approve", ctx);
    r = applyReviewAction(r.master, AB, "Demo engineer", "approve", ctx);
    expect(r.outcome.nmc?.action).toBe("minted");
    const code = r.outcome.nmc!.code!;
    expect(validateNmc(code)).toBe(true);
    expect(r.master.record_nmc["DEMO_A:10004107"]).toBe(code);
    expect(r.master.record_nmc["DEMO_B:M-20427"]).toBe(code);
    expect(r.master.nmcs.find((n) => n.code === code)!.golden.attributes["body_material"]).toBe("ASTM A216 WCB"); // most specific wins
    expect(r.master.approved_pairs).toEqual([AB]);
    const m = r.master;

    r = applyReviewAction(m, AC, "Demo analyst", "approve", ctx);
    expect(r.outcome.status).toBe("open");
    r = applyReviewAction(r.master, AC, "Demo engineer", "approve", ctx);
    expect(r.outcome.ok).toBe(true);
    expect(r.outcome.blocked).toBeDefined();
    expect(r.outcome.blocked!.offending).toEqual({ left: "DEMO_B:M-20427", right: "DEMO_C:4500-319", rule: "R-01" });
    expect(r.outcome.message).toMatch(/conflicts with DEMO_B:M-20427/);
    expect(r.outcome.message).toMatch(/Nothing was attached/);
    expect(r.outcome.events.map((e) => e.action)).toEqual(["REVIEW_APPROVED", "PAIR_APPROVED", "ATTACH_BLOCKED"]);
    // nothing attached, nothing else changed
    expect(r.master.record_nmc["DEMO_C:4500-319"]).toBeNull();
    expect(r.master.nmcs.find((n) => n.code === code)!.members).toEqual(["DEMO_A:10004107", "DEMO_B:M-20427"]);
    expect(r.master.nmcs.length).toBe(m.nmcs.length);
    expect(r.master.reviews[AC].blocked).not.toBeNull();
    expect(r.master.reviews[AC].blocked!.offending.rule).toBe("R-01");
    expect(JSON.stringify(r.master.run.decisions)).toBe(JSON.stringify(run.decisions));
    // the one continuous audit chain stays valid
    expect(verifyChain(r.master.audit)).toEqual({ ok: true, broken_at: null });
    expect(r.master.audit.length).toBe(run.audit.length + 2 + 3 + 3);
    // a blocked item can still be rejected; the record only gets an identity once nothing else is open
    const rej = applyReviewAction(r.master, AC, "Demo engineer", "reject", ctx);
    expect(rej.master.reviews[AC].status).toBe("rejected");
    expect(rej.master.record_nmc["DEMO_C:4500-319"]).toBeNull(); // still has other open items
  });

  it("approving a pair where one record is in a verified cluster attaches after the check", () => {
    const id = "DEMO_A:10004106~DEMO_B:M-20422"; // Tier E; M-20422 is in a verified cluster
    const target = master0.record_nmc["DEMO_B:M-20422"]!;
    expect(master0.record_nmc["DEMO_A:10004106"]).toBeNull();
    const r = applyReviewAction(master0, id, "Demo analyst", "approve", ctx);
    expect(r.outcome.nmc?.action).toBe("attached");
    expect(r.outcome.nmc?.code).toBe(target);
    expect(r.master.record_nmc["DEMO_A:10004106"]).toBe(target);
    expect(r.master.nmcs.find((n) => n.code === target)!.members).toEqual(["DEMO_A:10004106", "DEMO_B:M-20422", "DEMO_C:4500-315"]);
    expect(r.outcome.events.map((e) => e.action)).toEqual(["REVIEW_APPROVED", "PAIR_APPROVED", "NMC_ATTACHED"]);
  });

  it("attach is blocked by R-08 (same manufacturer, different part number) with another member", () => {
    const id = "DEMO_A:10004110~DEMO_C:4500-320"; // vs M-20430 (same cluster) R-08 fires
    let r = applyReviewAction(master0, id, "Demo analyst", "approve", ctx);
    r = applyReviewAction(r.master, id, "Demo engineer", "approve", ctx);
    expect(r.outcome.blocked?.offending.rule).toBe("R-08");
    expect(r.master.record_nmc["DEMO_A:10004110"]).toBeNull();
  });
});

describe("merging two NMCs", () => {
  it("retires the later-minted NMC with SUPERSEDED_BY the earlier and moves its members", () => {
    const mkr = (matnr: string, maktx: string) => mk({ cpse: "T", matnr, maktx, meins: "EA" });
    const recs = [
      mkr("1", 'FLANGE WN 2" CL150 RF SCH40 A105'),
      mkr("2", "WELD NECK FLG, NPS 2, 150#, RF, S40, ASTM A105"),
      mkr("3", 'FLANGE WN 2" CL150 RF SCH40 A105 VENDOR XQZ'),
      mkr("4", "WELD NECK FLG, NPS 2, 150#, RF, S40, ASTM A105, VENDOR XQZ"),
    ];
    const out = runEngineSync(recs, assets, { scope: "upload", runId: "RUN-M", now: () => NOW });
    expect(out.nmcs.filter((n) => n.kind === "cluster").map((n) => n.members)).toEqual([["T:1", "T:2"], ["T:3", "T:4"]]);
    const review = out.decisions.filter((d) => d.kind === "review");
    expect(review.length).toBeGreaterThan(0);
    const id = review[0].id;
    const m = createMaster(out);
    const r = applyReviewAction(m, id, "Demo analyst", "approve", ctx);
    expect(r.outcome.nmc?.action).toBe("merged");
    const [keep, drop] = out.nmcs.map((n) => n.code);
    expect(r.master.retired).toEqual([{ code: drop, superseded_by: keep }]);
    expect(r.master.nmcs.map((n) => n.code)).toEqual([keep]);
    expect(r.master.nmcs[0].members).toEqual(["T:1", "T:2", "T:3", "T:4"]);
    for (const rid of ["T:1", "T:2", "T:3", "T:4"]) expect(r.master.record_nmc[rid]).toBe(keep);
    expect(r.outcome.events.map((e) => e.action)).toEqual(["REVIEW_APPROVED", "PAIR_APPROVED", "NMC_MERGED"]);
    expect(verifyChain(r.master.audit).ok).toBe(true);
  });
});
