/**
 * Deterministic, idempotent text normalization: port of backend/sama/normalize.py.
 * Pass 1 is class-independent; pass 2 applies class-specific rules after classification.
 */
import type { ConfigAsset, Transform } from "./types";
import { collapseSpaces, pyEscape, pyre, pySplit, pyStrip, sub, subLit } from "./pyre";

const CONTROL = /[\x00-\x1f\x7f]/gu;
const FRACTION_SLASH = pyre(String.raw`(?<!\d)/|/(?!\d)`);
const SEPARATORS = /[,;:()\[\]]/gu;
const DOT_NOT_DECIMAL = pyre(String.raw`(?<!\d)\.|\.(?!\d)`);
const GRADE_HYPHEN = pyre(String.raw`\b(A\d{2,3})-(?=[A-Z])`);
const INCH = pyre(String.raw`(?<![\w/-])(\d+(?:-\d+/\d+)?|\d+/\d+)\s*(?:\"|''|INCHES\b|INCH\b|IN\b)`);
const NPS_IN = pyre(String.raw`\bNPS\s*(\d+(?:-\d+/\d+)?|\d+/\d+)\s+IN\b`);
const STRAY_HASH = pyre(String.raw`(?<=\d)#`);
const M_THREAD = pyre(String.raw`\b(M\d{1,2}) ?X ?(\d{2,4})\b`);
const DN_RX = pyre(String.raw`\bDN\s?(\d+)\b|\b(\d+)\s?NB\b`);
const MM_RX = pyre(String.raw`\b(\d+)\s?MM\b`);

type Rule = [string, RegExp, string];

interface Compiled {
  abbr: Rule[];
  byClass: Record<string, Rule[]>;
  pclass: Rule[];
  sched: Rule[];
  dnToNps: Record<string, string>;
}

const compiledCache = new WeakMap<ConfigAsset, Compiled>();

function compiled(cfg: ConfigAsset): Compiled {
  let c = compiledCache.get(cfg);
  if (c) return c;
  const abbrT = cfg.tables.abbreviations;
  const abbr: Rule[] = (abbrT.global as any[]).map((a) => [a.id, pyre(a.pattern), a.replace]);
  const byClass: Record<string, Rule[]> = {};
  for (const [k, v] of Object.entries((abbrT.by_class ?? {}) as Record<string, any[]>)) {
    byClass[k] = v.map((a) => [a.id, pyre(a.pattern), a.replace] as Rule);
  }
  const aliasRules = (prefix: string, table: Record<string, string[]>): Rule[] => {
    const pairs: Array<[string, string]> = [];
    for (const [canon, aliases] of Object.entries(table)) for (const alias of aliases) pairs.push([alias, canon]);
    pairs.sort((p, q) => [...q[0]].length - [...p[0]].length); // longest alias first (stable)
    return pairs
      .filter(([alias, canon]) => alias !== canon)
      .map(([alias, canon]) => [`${prefix}-${canon}`, pyre(`(?<![A-Z0-9])${pyEscape(alias)}(?![A-Z0-9])`), canon] as Rule);
  };
  const units = cfg.tables.units;
  const dnToNps: Record<string, string> = {};
  for (const [nps, dn] of Object.entries(units.nps_dn as Record<string, number>)) dnToNps[String(dn)] = nps;
  c = {
    abbr,
    byClass,
    pclass: aliasRules("U-PC", units.pressure_class_aliases),
    sched: aliasRules("U-SCH", units.schedule_spelling),
    dnToNps,
  };
  compiledCache.set(cfg, c);
  return c;
}

function step(text: string, next: string, ruleId: string, log: Transform[]): string {
  if (next !== text) log.push({ rule_id: ruleId, before: text, after: next });
  return next;
}

function has(o: Record<string, string>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export function normalizePass1(text: string, cfg: ConfigAsset, log: Transform[] = []): string {
  const { abbr, pclass, sched, dnToNps } = compiled(cfg);
  let t = text;
  t = step(t, t.normalize("NFKC").replace(CONTROL, " ").toUpperCase(), "N-001", log);
  t = step(t, sub(GRADE_HYPHEN, t, (m) => m[1] + " "), "N-002", log);
  t = step(t, sub(INCH, t, (m) => m[1] + " IN "), "U-003", log); // before separators eat the quote marks
  t = step(t, subLit(FRACTION_SLASH, t, " ").replace(SEPARATORS, " "), "N-003", log);
  t = step(t, subLit(DOT_NOT_DECIMAL, t, " "), "N-004", log);
  t = pyStrip(collapseSpaces(t));
  for (const [rid, rx, rep] of abbr) t = step(t, subLit(rx, t, rep), rid, log);
  for (const [rid, rx, rep] of pclass) t = step(t, subLit(rx, t, rep), rid, log);
  for (const [rid, rx, rep] of sched) t = step(t, subLit(rx, t, rep), rid, log);
  t = step(
    t,
    sub(DN_RX, t, (m) => {
      const nps = dnToNps[(m[1] || m[2]) as string];
      return nps ? `NPS ${nps}` : m[0]; // unknown DN stays as written
    }),
    "U-DN",
    log,
  );
  t = step(t, sub(NPS_IN, t, (m) => `NPS ${m[1]}`), "U-004", log);
  t = step(t, subLit(STRAY_HASH, t, ""), "N-005", log);
  t = step(t, sub(M_THREAD, t, (m) => `${m[1]} X ${m[2]}`), "N-006", log);
  return pyStrip(collapseSpaces(t));
}

const PASS2_MM_CLASSES = ["11", "12", "13"];

export function normalizePass2(text: string, classCode: string, cfg: ConfigAsset, log: Transform[] = []): string {
  const { byClass, dnToNps } = compiled(cfg);
  let t = text;
  const rules = byClass[classCode] ?? byClass["default"] ?? [];
  for (const [rid, rx, rep] of rules) t = step(t, subLit(rx, t, rep), rid, log);
  if (PASS2_MM_CLASSES.includes(classCode.slice(0, 2))) {
    t = step(
      t,
      sub(MM_RX, t, (m) => {
        const nps = dnToNps[m[1]];
        return nps ? `NPS ${nps}` : m[0];
      }),
      "U-MM",
      log,
    );
  }
  return pyStrip(collapseSpaces(t));
}

export function normalizeUom(meins: string, cfg: ConfigAsset): string {
  const u = pyStrip(meins || "").toUpperCase();
  const syn = cfg.tables.units.uom_synonyms as Record<string, string>;
  return has(syn, u) ? syn[u] : u;
}

export interface NormRecord {
  record_id: string;
  norm_text: string;
  tokens: string[];
  uom_norm: string;
  transforms: Transform[];
}

export function normalizeRecord(raw: { record_id: string; maktx: string; long_text?: string; meins?: string }, cfg: ConfigAsset): NormRecord {
  const log: Transform[] = [];
  const text = !raw.long_text ? raw.maktx : `${raw.maktx} ${raw.long_text}`;
  const t = normalizePass1(text, cfg, log);
  return { record_id: raw.record_id, norm_text: t, tokens: pySplit(t), uom_norm: normalizeUom(raw.meins ?? "", cfg), transforms: log };
}

export function applyPass2(norm: NormRecord, classCode: string, cfg: ConfigAsset): NormRecord {
  const log = [...norm.transforms];
  const t = normalizePass2(norm.norm_text, classCode, cfg, log);
  return { ...norm, norm_text: t, tokens: pySplit(t), transforms: log };
}

