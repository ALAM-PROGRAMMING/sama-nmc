/** NMC helpers (Architecture §7.10). Pure functions; recomputes the check digit in the browser. */

export function mod11_2Check(digits: string): string {
  // ISO/IEC 7064 MOD 11-2
  let p = 0;
  for (const ch of digits) p = ((p + Number(ch)) * 2) % 11;
  const c = (12 - p) % 11;
  return c === 10 ? "X" : String(c);
}

export interface NmcParts {
  authority: string;
  classCode: string;
  serial: string;
  check: string;
}

export function parseNmc(code: string): NmcParts | null {
  const m = /^NMC:(\d{4})-(\d{7})-([0-9X])$/.exec(code.trim());
  if (!m) return null;
  return { authority: "NMC:", classCode: m[1], serial: m[2], check: m[3] };
}

export function validateNmc(code: string): boolean {
  const p = parseNmc(code);
  return !!p && mod11_2Check(p.classCode + p.serial) === p.check;
}
