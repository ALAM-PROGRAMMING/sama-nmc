/**
 * Python `re` -> JavaScript RegExp translator, plus the small Python string helpers the engine needs
 * to behave identically to the reference (backend/sama).
 *
 * Python str patterns are Unicode-aware for \b \w \d \s; JavaScript's are ASCII-only. This module
 * rewrites those escapes into explicit Unicode property classes and compiles with flags `gu`.
 * Pure functions, no DOM globals.
 */

/** Python `str.isspace()` characters (used for \s, split() and strip()). */
const WS_CLASS_BODY = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const W = "\\p{L}\\p{N}_";
const WORD_BOUNDARY = `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}]))`;
const NOT_WORD_BOUNDARY = `(?:(?<=[${W}])(?=[${W}])|(?<![${W}])(?![${W}]))`;

const SYNTAX_CHARS = "^$\\.*+?()[]{}|/";

/** Translate a Python `re` pattern source into a JS pattern source (for flag `u`). */
export function translatePattern(src: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      const n = src[i + 1];
      if (n === undefined) throw new Error("pattern ends with a backslash: " + src);
      i++;
      switch (n) {
        case "b":
          out += inClass ? "\\x08" : WORD_BOUNDARY;
          continue;
        case "B":
          if (inClass) throw new Error("\\B in class: " + src);
          out += NOT_WORD_BOUNDARY;
          continue;
        case "w":
          out += inClass ? W : `[${W}]`;
          continue;
        case "W":
          if (inClass) throw new Error("\\W inside a class is not supported: " + src);
          out += `[^${W}]`;
          continue;
        case "d":
          out += "\\p{Nd}";
          continue;
        case "D":
          out += "\\P{Nd}";
          continue;
        case "s":
          out += inClass ? WS_CLASS_BODY : `[${WS_CLASS_BODY}]`;
          continue;
        case "S":
          if (inClass) throw new Error("\\S inside a class is not supported: " + src);
          out += `[^${WS_CLASS_BODY}]`;
          continue;
        case "A":
          out += "^";
          continue;
        case "Z":
          out += "$";
          continue;
        case "n": case "t": case "r": case "f": case "v":
          out += "\\" + n;
          continue;
        case "x": case "u": case "U":
          throw new Error("unsupported escape in pattern: " + src);
        default:
          break;
      }
      if (/[0-9]/.test(n)) {
        out += "\\" + n; // back-reference
        continue;
      }
      if (/[A-Za-z]/.test(n)) throw new Error(`unsupported escape \\${n} in pattern: ${src}`);
      // escaped punctuation / space
      if (n === "-") out += inClass ? "\\-" : "-";
      else if (SYNTAX_CHARS.includes(n)) out += "\\" + n;
      else out += n; // e.g. \" \# \<space> \& \~  (identity escapes are illegal under the u flag)
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      out += c;
      continue;
    }
    if (c === "[") {
      inClass = true;
      out += c;
      if (src[i + 1] === "^") {
        out += "^";
        i++;
      }
      continue;
    }
    if (c === ".") {
      out += "[^\\n]"; // Python '.' excludes only \n
      continue;
    }
    if (c === "(" && src[i + 1] === "?" && src[i + 2] === "P") throw new Error("named groups unsupported: " + src);
    out += c;
  }
  return out;
}

const cache = new Map<string, RegExp>();

/** Compile (and cache) a Python pattern as a global, Unicode JS RegExp. Helpers below reset lastIndex. */
export function pyre(src: string): RegExp {
  let rx = cache.get(src);
  if (!rx) {
    rx = new RegExp(translatePattern(src), "gu");
    cache.set(src, rx);
  }
  return rx;
}

export interface Hit {
  m: RegExpExecArray;
  start: number;
  end: number;
}

/** Python `re.finditer`: all non-overlapping matches (UTF-16 offsets; only ever compared with each other). */
export function finditer(rx: RegExp, text: string): Hit[] {
  const out: Hit[] = [];
  rx.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    out.push({ m, start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) rx.lastIndex++;
  }
  rx.lastIndex = 0;
  return out;
}

/** Python `re.search`. */
export function search(rx: RegExp, text: string): Hit | null {
  rx.lastIndex = 0;
  const m = rx.exec(text);
  rx.lastIndex = 0;
  return m ? { m, start: m.index, end: m.index + m[0].length } : null;
}

/** Python `re.sub` with a replacement function (no backslash/`$` surprises). */
export function sub(rx: RegExp, text: string, fn: (m: RegExpExecArray) => string): string {
  let out = "";
  let last = 0;
  rx.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    out += text.slice(last, m.index) + fn(m);
    last = m.index + m[0].length;
    if (m[0].length === 0) rx.lastIndex++;
  }
  rx.lastIndex = 0;
  return out + text.slice(last);
}

/** `re.sub(rx, literal, text)`. */
export function subLit(rx: RegExp, text: string, rep: string): string {
  return sub(rx, text, () => rep);
}

/** Python 3.7+ `re.escape`. */
export function pyEscape(s: string): string {
  let out = "";
  for (const ch of s) out += "()[]{}?*+-|^$\\.&~# \t\n\r\v\f".includes(ch) ? "\\" + ch : ch;
  return out;
}

/** Number of code points (Python `len`). */
export function pyLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) i++;
    n++;
  }
  return n;
}

const WS_RUN = new RegExp(`[${WS_CLASS_BODY}]+`, "gu");
const WS_EDGE_L = new RegExp(`^[${WS_CLASS_BODY}]+`, "u");
const WS_EDGE_R = new RegExp(`[${WS_CLASS_BODY}]+$`, "u");

/** Python `str.split()` (any whitespace, no empty strings). */
export function pySplit(s: string): string[] {
  const out: string[] = [];
  let last = 0;
  WS_RUN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WS_RUN.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  WS_RUN.lastIndex = 0;
  return out;
}

/** Python `str.strip()`. */
export function pyStrip(s: string): string {
  return s.replace(WS_EDGE_L, "").replace(WS_EDGE_R, "");
}

/** Python `str.rstrip()`. */
export function pyRstrip(s: string): string {
  return s.replace(WS_EDGE_R, "");
}

/** `re.sub(r"\s+", " ", s)`. */
export function collapseSpaces(s: string): string {
  return s.replace(WS_RUN, " ");
}

/** Python string order (code point order), for `sorted()` of str. */
export function pyCmp(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) {
      // surrogates (astral code points) sort above every BMP unit in code point order
      const xs = x >= 0xd800 && x <= 0xdfff;
      const ys = y >= 0xd800 && y <= 0xdfff;
      if (xs !== ys) return xs ? 1 : -1;
      return x < y ? -1 : 1;
    }
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

export function sortedStrings(xs: Iterable<string>): string[] {
  return Array.from(xs).sort(pyCmp);
}

/** CPython 3.12+ `sum()` of floats (Neumaier compensated summation), so float results match exactly. */
export function pySum(xs: ArrayLike<number>): number {
  let f = 0;
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += f - t + x;
    else c += x - t + f;
    f = t;
  }
  if (c !== 0 && Number.isFinite(c)) f += c;
  return f;
}

const ND = /^\p{Nd}$/u;

/** Python `int(str)` for a string of Unicode decimal digits (Python accepts any Nd digit). */
export function pyIntDigits(s: string): number {
  let v = 0;
  for (const ch of s) {
    let cp = ch.codePointAt(0)!;
    let d: number;
    if (cp >= 48 && cp <= 57) d = cp - 48;
    else {
      let r = cp;
      while (r > 0 && ND.test(String.fromCodePoint(r - 1))) r--;
      d = (cp - r) % 10;
    }
    v = v * 10 + d;
  }
  return v;
}
