import type { Decision, NmcEntry, RecordView, RunOutput } from "@/engine/types";
import type { FeaturedCase } from "./sampleMeta";

export type RowKind = "group" | "review" | "lookalike" | "unique";

export interface MaterialRow {
  key: string;
  kind: RowKind;
  /** decision this row represents (group: its first verified pair, may be null) */
  decision: Decision | null;
  records: RecordView[]; // group members, pair (left,right), or the single unique record
  nmc: NmcEntry | null; // group or unique identity
  nmcCodes: string[]; // candidate codes to show (distinct)
  cpses: string[];
  featured: FeaturedCase | null;
  searchText: string;
}

const uniq = <T,>(a: T[]) => Array.from(new Set(a));

export function buildRows(run: RunOutput, featured: FeaturedCase[]): MaterialRow[] {
  const rec = new Map(run.records.map((r) => [r.id, r]));
  const nmcByCode = new Map(run.nmcs.map((n) => [n.code, n]));
  const feat = new Map(featured.map((f) => [f.decision_id, f]));

  // first verified decision inside each record (for linking a group to its evidence)
  const verifiedFor = new Map<string, Decision>();
  for (const d of run.decisions) {
    if (d.kind !== "verified") continue;
    if (!verifiedFor.has(d.left)) verifiedFor.set(d.left, d);
    if (!verifiedFor.has(d.right)) verifiedFor.set(d.right, d);
  }
  // featured decision -> the group row that contains it
  const featuredGroup = new Map<string, FeaturedCase>();
  for (const f of featured) {
    const d = run.decisions.find((x) => x.id === f.decision_id);
    if (d?.kind === "verified") {
      const n = rec.get(d.left)?.nmc;
      if (n) featuredGroup.set(n, f);
    }
  }

  const rows: MaterialRow[] = [];
  const mk = (r: Omit<MaterialRow, "searchText" | "cpses">): MaterialRow => {
    const cpses = uniq(r.records.map((x) => x.cpse));
    const search = [
      ...r.records.flatMap((x) => [x.raw, x.id, x.matnr, x.mfr, x.mpn]),
      ...r.nmcCodes,
      r.nmc?.short_text ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return { ...r, cpses, searchText: search };
  };

  for (const n of run.nmcs) {
    if (n.kind !== "cluster") continue;
    const members = n.members.map((id) => rec.get(id)).filter((x): x is RecordView => !!x);
    rows.push(mk({
      key: `g:${n.code}`,
      kind: "group",
      decision: verifiedFor.get(n.members[0]) ?? null,
      records: members,
      nmc: n,
      nmcCodes: [n.code],
      featured: featuredGroup.get(n.code) ?? null,
    }));
  }

  for (const d of run.decisions) {
    if (d.kind === "verified") continue;
    const l = rec.get(d.left);
    const r = rec.get(d.right);
    if (!l || !r) continue;
    rows.push(mk({
      key: `d:${d.id}`,
      kind: d.kind === "review" ? "review" : "lookalike",
      decision: d,
      records: [l, r],
      nmc: null,
      nmcCodes: uniq([l.nmc, r.nmc].filter((x): x is string => !!x)),
      featured: feat.get(d.id) ?? null,
    }));
  }

  for (const r of run.records) {
    if (r.status !== "UNIQUE") continue;
    rows.push(mk({
      key: `u:${r.id}`,
      kind: "unique",
      decision: null,
      records: [r],
      nmc: r.nmc ? nmcByCode.get(r.nmc) ?? null : null,
      nmcCodes: r.nmc ? [r.nmc] : [],
      featured: null,
    }));
  }
  return rows;
}
