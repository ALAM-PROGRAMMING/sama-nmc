/**
 * Governance (maker-checker) and master-layer operations in the browser: PRD FR-GOV-04/09, FR-NMC-07,
 * FR-CLU-04. A reviewer action NEVER changes rules, the frozen gate, thresholds or the zone of a
 * decision (the decision objects are never touched). Identity changes happen only after a pair is
 * finally approved (I-18), and only after the membership check (I-19): between the incoming record
 * and EVERY current member of the target NMC(s), rules R-01 and R-08 are checked; a pair the reviewer
 * approved is exempt. All functions return NEW state; nothing is mutated in place.
 */
import { AuditChain } from "./audit";
import { compareRecords, evaluateRules, residualDiff } from "./decide";
import { attributeLabel, prettyValue } from "./explain";
import { goldenRecord, renderTexts, formatNmc, pyHead } from "./nmc";
import { pyCmp } from "./pyre";
import type {
  Actor, AuditEvent, CompareRow, ConfigAsset, Decision, EngineAssets, MasterState, NmcEntry, ReasonCode, RecordView,
  ReviewItem, ReviewOutcome, RuleId, RuleOutcome, RunOutput,
} from "./types";

// ---------------------------------------------------------------- assets registry
let registered: EngineAssets | null = null;

/** Register the loaded engine assets once (main thread). Master operations need the class templates. */
export function registerAssets(assets: EngineAssets): void {
  registered = assets;
}

export function getRegisteredAssets(): EngineAssets | null {
  return registered;
}

// ---------------------------------------------------------------- per-run indexes (cached)
interface Index {
  decisions: Map<string, Decision>;
  views: Map<string, RecordView>;
}
const indexCache = new WeakMap<RunOutput, Index>();

function indexOf(run: RunOutput): Index {
  let ix = indexCache.get(run);
  if (!ix) {
    ix = { decisions: new Map(run.decisions.map((d) => [d.id, d])), views: new Map(run.records.map((r) => [r.id, r])) };
    indexCache.set(run, ix);
  }
  return ix;
}

const pairId = (a: string, b: string) => (pyCmp(a, b) <= 0 ? `${a}~${b}` : `${b}~${a}`);

// ---------------------------------------------------------------- creation
export function createMaster(run: RunOutput): MasterState {
  const reviews: Record<string, ReviewItem> = {};
  for (const d of run.decisions) {
    if (d.kind === "review") {
      reviews[d.id] = { decision_id: d.id, status: "open", approvals: [], approvals_required: d.tier === "R" ? 2 : 1, rejection: null, blocked: null };
    }
  }
  const record_nmc: Record<string, string | null> = {};
  for (const r of run.records) record_nmc[r.id] = r.nmc;
  return {
    run, reviews, nmcs: run.nmcs.map((n) => ({ ...n })), retired: [], record_nmc, approved_pairs: [], audit: [...run.audit],
  };
}

// ---------------------------------------------------------------- pair evaluation (rules only, on the fly)
interface PairEval {
  rules: RuleOutcome[];
  comparison: CompareRow[];
}

/** Rules for any two records: the stored decision when there is one, otherwise evaluated from RecordView data. */
function evalPair(run: RunOutput, cfg: ConfigAsset | null, a: string, b: string): PairEval | null {
  const ix = indexOf(run);
  const d = ix.decisions.get(pairId(a, b));
  if (d) return { rules: d.rules, comparison: d.comparison };
  const va = ix.views.get(a);
  const vb = ix.views.get(b);
  if (!va || !vb || !cfg) return null;
  const [l, r] = pyCmp(a, b) <= 0 ? [va, vb] : [vb, va];
  const rows = compareRecords(l, r, cfg);
  return { rules: evaluateRules(l, r, rows, residualDiff(l, r), cfg), comparison: rows };
}

interface Offence {
  left: string;
  right: string;
  rule: RuleId;
  unverifiable?: boolean;
}

/** FR-CLU-04, after-approval variant: only R-01 and R-08 between each incoming record and each member. */
function membershipCheck(run: RunOutput, cfg: ConfigAsset | null, incoming: string[], members: string[], exempt: Set<string>): Offence | null {
  for (const x of incoming) {
    for (const m of members) {
      if (x === m) continue;
      const id = pairId(x, m);
      if (exempt.has(id)) continue;
      const ev = evalPair(run, cfg, x, m);
      const [left, right] = pyCmp(x, m) <= 0 ? [x, m] : [m, x];
      if (!ev) return { left, right, rule: "R-01", unverifiable: true }; // fail closed
      for (const rule of ["R-01", "R-08"] as const) {
        if (ev.rules.some((r) => r.id === rule && r.fired)) return { left, right, rule };
      }
    }
  }
  return null;
}

function describeOffence(master: MasterState, cfg: ConfigAsset | null, o: Offence, incoming: string, nmcCode: string): string {
  const member = o.left === incoming ? o.right : o.left;
  if (o.unverifiable) {
    return `${incoming} was approved, but it could not be checked against ${member} in ${nmcCode}, so nothing was changed.`;
  }
  const ev = evalPair(master.run, cfg, o.left, o.right);
  let why: string;
  if (o.rule === "R-08") {
    why = "they come from the same manufacturer but have different part numbers";
  } else {
    const conflicts = (ev?.comparison ?? []).filter((r) => r.critical && r.state === "conflict");
    why = conflicts.length
      ? conflicts.map((r) => `${attributeLabel(r.property)} differs (${prettyValue(r.property, r.left)} vs ${prettyValue(r.property, r.right)})`).join(", ")
      : "a critical attribute differs";
  }
  return `Approved, but not merged. ${incoming} conflicts with ${member}, which already belongs to ${nmcCode}: ${why}. Nothing was attached, and the record stays pending review. No one can attach a record to an NMC that holds a conflicting member.`;
}

// ---------------------------------------------------------------- NMC helpers
function maxSerial(master: MasterState): number {
  let max = 0;
  for (const c of [...master.nmcs.map((n) => n.code), ...master.retired.map((r) => r.code), ...master.retired.map((r) => r.superseded_by)]) {
    const s = parseInt(c.slice(9, 16), 10);
    if (Number.isFinite(s) && s > max) max = s;
  }
  return max;
}

const serialOf = (code: string) => parseInt(code.slice(9, 16), 10);

function goldenFor(master: MasterState, cfg: ConfigAsset, memberIds: string[]) {
  const ix = indexOf(master.run);
  const views = memberIds.map((id) => ix.views.get(id)!);
  const g = goldenRecord(views.map((v) => ({ record_id: v.id, class_code: v.class_code, attributes: v.attributes })), cfg);
  const [short, long] = renderTexts(views[0].class_code, g, cfg);
  return { golden: g, short, long };
}

function newEntry(code: string, kind: NmcEntry["kind"], members: string[], g: ReturnType<typeof goldenFor>): NmcEntry {
  return {
    code, class_code: code.slice(4, 8), serial: code.slice(9, 16), check_char: code.slice(-1), kind, members, golden: g.golden,
    short_text: g.short, long_text: g.long,
  };
}

const sortIds = (ids: string[]) => [...ids].sort(pyCmp);

// ---------------------------------------------------------------- the reviewer action
export interface ReviewContext {
  now: string;
  reason_code?: ReasonCode;
  /** Engine assets; defaults to the ones passed to `registerAssets`. */
  assets?: EngineAssets;
}

const fail = (master: MasterState, item: ReviewItem | undefined, error: string): { master: MasterState; outcome: ReviewOutcome } => ({
  master,
  outcome: { ok: false, error, status: item ? item.status : "open", message: error, events: [] },
});

function openItemsFor(master: MasterState, rid: string, except: string): boolean {
  const ix = indexOf(master.run);
  for (const item of Object.values(master.reviews)) {
    if (item.decision_id === except) continue;
    const open = item.status === "open" || (item.status === "approved" && item.blocked !== null);
    if (!open) continue;
    const d = ix.decisions.get(item.decision_id);
    if (d && (d.left === rid || d.right === rid)) return true;
  }
  return false;
}

export function applyReviewAction(
  master: MasterState,
  decisionId: string,
  actor: Actor,
  action: "approve" | "reject",
  ctx: ReviewContext,
): { master: MasterState; outcome: ReviewOutcome } {
  const run = master.run;
  const d = indexOf(run).decisions.get(decisionId);
  if (!d) return fail(master, undefined, "That decision was not found in this run.");
  if (d.kind !== "review") {
    return fail(
      master,
      undefined,
      d.kind === "verified"
        ? "This pair was verified automatically by the rules, so it does not need a review."
        : "This pair was rejected by the safety rules. Rejected pairs are never merged and cannot be approved.",
    );
  }
  const item = master.reviews[decisionId];
  if (!item) return fail(master, undefined, "That item is not in the review queue.");
  const assets = ctx.assets ?? registered;
  const cfg = assets ? assets.config : null;

  const isBlocked = item.status === "approved" && item.blocked !== null;
  if (item.status === "rejected") return fail(master, item, "This item has already been rejected.");
  if (item.status === "approved" && !(isBlocked && action === "reject")) {
    return fail(
      master,
      item,
      isBlocked
        ? "This item was approved, but the records could not be joined because of a conflict. Reject it to give the record its own identity."
        : "This item has already been approved.",
    );
  }

  const chain = new AuditChain([...master.audit]);
  const start = chain.events.length;
  const evs = (): AuditEvent[] => chain.events.slice(start);

  // -------- reject: closes the item; writes nothing to the master layer (except FR-NMC-07 singletons)
  if (action === "reject") {
    const reason: ReasonCode = ctx.reason_code ?? "OTHER";
    const nextItem: ReviewItem = { ...item, status: "rejected", rejection: { actor, at: ctx.now, reason_code: reason }, blocked: null };
    chain.append(ctx.now, actor, "REVIEW_REJECTED", "decision", decisionId, { reason_code: reason, tier: d.tier });
    let next: MasterState = {
      ...master,
      reviews: { ...master.reviews, [decisionId]: nextItem },
      approved_pairs: master.approved_pairs.filter((x) => x !== decisionId),
    };
    const minted: string[] = [];
    for (const rid of sortIds([d.left, d.right])) {
      if (next.record_nmc[rid] === null && !openItemsFor(next, rid, decisionId) && cfg) {
        const singleton = mintSingleton(next, cfg, rid);
        next = singleton.state;
        chain.append(ctx.now, actor, "SINGLETON_MINTED", "nmc", singleton.entry.code, { record: rid, decision: decisionId });
        minted.push(singleton.entry.code);
      }
    }
    next = { ...next, audit: chain.events };
    return {
      master: next,
      outcome: {
        ok: true, status: "rejected", events: evs(),
        message: minted.length
          ? "Rejected. These records stay separate. A record with no other open review now has its own identity (NMC)."
          : "Rejected. These records stay separate, and nothing was written to the master layer.",
        nmc: minted.length ? { action: "singleton", code: minted[0], members: [] } : { action: "none", code: null, members: [] },
      },
    };
  }

  // -------- approve
  if (item.approvals.some((a) => a.actor === actor)) {
    return fail(master, item, "The same person cannot approve twice. Switch role to give the second approval.");
  }
  const approvals = [...item.approvals, { actor, at: ctx.now }];
  const required = item.approvals_required;
  chain.append(ctx.now, actor, "REVIEW_APPROVED", "decision", decisionId, { tier: d.tier, approvals: approvals.length, required });
  const distinct = new Set(approvals.map((a) => a.actor));
  const final = approvals.length >= required && distinct.size >= required && (required < 2 || distinct.has("Demo engineer"));
  if (!final) {
    const needEngineer = required === 2 && !distinct.has("Demo engineer");
    const nextItem: ReviewItem = { ...item, approvals };
    return {
      master: { ...master, reviews: { ...master.reviews, [decisionId]: nextItem }, audit: chain.events },
      outcome: {
        ok: true, status: "open", events: evs(),
        message: needEngineer || required === 2
          ? `Approval ${approvals.length} of ${required} recorded. Engineered items need a second person, including an engineer.`
          : `Approval ${approvals.length} of ${required} recorded.`,
      },
    };
  }

  chain.append(ctx.now, actor, "PAIR_APPROVED", "decision", decisionId, { tier: d.tier, approvers: approvals.map((a) => a.actor).join(",") });
  const approvedItem: ReviewItem = { ...item, status: "approved", approvals, blocked: null };
  const approved_pairs = master.approved_pairs.includes(decisionId) ? master.approved_pairs : [...master.approved_pairs, decisionId];
  let next: MasterState = { ...master, reviews: { ...master.reviews, [decisionId]: approvedItem }, approved_pairs };

  if (!cfg) {
    return fail(master, item, "The engine files are not loaded yet, so the approval could not be applied. Please try again in a moment.");
  }
  const exempt = new Set(next.approved_pairs);
  const ix = indexOf(run);
  const l = d.left;
  const r = d.right;
  if (ix.views.get(l)!.class_code !== ix.views.get(r)!.class_code) {
    return blocked(next, chain, evs, d, actor, ctx.now, approvedItem, { left: l, right: r, rule: "R-01" }, null,
      "Approved, but not merged: these records are in different material classes, so they cannot share one NMC. Nothing was changed.");
  }
  const nl = next.record_nmc[l];
  const nr = next.record_nmc[r];

  // (a) neither record has an NMC: mint a new one for the pair
  if (nl === null && nr === null) {
    const members = sortIds([l, r]);
    const code = formatNmcFor(next, ix.views.get(l)!.class_code);
    const entry = newEntry(code, "cluster", members, goldenFor(next, cfg, members));
    next = { ...next, nmcs: [...next.nmcs, entry], record_nmc: { ...next.record_nmc, [l]: code, [r]: code } };
    chain.append(ctx.now, actor, "NMC_MINTED", "nmc", code, { kind: "cluster", members: members.length, decision: decisionId });
    next = { ...next, audit: chain.events };
    return {
      master: next,
      outcome: { ok: true, status: "approved", events: evs(), nmc: { action: "minted", code, members },
        message: `Approved. A new identity ${code} was created for these two records.` },
    };
  }

  // (b) exactly one has an NMC: check the other against every member, then attach
  if ((nl === null) !== (nr === null)) {
    const code = (nl ?? nr) as string;
    const incoming = nl === null ? l : r;
    const target = next.nmcs.find((n) => n.code === code)!;
    const off = membershipCheck(run, cfg, [incoming], target.members, exempt);
    if (off) return blocked(next, chain, evs, d, actor, ctx.now, approvedItem, off, code, describeOffence(next, cfg, off, incoming, code), incoming);
    const members = sortIds([...target.members, incoming]);
    const entry = newEntry(code, "cluster", members, goldenFor(next, cfg, members));
    next = { ...next, nmcs: next.nmcs.map((n) => (n.code === code ? entry : n)), record_nmc: { ...next.record_nmc, [incoming]: code } };
    chain.append(ctx.now, actor, "NMC_ATTACHED", "nmc", code, { record: incoming, decision: decisionId, members: members.length });
    next = { ...next, audit: chain.events };
    return {
      master: next,
      outcome: { ok: true, status: "approved", events: evs(), nmc: { action: "attached", code, members },
        message: `Approved. ${incoming} was checked against every member of ${code} and attached.` },
    };
  }

  // both have an NMC
  if (nl === nr) {
    next = { ...next, audit: chain.events };
    return {
      master: next,
      outcome: { ok: true, status: "approved", events: evs(), nmc: { action: "none", code: nl, members: next.nmcs.find((n) => n.code === nl)?.members ?? [] },
        message: `Approved. Both records already share ${nl}, so no identity change was needed.` },
    };
  }
  // (c) different NMCs: cross-check every member pair, then retire the later-minted one
  const e1 = next.nmcs.find((n) => n.code === nl)!;
  const e2 = next.nmcs.find((n) => n.code === nr)!;
  const [keep, drop] = serialOf(e1.code) <= serialOf(e2.code) ? [e1, e2] : [e2, e1];
  const off = membershipCheck(run, cfg, drop.members, keep.members, exempt);
  if (off) {
    const incoming = drop.members.includes(off.left) ? off.left : off.right;
    return blocked(next, chain, evs, d, actor, ctx.now, approvedItem, off, keep.code, describeOffence(next, cfg, off, incoming, keep.code), incoming);
  }
  const members = sortIds([...keep.members, ...drop.members]);
  const merged = newEntry(keep.code, "cluster", members, goldenFor(next, cfg, members));
  const record_nmc = { ...next.record_nmc };
  for (const m of drop.members) record_nmc[m] = keep.code;
  next = {
    ...next,
    nmcs: next.nmcs.filter((n) => n.code !== drop.code).map((n) => (n.code === keep.code ? merged : n)),
    retired: [...next.retired, { code: drop.code, superseded_by: keep.code }],
    record_nmc,
  };
  chain.append(ctx.now, actor, "NMC_MERGED", "nmc", keep.code, { retired: drop.code, superseded_by: keep.code, decision: decisionId, members: members.length });
  next = { ...next, audit: chain.events };
  return {
    master: next,
    outcome: { ok: true, status: "approved", events: evs(), nmc: { action: "merged", code: keep.code, members, retired: [drop.code] },
      message: `Approved. ${drop.code} was retired and replaced by ${keep.code}, the earlier identity, after every member pair was checked.` },
  };
}

function formatNmcFor(master: MasterState, classCode: string): string {
  return formatNmc(classCode, maxSerial(master) + 1);
}

function blocked(
  next: MasterState, chain: AuditChain, evs: () => AuditEvent[], d: Decision, actor: Actor, now: string, approvedItem: ReviewItem,
  off: Offence, nmcCode: string | null, message: string, incoming?: string,
): { master: MasterState; outcome: ReviewOutcome } {
  const info = { reason: message, offending: { left: off.left, right: off.right, rule: off.rule } };
  chain.append(now, actor, "ATTACH_BLOCKED", "decision", d.id, {
    incoming: incoming ?? d.left, member: (incoming ?? d.left) === off.left ? off.right : off.left, rule: off.rule, nmc: nmcCode ?? "",
  });
  const item: ReviewItem = { ...approvedItem, blocked: info };
  const master: MasterState = { ...next, reviews: { ...next.reviews, [d.id]: item }, audit: chain.events };
  return { master, outcome: { ok: true, status: "approved", events: evs(), blocked: info, message, nmc: { action: "none", code: nmcCode, members: [] } } };
}

function mintSingleton(master: MasterState, cfg: ConfigAsset, rid: string): { state: MasterState; entry: NmcEntry } {
  const v = indexOf(master.run).views.get(rid)!;
  const code = formatNmcFor(master, v.class_code);
  const tmpl = cfg.classes[v.class_code];
  let entry: NmcEntry;
  if (tmpl && tmpl.properties.length) {
    entry = newEntry(code, "singleton", [rid], goldenFor(master, cfg, [rid]));
  } else {
    entry = {
      code, class_code: code.slice(4, 8), serial: code.slice(9, 16), check_char: code.slice(-1), kind: "singleton", members: [rid],
      golden: { attributes: {}, conflicts: {} }, short_text: pyHead(v.raw, 40), long_text: v.raw,
    };
  }
  return { state: { ...master, nmcs: [...master.nmcs, entry], record_nmc: { ...master.record_nmc, [rid]: code } }, entry };
}
