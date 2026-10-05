/**
 * Pure helpers for the decision workflow (Match Review, Evidence Certificate, Governance).
 * Nothing here decides anything: it only reads RunOutput / MasterState and phrases it for people.
 */
import type { AuditEvent, Decision, MasterState, ReasonCode, ReviewItem, RuleId } from "@/engine/types";
import type { StatusKind } from "@/components/StatusPill";

/** What a person has done (or the rules did) with a decision, next to the engine's own zone. */
export type HumanState = "verified" | "lookalike" | "open" | "approved" | "rejected" | "blocked";

export function humanState(master: MasterState, d: Decision): HumanState {
  if (d.kind === "verified") return "verified";
  if (d.kind === "lookalike") return "lookalike";
  const item = master.reviews[d.id];
  if (!item || item.status === "open") return "open";
  if (item.status === "rejected") return "rejected";
  return item.blocked ? "blocked" : "approved";
}

export const HUMAN_PILL: Record<HumanState, { kind: StatusKind; label: string }> = {
  verified: { kind: "verified", label: "Verified" },
  lookalike: { kind: "reject", label: "Blocked look-alike" },
  open: { kind: "review", label: "Needs review" },
  approved: { kind: "verified", label: "Approved" },
  rejected: { kind: "reject", label: "Rejected" },
  blocked: { kind: "reject", label: "Join blocked" },
};

export type FilterId = "all" | "open" | "approved" | "rejected" | "blocked" | "lookalike" | "verified";

export const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: "open", label: "Needs review" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "blocked", label: "Join blocked" },
  { id: "lookalike", label: "Blocked look-alikes" },
  { id: "verified", label: "Verified" },
  { id: "all", label: "All" },
];

export function isFilterId(x: string | null | undefined): x is FilterId {
  return !!x && FILTERS.some((f) => f.id === x);
}

export interface ReviewCounts {
  open: number;
  approved: number;
  rejected: number;
  blocked: number;
  lookalike: number;
  verified: number;
  all: number;
}

export function reviewCounts(master: MasterState): ReviewCounts {
  const c: ReviewCounts = { open: 0, approved: 0, rejected: 0, blocked: 0, lookalike: 0, verified: 0, all: 0 };
  for (const d of master.run.decisions) {
    c[humanState(master, d)]++;
    c.all++;
  }
  return c;
}

export const needsEngineer = (item: ReviewItem | undefined): boolean =>
  !!item && item.status === "open" && item.approvals_required === 2 && !item.approvals.some((a) => a.actor === "Demo engineer");

/** Open items: engineer-needed first, closest to done first, then Tier R, then id (stable). */
export function compareOpen(master: MasterState, a: Decision, b: Decision): number {
  const ia = master.reviews[a.id];
  const ib = master.reviews[b.id];
  const ea = needsEngineer(ia) && ia.approvals.length > 0 ? 0 : 1;
  const eb = needsEngineer(ib) && ib.approvals.length > 0 ? 0 : 1;
  if (ea !== eb) return ea - eb;
  const na = needsEngineer(ia) ? 0 : 1;
  const nb = needsEngineer(ib) ? 0 : 1;
  if (na !== nb) return na - nb;
  if (a.tier !== b.tier) return a.tier === "R" ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The ordered list the queue shows (and Previous / Next walk through). Featured cases come first. */
export function listDecisions(master: MasterState, filter: FilterId, featuredIds: string[] = []): Decision[] {
  const list = master.run.decisions.filter((d) => filter === "all" || humanState(master, d) === filter);
  const rank = new Map(featuredIds.map((id, i) => [id, i]));
  return [...list].sort((a, b) => {
    const fa = rank.has(a.id) ? rank.get(a.id)! : Infinity;
    const fb = rank.has(b.id) ? rank.get(b.id)! : Infinity;
    if (fa !== fb) return fa - fb;
    if (filter === "open") return compareOpen(master, a, b);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ------------------------------------------------------------------------- reasons for rejecting
export const REASON_OPTIONS: Array<{ code: ReasonCode; label: string }> = [
  { code: "CRIT_CONFLICT", label: "Critical attribute differs" },
  { code: "LESS_SPECIFIC_UNRESOLVED", label: "Still too vague" },
  { code: "RESIDUAL_DIFFERENCE", label: "Unexplained difference" },
  { code: "INSUFFICIENT_INFO", label: "Not enough information" },
  { code: "DIFFERENT_MFR_PART", label: "Different manufacturer part" },
  { code: "WRONG_CLASS", label: "Wrong class" },
  { code: "OTHER", label: "Other" },
];

export const reasonLabel = (code: ReasonCode | string): string => REASON_OPTIONS.find((r) => r.code === code)?.label ?? code;

// ------------------------------------------------------------------------- the zone, in words
const STEP_WORDS: Record<number, string> = {
  1: "A critical attribute differs but the manufacturer part number matches, so a person looks at it.",
  2: "A critical attribute differs, so the pair is rejected and never merged.",
  3: "A risk word or an unrecognised value is present, so a person looks at it.",
  4: "Same manufacturer and the same part number, which counts as proof.",
  5: "Very little in common and nothing critical agrees, so the pair is rejected.",
  6: "This is an engineered item (Tier R) or sits outside the templated classes, so an engineer always checks it.",
  7: "Something is vague, missing, unexplained or rests on an unverified table, so a person looks at it.",
  8: "Every critical attribute agrees and the model score clears its measured threshold.",
  9: "No earlier step settled it, so a person looks at it.",
};

export const stepWords = (n: number): string => STEP_WORDS[n] ?? "";

/**
 * The rule(s) that explain the decision, following the order in decide.ts. For an engineered item (step 6) the engine
 * stops at the Tier R policy, but the useful answer to "what was wrong with this pair?" is the first review rule that
 * fired (e.g. R-02, too vague), so that is named; the step-6 policy is still stated in words beside it.
 * Empty when only a policy or score decided.
 */
export function decidingRules(d: Decision): RuleId[] {
  const fired = new Set(d.rules.filter((r) => r.fired).map((r) => r.id));
  const pick = (...ids: RuleId[]) => ids.filter((i) => fired.has(i));
  switch (d.zone_step) {
    case 1: return pick("R-01", "R-07");
    case 2: return pick("R-01");
    case 3: return pick("R-05", "R-06");
    case 4: return pick("R-07");
    case 6:
    case 7: return pick("R-02", "R-03", "R-04", "R-08", "R-09").slice(0, 1);
    default: return [];
  }
}

export const POLICY_TITLE: Record<number, string> = {
  5: "Very low score",
  6: "Engineered item (Tier R)",
  8: "Score clears threshold",
  9: "No earlier step settled it",
};

export const outcomeWord = (zone: Decision["zone"]): "AUTO" | "REVIEW" | "REJECT" =>
  zone === "AUTO_MERGE" ? "AUTO" : zone === "REVIEW" ? "REVIEW" : "REJECT";

// ------------------------------------------------------------------------- audit trail
export interface AuditGroup {
  kind: "auto" | "event";
  events: AuditEvent[];
}

/** Runs of automatic DECISION_RECORDED events collapse into one group; runs of every other event form a plain group. */
export function groupAudit(events: AuditEvent[]): AuditGroup[] {
  const runs: AuditGroup[] = [];
  for (const e of events) {
    const auto = e.action === "DECISION_RECORDED";
    const last = runs[runs.length - 1];
    if (last && (last.kind === "auto") === auto) last.events.push(e);
    else runs.push({ kind: auto ? "auto" : "event", events: [e] });
  }
  // a lone automatic record is not worth a collapsible: fold it into its neighbours
  const out: AuditGroup[] = [];
  for (const g of runs) {
    const plain: AuditGroup = g.kind === "auto" && g.events.length < 2 ? { kind: "event", events: g.events } : g;
    const last = out[out.length - 1];
    if (last && last.kind === "event" && plain.kind === "event") last.events.push(...plain.events);
    else out.push(plain);
  }
  return out;
}

export function payloadText(p: AuditEvent["payload"]): string {
  return Object.entries(p).map(([k, v]) => `${k}: ${String(v)}`).join(" · ");
}

export const REVIEWER_ACTIONS = new Set(["REVIEW_APPROVED", "REVIEW_REJECTED", "PAIR_APPROVED", "ATTACH_BLOCKED", "NMC_ATTACHED", "NMC_MERGED", "SINGLETON_MINTED"]);

const ACTION_WORDS: Record<string, string> = {
  RUN_STARTED: "Run started",
  RUN_FINISHED: "Run finished",
  DECISION_RECORDED: "Decision recorded by the rules",
  NMC_MINTED: "National code created",
  NMC_ATTACHED: "Record attached to a code",
  NMC_MERGED: "Two codes merged",
  SINGLETON_MINTED: "Code created for a lone record",
  REVIEW_APPROVED: "Approval given",
  REVIEW_REJECTED: "Pair rejected by a reviewer",
  PAIR_APPROVED: "Final approval reached",
  ATTACH_BLOCKED: "Join refused by the safety check",
};
export const actionWords = (a: string): string => ACTION_WORDS[a] ?? a.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

// ------------------------------------------------------------------------- certificates
let certCounter = 0;
const certIds = new Map<string, string>();

/** CERT-0001, CERT-0002 ... per session. A decision keeps its id while the page stays open. */
export function certificateIdFor(decisionId: string): string {
  let id = certIds.get(decisionId);
  if (!id) {
    certCounter += 1;
    id = `CERT-${String(certCounter).padStart(4, "0")}`;
    certIds.set(decisionId, id);
  }
  return id;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "not recorded";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" });
}

/** The records of a decision whose approval flow is the "chain trap" demonstration. */
export const CHAIN_TRAP_IDS = ["DEMO_A:10004107~DEMO_B:M-20427", "DEMO_A:10004107~DEMO_C:4500-319"] as const;
