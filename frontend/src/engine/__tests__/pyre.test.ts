import { describe, expect, it } from "vitest";
import { finditer, pyCmp, pyEscape, pyIntDigits, pySplit, pyStrip, pySum, pyre, sub, translatePattern } from "../pyre";

const m = (src: string, text: string) => finditer(pyre(src), text).map((h) => h.m[0]);

describe("pyre: Python re -> JS", () => {
  it("\\b is Unicode-aware like Python str patterns", () => {
    expect(m(String.raw`\bGATE\s+VALVE\b`, "GATE VALVE")).toEqual(["GATE VALVE"]);
    expect(m(String.raw`\bGATE\s+VALVE\b`, "ÄGATE VALVE")).toEqual([]); // Ä is a word character in Python
    expect(m(String.raw`\bGATE\s+VALVE\b`, "GATE VALVEÖ")).toEqual([]);
    expect(m(String.raw`\bSO\b`, "ΑΩ SO ΩΑ")).toEqual(["SO"]);
    expect(m(String.raw`\bSO\b`, "ΩSO")).toEqual([]);
  });

  it("\\w and \\d cover Unicode letters and digits; \\s covers NBSP", () => {
    expect(m(String.raw`\w+`, "ÄÖÜ-ΩΩ")).toEqual(["ÄÖÜ", "ΩΩ"]);
    expect(m(String.raw`\d+`, "12٣٤")).toEqual(["12٣٤"]); // Arabic-Indic digits are \d in Python
    expect(m(String.raw`A\sB`, "A B")).toEqual(["A B"]);
  });

  it("lookbehind with a class containing \\w, slash and hyphen", () => {
    const rx = String.raw`(?<![\w/-])(\d+) IN\b`;
    expect(m(rx, "NPS 2 IN")).toEqual(["2 IN"]);
    expect(m(rx, "A2 IN")).toEqual([]);
    expect(m(rx, "1/2 IN")).toEqual([]); // "2 IN" after a slash is blocked, like Python
  });

  it("translates escaped punctuation Python allows but the JS u-flag rejects", () => {
    expect(() => pyre(String.raw`(?<![A-Z0-9])${pyEscape("CLASS-150")}(?![A-Z0-9])`)).not.toThrow();
    expect(m(String.raw`(?<![A-Z0-9])${pyEscape("150#")}(?![A-Z0-9])`, "A 150# B")).toEqual(["150#"]);
    expect(m(String.raw`(?<![A-Z0-9])${pyEscape("CL 150")}(?![A-Z0-9])`, "X CL 150 Y")).toEqual(["CL 150"]);
    expect(translatePattern(String.raw`\"`)).toBe('"');
  });

  it("sub with a function never interprets $ or backslashes", () => {
    expect(sub(pyre(String.raw`\bX\b`), "A X B", () => "$&\\1")).toBe("A $&\\1 B");
  });

  it("Python helpers: split, strip, sort order, escape, int, compensated sum", () => {
    expect(pySplit("  A\x1cB C\u0085D  ")).toEqual(["A", "B", "C", "D"]);
    expect(pyStrip("\u001f x 　")).toBe("x");
    expect(["b", "B", "a", "é", "Z"].sort(pyCmp)).toEqual(["B", "Z", "a", "b", "é"]);
    expect(pyEscape("A B-C#D")).toBe("A\\ B\\-C\\#D");
    expect(pyIntDigits("0042")).toBe(42);
    expect(pyIntDigits("٤٢")).toBe(42);
    expect(pySum([0.1, 0.2, 0.3])).toBe(0.6); // CPython 3.12+ gives 0.6 (naive summation gives 0.6000000000000001)
  });
});
