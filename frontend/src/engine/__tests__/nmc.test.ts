import { describe, expect, it } from "vitest";
import { SerialAllocator, formatNmc, mod11_2Check, validateNmc } from "../nmc";

describe("NMC", () => {
  it("MOD 11-2 reproduces the ORCID test vector", () => {
    expect(mod11_2Check("000000021825009")).toBe("7");
  });
  it("known-good codes validate", () => {
    for (const c of ["NMC:1101-0000123-6", "NMC:1201-0000456-7", "NMC:1301-0000789-8"]) expect(validateNmc(c), c).toBe(true);
  });
  it("typos are rejected", () => {
    for (const c of ["NMC:1101-0000123-7", "NMC:1101-0000132-6", "NMC:1201-0000456-6", "NMC:1301-0000789-X", "NMC:1101-000123-6", "nmc:1101-0000123-6", "NMC:1101-0000123-66"]) {
      expect(validateNmc(c), c).toBe(false);
    }
  });
  it("formats, pads the serial and never reuses it", () => {
    const a = new SerialAllocator(1);
    const c1 = a.mint("1201");
    const c2 = a.mint("1201");
    expect(c1.startsWith("NMC:1201-0000001-")).toBe(true);
    expect(c2.startsWith("NMC:1201-0000002-")).toBe(true);
    expect(validateNmc(c1) && validateNmc(c2)).toBe(true);
    expect(formatNmc("1101", 123)).toBe("NMC:1101-0000123-6");
  });
});
