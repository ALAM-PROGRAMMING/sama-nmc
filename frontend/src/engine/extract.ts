/**
 * Attribute extraction with match spans, sanity flags, size resolution and classified residuals:
 * port of backend/sama/extract.py. A value read but not recognised is kept as `raw_value` with
 * `value = null`, so compare treats it as missing and it can never produce a conflict.
 */
import type { Attribute, ConfigAsset, RawRecord, Residuals, SanityFlag, SanityType, Tier } from "./types";
import type { ClassResult } from "./classify";
import type { NormRecord } from "./normalize";
import { collapseSpaces, finditer, pyEscape, pyIntDigits, pyLen, pyre, pyRstrip, pyStrip, search, sortedStrings } from "./pyre";

const FRAC = String.raw`\d+-\d+/\d+|\d+/\d+|\d+`; // longest alternative first: 1-1/2, 1/2, 2

/** Minimal record interface used by compare / rules: satisfied by RecAttrs and by RecordView. */
export interface RecordLike {
  class_code: string;
  tier: Tier;
  attributes: Record<string, Attribute>;
  residuals: Residuals;
  sanity_flags: SanityFlag[];
  mfr_norm: string;
  mpn_norm: string;
}

export interface RecAttrs extends RecordLike {
  record_id: string;
  class_confidence: number;
  abstained: boolean;
  tier_reasons: string[];
  tables_used: string[];
}

interface XHit {
  value: string | null; // canonical value, null when not recognised
  raw: string;
  start: number;
  end: number;
  rule_id: string;
  sanity: SanityType | null;
}

const hit = (value: string | null, raw: string, start: number, end: number, rule_id: string, sanity: SanityType | null = null): XHit => ({
  value,
  raw,
  start,
  end,
  rule_id,
  sanity,
});

type Extractor = (text: string, cfg: ConfigAsset) => XHit[];

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// ---------------------------------------------------------------- extractors
const xSizeNps: Extractor = (text, cfg) => {
  const known = cfg.tables.units.nps_dn as Record<string, number>;
  const out: XHit[] = [];
  for (const [rid, src] of [
    ["X-SIZE-01", String.raw`\bNPS (${FRAC})\b`],
    ["X-SIZE-02", String.raw`(?<![\w/-])(${FRAC}) IN\b`],
  ] as const) {
    for (const h of finditer(pyre(src), text)) {
      const v = h.m[1];
      const ok = has(known, v);
      out.push(hit(ok ? v : null, v, h.start, h.end, rid, ok ? null : "out_of_range"));
    }
  }
  return out;
};

const xPressureClass: Extractor = (text, cfg) => {
  const known = new Set<string>([...Object.keys(cfg.tables.units.pressure_class_aliases), "CL900", "CL1500", "CL2500"]);
  return finditer(pyre(String.raw`\bCL\d+\b`), text).map((h) => {
    const v = h.m[0];
    return hit(known.has(v) ? v : null, v, h.start, h.end, "X-PC-01", known.has(v) ? null : "not_allowed");
  });
};

const FACES: Record<string, string> = { RF: "RF", FF: "FF", RTJ: "RTJ", "RAISED FACE": "RF", "FLAT FACE": "FF", "RING JOINT": "RTJ" };

const xFace: Extractor = (text) =>
  finditer(pyre(String.raw`\b(RAISED FACE|FLAT FACE|RING JOINT|RTJ|RF|FF)\b`), text).map((h) =>
    hit(FACES[h.m[1]], h.m[1], h.start, h.end, "X-FACE-01"),
  );

const xEndConnection: Extractor = (text) =>
  finditer(pyre(String.raw`\b(FLANGED|BUTTWELD|SOCKETWELD|THREADED)(?: ENDS?)?\b`), text).map((h) =>
    hit(h.m[1], h.m[0], h.start, h.end, "X-END-01"),
  );

const xSchedule: Extractor = (text, cfg) => {
  const canon = cfg.tables.units.schedule_spelling as Record<string, string[]>;
  return finditer(pyre(String.raw`\b(SCH\d+S?|STD|XXS|XS|\d0S)\b`), text).map((h) => {
    const v = h.m[1];
    // An unlisted designation (e.g. SCH160) is still a designation: the size table decides its meaning.
    return hit(v, v, h.start, h.end, has(canon, v) ? "X-SCH-01" : "X-SCH-02");
  });
};

const gazetteerCache = new WeakMap<ConfigAsset, Array<[string, RegExp]>>();

function materialGazetteer(cfg: ConfigAsset): Array<[string, RegExp]> {
  let g = gazetteerCache.get(cfg);
  if (g) return g;
  const entries: Array<{ value: string; src: string }> = [];
  for (const [family, leaves] of Object.entries(cfg.tables.hierarchies.material as Record<string, string[]>)) {
    entries.push({ value: family, src: String.raw`\b${pyEscape(family)}\b` });
    for (const leaf of leaves) {
      const m = /^ASTM (A\d+)(?: (GR )?(\S+))?$/u.exec(leaf);
      if (m) {
        const spec = m[1];
        const grade = m[3];
        const body = String.raw`(?:ASTM )?${spec}` + (grade ? String.raw` (?:GR )?${pyEscape(grade)}` : "");
        entries.push({ value: leaf, src: String.raw`\b${body}\b` });
        continue;
      }
      const s = /^SS(\d+L?)$/u.exec(leaf);
      if (s) {
        entries.push({ value: leaf, src: String.raw`\b(?:SS ?|STAINLESS STEEL )${s[1]}\b` });
        continue;
      }
      entries.push({ value: leaf, src: String.raw`\b${pyEscape(leaf)}\b` });
    }
  }
  // most specific (longest Python pattern source) first, so ASTM A216 WCB wins over a bare family word
  entries.sort((a, b) => pyLen(b.src) - pyLen(a.src));
  g = entries.map((e) => [e.value, pyre(e.src)] as [string, RegExp]);
  gazetteerCache.set(cfg, g);
  return g;
}

const GRADE_LIKE = String.raw`\b(?:ASTM )?A\d{2,3}(?: (?:GR )?[A-Z0-9]{1,4}\b)?|\bSS ?\d{3}[A-Z]?\b|\bDUPLEX\b|\bMONEL\b|\bINCONEL\b`;

const xMaterial: Extractor = (text, cfg) => {
  const hits: XHit[] = [];
  const taken: Array<[number, number]> = [];
  for (const [value, rx] of materialGazetteer(cfg)) {
    for (const h of finditer(rx, text)) {
      if (taken.some(([s, e]) => h.start < e && s < h.end)) continue;
      taken.push([h.start, h.end]);
      hits.push(hit(value, h.m[0], h.start, h.end, "X-MAT-01"));
    }
  }
  for (const h of finditer(pyre(GRADE_LIKE), text)) {
    // grade-shaped but not in the table
    if (!taken.some(([s, e]) => h.start < e && s < h.end)) hits.push(hit(null, h.m[0], h.start, h.end, "X-MAT-02", "not_allowed"));
  }
  return hits;
};

const xStandard: Extractor = (text) =>
  finditer(pyre(String.raw`\b(API \d{3}[A-Z]?|ASME B\d+\.\d+M?|NACE MR0175|BS \d{3,4}|IS \d{3,5}|ISO \d{3,5})\b`), text).map((h) =>
    hit(h.m[1], h.m[1], h.start, h.end, "X-STD-01"),
  );

const ENDS: Record<string, string> = {
  PE: "PE", BE: "BE", TE: "TE", "PLAIN END": "PE", "PLAIN ENDS": "PE", "BEVELLED END": "BE",
  "BEVELLED ENDS": "BE", "BEVELED ENDS": "BE", "BEVELED END": "BE", "THREADED END": "TE", "THREADED ENDS": "TE",
};

const xPipeEnds: Extractor = (text) =>
  finditer(pyre(String.raw`\b(PLAIN ENDS?|BEVELL?ED ENDS?|THREADED ENDS?|PE|BE|TE)\b`), text).map((h) =>
    hit(has(ENDS, h.m[1]) ? ENDS[h.m[1]] : h.m[1], h.m[1], h.start, h.end, "X-ENDS-01"),
  );

const xThreadSize: Extractor = (text) =>
  finditer(pyre(String.raw`\bM\d{1,2}\b`), text).map((h) => hit(h.m[0], h.m[0], h.start, h.end, "X-THR-01"));

const xLengthMm: Extractor = (text) => {
  const rx = String.raw`\bX ?(\d{2,4})(?: ?MM)?\b|\b(?:L|LG|LENGTH) (\d{2,4})(?: ?MM)?\b|\b(\d{2,4}) ?MM (?:LONG|LG)\b`;
  return finditer(pyre(rx), text).map((h) => {
    const v = (h.m[1] || h.m[2] || h.m[3]) as string;
    const n = pyIntDigits(v);
    const ok = n >= 10 && n <= 1000;
    return hit(ok ? v : null, h.m[0], h.start, h.end, "X-LEN-01", ok ? null : "out_of_range");
  });
};

const xPropertyClass: Extractor = (text) =>
  finditer(pyre(String.raw`\b(?:(?:GR|PC|CLASS|PROPERTY CLASS) )?(\d{1,2}\.\d)\b`), text).map((h) =>
    hit(h.m[1], h.m[0], h.start, h.end, "X-PCL-01"),
  );

const EXTRACTORS: Record<string, Extractor> = {
  size_nps: xSizeNps, pressure_class: xPressureClass, face: xFace, end_connection: xEndConnection, schedule: xSchedule,
  material_grade: xMaterial, standard: xStandard, pipe_ends: xPipeEnds, thread_size: xThreadSize, length_mm: xLengthMm,
  property_class: xPropertyClass,
};

// ---------------------------------------------------------------- helpers
function charToTokenSpan(text: string, start: number, end: number): [number, number] {
  let first = 0;
  for (let i = 0; i < start; i++) if (text.charCodeAt(i) === 32) first++;
  const head = pyRstrip(text.slice(0, end));
  let last = 0;
  for (let i = 0; i < head.length; i++) if (head.charCodeAt(i) === 32) last++;
  return [first, last + 1];
}

export function isAncestor(cfg: ConfigAsset, hierarchy: string, anc: string, desc: string): boolean {
  const tree = (cfg.tables.hierarchies[hierarchy] ?? {}) as Record<string, string[]>;
  const stack = has(tree, anc) ? [...tree[anc]] : [];
  while (stack.length) {
    const v = stack.pop()!;
    if (v === desc) return true;
    if (has(tree, v)) stack.push(...tree[v]);
  }
  return false;
}

function recognisedInHierarchy(cfg: ConfigAsset, hierarchy: string, value: string): boolean {
  const tree = (cfg.tables.hierarchies[hierarchy] ?? {}) as Record<string, string[]>;
  return has(tree, value) || Object.values(tree).some((leaves) => leaves.includes(value));
}

const riskCache = new WeakMap<ConfigAsset, Array<[string, RegExp]>>();

function riskPatterns(cfg: ConfigAsset): Array<[string, RegExp]> {
  let r = riskCache.get(cfg);
  if (!r) {
    const words = [...(cfg.tables.risk_words.words as string[])].sort((a, b) => pyLen(b) - pyLen(a));
    r = words.map((w) => [w, pyre(`(?<![A-Z0-9])${pyEscape(w)}(?![A-Z0-9])`)] as [string, RegExp]);
    riskCache.set(cfg, r);
  }
  return r;
}

export function resolveSize(cfg: ConfigAsset, nps: string | null | undefined, designation: string | null | undefined): number | null {
  if (!nps || !designation) return null;
  const entries = cfg.tables.schedules.entries as Record<string, Record<string, number>>;
  const row = (has(entries, nps) ? entries[nps] : null) ?? {};
  return has(row, designation) && row[designation] !== null && row[designation] !== undefined ? Number(row[designation]) : null;
}

const MPN_STRIP = pyre(String.raw`[\s\-./]`);

export function normalizeMpn(mpn: string): string {
  return (mpn || "").toUpperCase().replace(MPN_STRIP, "");
}

export function normalizeMfr(mfr: string, cfg: ConfigAsset): string {
  const m = collapseSpaces(pyStrip(mfr || "").toUpperCase());
  const aliases = (cfg.tables.manufacturers.aliases ?? {}) as Record<string, string[]>;
  for (const [canon, al] of Object.entries(aliases)) {
    if (m === canon || al.some((a) => a.toUpperCase() === m)) return canon;
  }
  return m;
}

const emptyResiduals = (): Residuals => ({ ignorable: [], reference: [], unknown: [], risk: [] });

// ---------------------------------------------------------------- main entry
export function extract(raw: RawRecord, norm: NormRecord, cls: ClassResult, cfg: ConfigAsset): RecAttrs {
  const text = norm.norm_text;
  const tokens = norm.tokens;
  const consumed = new Set<number>();
  const attrs: Record<string, Attribute> = {};
  const flags: SanityFlag[] = [];
  const tablesUsed = new Set<string>(["abbreviations", "units"]);
  const addRange = (set: Set<number>, s: number, e: number) => {
    for (let i = s; i < e; i++) set.add(i);
  };

  const tmpl = cfg.classes[cls.class_code];
  if (tmpl && !cls.abstained) {
    // head pattern span: re-find on pass-2 text (pass 2 never touches head words)
    for (const p of tmpl.head_patterns) {
      const h = search(pyre(p), text);
      if (h) {
        const [s, e] = charToTokenSpan(text, h.start, h.end);
        addRange(consumed, s, e);
        break;
      }
    }
    const chars: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.characteristics ?? {})) chars[k.toLowerCase()] = v;
    for (const prop of tmpl.properties) {
      const name = prop.name;
      const fn = EXTRACTORS[prop.extractor];
      const hits = fn(text, cfg);
      for (const h of hits) {
        const [s, e] = charToTokenSpan(text, h.start, h.end);
        addRange(consumed, s, e);
      }
      // allowed-set / hierarchy recognition
      for (const h of hits) {
        if (h.value === null) continue;
        if (prop.allowed && !prop.allowed.includes(h.value)) {
          h.sanity = "not_allowed";
          h.value = null;
        } else if (prop.hierarchy && !recognisedInHierarchy(cfg, prop.hierarchy, h.value)) {
          h.sanity = "not_allowed";
          h.value = null;
        }
      }
      const recognised = hits.filter((h) => h.value !== null);
      for (const h of hits) if (h.sanity) flags.push({ type: h.sanity, prop: name, detail: h.raw });
      let distinct = sortedStrings(new Set(recognised.map((h) => h.value as string)));
      if (prop.hierarchy && distinct.length > 1) {
        // "CARBON STEEL A216 WCB": a family plus its own member is one value, the specific one
        const leaves = distinct.filter((v) => !distinct.some((o) => o !== v && isAncestor(cfg, prop.hierarchy!, v, o)));
        if (leaves.length === 1 && distinct.every((v) => v === leaves[0] || isAncestor(cfg, prop.hierarchy!, v, leaves[0]))) distinct = leaves;
      }
      let attr: Attribute | null = null;
      if (distinct.length > 1) {
        flags.push({ type: "multi_value", prop: name, detail: distinct.join(" / ") });
        attr = { value: null, raw_value: distinct.join(" / "), designation: null, resolved: null, source: "text", rule_id: "SAN-MULTI", confidence: 0.0, span: null };
      } else if (distinct.length === 1) {
        const h = recognised.find((x) => x.value === distinct[0])!;
        attr = {
          value: h.value, raw_value: h.raw, designation: null, resolved: null, source: "text", rule_id: h.rule_id, confidence: 1.0,
          span: charToTokenSpan(text, h.start, h.end),
        };
      } else if (hits.length) {
        const h = hits[0];
        attr = {
          value: null, raw_value: h.raw, designation: null, resolved: null, source: "text", rule_id: h.rule_id, confidence: 0.0,
          span: charToTokenSpan(text, h.start, h.end),
        };
      }
      // characteristics take precedence over text (FR-EXT-02)
      const cv = chars[name];
      if (cv) {
        const cNorm = collapseSpaces(pyStrip(String(cv).toUpperCase()));
        const cHits = fn(cNorm, cfg).filter((h) => h.value !== null);
        const cVal = cHits.length ? (cHits[0].value as string) : cNorm;
        if (attr && attr.value && attr.value !== cVal) {
          flags.push({ type: "internal_conflict", prop: name, detail: `text ${attr.value} vs characteristic ${cVal}` });
        }
        attr = {
          value: cVal, raw_value: String(cv), designation: null, resolved: null, source: "char", rule_id: "X-CHAR-01", confidence: 1.0,
          span: attr ? attr.span : null,
        };
      }
      if (attr !== null) attrs[name] = attr;
      if (prop.hierarchy) tablesUsed.add("hierarchies");
    }
    // size-dependent designations (FR-NORM-05)
    for (const prop of tmpl.properties) {
      if (prop.resolver && has(attrs, prop.name)) {
        const a = attrs[prop.name];
        const nps = has(attrs, "size_nps") ? attrs["size_nps"].value : null;
        attrs[prop.name] = { ...a, designation: a.value, resolved: resolveSize(cfg, nps, a.value) };
        tablesUsed.add("schedules");
      }
    }
  }

  // residuals: risk words are scanned on the WHOLE record, inside spans too
  const residuals = emptyResiduals();
  const riskTokens = new Set<number>();
  for (const [word, rx] of riskPatterns(cfg)) {
    for (const h of finditer(rx, text)) {
      if (!residuals.risk.includes(word)) residuals.risk.push(word);
      const [s, e] = charToTokenSpan(text, h.start, h.end);
      addRange(riskTokens, s, e);
    }
  }
  tablesUsed.add("risk_words");
  for (const ref of cfg.tables.residual_vocab.reference_patterns as Array<{ pattern: string }>) {
    for (const h of finditer(pyre(ref.pattern), text)) {
      const [s, e] = charToTokenSpan(text, h.start, h.end);
      if (consumed.has(s) || riskTokens.has(s)) continue;
      residuals.reference.push(h.m[0]);
      addRange(consumed, s, e);
    }
  }
  const ignorable = new Set<string>(cfg.tables.residual_vocab.ignorable as string[]);
  const alnum = /[A-Z0-9]/;
  tokens.forEach((tok, i) => {
    if (consumed.has(i) || riskTokens.has(i) || !alnum.test(tok)) return;
    (ignorable.has(tok) ? residuals.ignorable : residuals.unknown).push(tok);
  });
  tablesUsed.add("residual_vocab");

  const mfr = normalizeMfr(raw.mfr, cfg);
  if (raw.mfr) tablesUsed.add("manufacturers");
  return {
    record_id: raw.record_id, class_code: cls.class_code, class_confidence: cls.confidence, abstained: cls.abstained,
    tier: "R", tier_reasons: [], attributes: attrs, mfr_norm: mfr, mpn_norm: normalizeMpn(raw.mpn), residuals,
    sanity_flags: flags, tables_used: sortedStrings(tablesUsed),
  };
}

/** `extract.parse_characteristics`: JSON object string -> string map; anything else -> {}. */
export function parseCharacteristics(value: string | Record<string, unknown> | null | undefined): Record<string, string> {
  if (value && typeof value === "object") return value as Record<string, string>;
  if (!value) return {};
  try {
    const o = JSON.parse(value);
    if (o === null || typeof o !== "object" || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) out[String(k)] = typeof v === "string" ? v : pyStr(v);
    return out;
  } catch {
    return {};
  }
}

/** Python `str()` of a JSON value (good enough for scalars; nested values are rare in characteristics). */
function pyStr(v: unknown): string {
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v);
}
