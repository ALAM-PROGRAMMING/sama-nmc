/** Registry helpers: pure functions over the current master state. */
import type { Decision, MasterState, NmcEntry, RecordView } from "@/engine/types";

export interface IdentityRow {
  nmc: NmcEntry;
  className: string;
  legacyCount: number;
  cpses: string[];
  /** created or extended by a reviewer decision during this session */
  change: "created" | "extended" | null;
  searchText: string;
}

export function recordIndex(master: MasterState): Map<string, RecordView> {
  return new Map(master.run.records.map((r) => [r.id, r]));
}

export function buildIdentityRows(master: MasterState): IdentityRow[] {
  const rec = recordIndex(master);
  const original = new Map(master.run.nmcs.map((n) => [n.code, n]));
  return master.nmcs.map((n) => {
    const members = n.members.map((id) => rec.get(id)).filter((r): r is RecordView => !!r);
    const className = members[0]?.class_name ?? n.class_code;
    const orig = original.get(n.code);
    const change = !orig ? "created" : orig.members.join("|") !== n.members.join("|") ? "extended" : null;
    const cpses = Array.from(new Set(members.map((r) => r.cpse)));
    return {
      nmc: n,
      className,
      legacyCount: n.members.length,
      cpses,
      change,
      searchText: [n.code, n.short_text, className, n.class_code, ...members.flatMap((r) => [r.matnr, r.id, r.raw, r.cpse])].join(" ").toLowerCase(),
    };
  });
}

export interface PendingItem {
  record: RecordView;
  decision: Decision | null;
}

/** Records in review that have no NMC yet, each with a decision that involves them when one exists. */
export function buildPending(master: MasterState): PendingItem[] {
  const firstReview = new Map<string, Decision>();
  for (const d of master.run.decisions) {
    if (d.kind !== "review") continue;
    if (!firstReview.has(d.left)) firstReview.set(d.left, d);
    if (!firstReview.has(d.right)) firstReview.set(d.right, d);
  }
  return master.run.records
    .filter((r) => r.status === "REVIEW" && !master.record_nmc[r.id])
    .map((r) => ({ record: r, decision: firstReview.get(r.id) ?? null }));
}

export interface CrosswalkEntry {
  record: RecordView;
  /** the decision that links this record to the rest of the identity (verified, or approved by a reviewer) */
  decision: Decision | null;
  how: "verified" | "approved" | "unique";
}

/** Crosswalk and evidence for one identity. */
export function crosswalkFor(
  master: MasterState,
  nmc: NmcEntry,
): { entries: CrosswalkEntry[]; evidence: Array<{ decision: Decision; how: "verified" | "approved" }> } {
  const rec = recordIndex(master);
  const members = new Set(nmc.members);
  const approved = new Set(master.approved_pairs);
  const evidence: Array<{ decision: Decision; how: "verified" | "approved" }> = [];
  for (const d of master.run.decisions) {
    if (!members.has(d.left) || !members.has(d.right)) continue;
    if (d.kind === "verified") evidence.push({ decision: d, how: "verified" });
    else if (approved.has(d.id)) evidence.push({ decision: d, how: "approved" });
  }
  const entries: CrosswalkEntry[] = nmc.members
    .map((id) => rec.get(id))
    .filter((r): r is RecordView => !!r)
    .map((record) => {
      const ev = evidence.find((e) => e.decision.left === record.id || e.decision.right === record.id);
      return {
        record,
        decision: ev?.decision ?? null,
        how: ev ? ev.how : nmc.members.length > 1 ? "verified" : "unique",
      };
    });
  return { entries, evidence };
}
