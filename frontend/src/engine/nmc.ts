/**
 * National Material Code: mint, validate, golden record (FR-NMC): port of backend/sama/nmc.py.
 * Format NMC:CCCC-NNNNNNN-K; K is the ISO/IEC 7064 MOD 11-2 check character over CCCC+NNNNNNN.
 */
import type { Attribute, ConfigAsset } from "./types";
import { collapseSpaces, pyLen, pyre, pyStrip, sortedStrings, subLit } from "./pyre";
import { isAncestor } from "./extract";

const NMC_RE = /^NMC:(\d{4})-(\d{7})-([0-9X])$/;

/** ISO/IEC 7064 MOD 11-2. Verified: "000000021825009" -> "7" (ORCID test vector). */
export function mod11_2Check(digits: string): string {
  let p = 0;
  for (const ch of digits) p = ((p + Number(ch)) * 2) % 11;
  const c = (12 - p) % 11;
  return c === 10 ? "X" : String(c);
}

export function formatNmc(classCode: string, serial: number | string): string {
  const s = String(Math.trunc(Number(serial))).padStart(7, "0");
  return `NMC:${classCode}-${s}-${mod11_2Check(classCode + s)}`;
}

export function validateNmc(code: string): boolean {
  const m = NMC_RE.exec(code);
  return !!m && mod11_2Check(m[1] + m[2]) === m[3];
}

/** Globally unique, never reused (a DB sequence in the platform layer; in-memory here). */
export class SerialAllocator {
  private next: number;
  constructor(start = 1) {
    this.next = start;
  }
  mint(classCode: string): string {
    const code = formatNmc(classCode, this.next);
    this.next += 1;
    return code;
  }
  peek(): number {
    return this.next;
  }
}

const SOURCE_RANK: Record<string, number> = { char: 0, text: 1, llm: 2 };

export interface GoldenRecord {
  attributes: Record<string, string | null>;
  conflicts: Record<string, string[]>;
}

interface GoldenMember {
  record_id: string;
  class_code: string;
  attributes: Record<string, Attribute>;
}

/** Survivorship: char > text > llm, then frequency, then completeness (FR-NMC-01); most specific within a hierarchy (FR-NMC-06). */
export function goldenRecord(members: GoldenMember[], cfg: ConfigAsset): GoldenRecord {
  const tmpl = cfg.classes[members[0].class_code];
  const golden: Record<string, string | null> = {};
  const conflicts: Record<string, string[]> = {};
  const completeness = new Map<string, number>();
  for (const m of members) completeness.set(m.record_id, Object.values(m.attributes).filter((a) => a.value !== null).length);
  for (const p of tmpl.properties) {
    const vals: Array<{ a: Attribute; rid: string }> = [];
    for (const m of members) {
      const a = Object.prototype.hasOwnProperty.call(m.attributes, p.name) ? m.attributes[p.name] : undefined;
      if (a !== undefined && a.value !== null) vals.push({ a, rid: m.record_id });
    }
    if (!vals.length) {
      golden[p.name] = null;
      continue;
    }
    const freq = new Map<string, number>();
    for (const { a } of vals) freq.set(a.value as string, (freq.get(a.value as string) ?? 0) + 1);
    let bestV = vals[0];
    const key = (v: { a: Attribute; rid: string }): [number, number, number] => [
      SOURCE_RANK[v.a.source], -(freq.get(v.a.value as string) as number), -(completeness.get(v.rid) as number),
    ];
    for (const v of vals.slice(1)) {
      const k1 = key(v);
      const k0 = key(bestV);
      if (k1[0] < k0[0] || (k1[0] === k0[0] && (k1[1] < k0[1] || (k1[1] === k0[1] && k1[2] < k0[2])))) bestV = v;
    }
    let best = bestV.a.value as string;
    if (p.hierarchy) {
      for (const v of freq.keys()) if (isAncestor(cfg, p.hierarchy, best, v)) best = v; // more specific value wins
    }
    golden[p.name] = best;
    if (freq.size > 1 && !p.critical) conflicts[p.name] = sortedStrings(freq.keys());
  }
  return { attributes: golden, conflicts };
}

/** Python `str.format_map` with a default of "—" for missing keys (only plain {name} fields are used). */
function formatMap(template: string, vals: Record<string, string>): string {
  return template.replace(/\{([^{}]*)\}/g, (_m, k: string) => (Object.prototype.hasOwnProperty.call(vals, k) ? vals[k] : "—"));
}

export function renderTexts(classCode: string, golden: GoldenRecord, cfg: ConfigAsset): [string, string] {
  const tmpl = cfg.classes[classCode];
  const vals: Record<string, string> = {};
  for (const [k, v] of Object.entries(golden.attributes)) vals[k] = v !== null ? v : "—";
  if (!Object.prototype.hasOwnProperty.call(vals, "raw")) vals["raw"] = "";
  let short = pyStrip(collapseSpaces(formatMap(tmpl.short_text_template, vals)));
  let long = formatMap(tmpl.long_text_template, vals);
  long = subLit(pyre(String.raw`;\s*[A-Z ]+ —`), long, ""); // drop properties with no value
  if (pyLen(short) > 40) short = Array.from(short).slice(0, 39).join("") + "…"; // truncated and flagged by the ellipsis
  return [short, long];
}

/** First n code points (Python `s[:n]`). */
export function pyHead(s: string, n: number): string {
  return Array.from(s).slice(0, n).join("");
}
