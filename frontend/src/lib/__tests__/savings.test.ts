import { describe, expect, it } from "vitest";
import { computeSavings, type SavingsInput } from "../savings";

const m = (cpse: string, price: number | null, qty: number | null, uom = "EA"): SavingsInput => ({
  id: `${cpse}:1`, cpse, matnr: "1", uom, price, qty,
});

describe("computeSavings", () => {
  it("computes min, max, spread, pooled quantity and the illustrative opportunity", () => {
    const l = computeSavings([m("A", 1180, 240), m("B", 1235, 180), m("C", 1160, 300)])!;
    expect(l.min).toBe(1160);
    expect(l.max).toBe(1235);
    expect(l.spread).toBe(75);
    expect(l.pooledQty).toBe(720);
    expect(l.opportunity).toBe(20 * 240 + 75 * 180);
    expect(l.rows.every((r) => r.included)).toBe(true);
  });

  it("strikes out rows with another unit and keeps them out of the numbers", () => {
    const l = computeSavings([m("A", 100, 10), m("B", 120, 10), m("C", 50, 1000, "KG")])!;
    expect(l.basisUom).toBe("EA");
    expect(l.min).toBe(100);
    expect(l.rows[2].included).toBe(false);
    expect(l.rows[2].reason).toContain("unit differs");
    expect(l.opportunity).toBe(20 * 10);
  });

  it("returns null with fewer than two priced members in the same unit", () => {
    expect(computeSavings([m("A", 100, 1)])).toBeNull();
    expect(computeSavings([m("A", 100, 1), m("B", null, 1)])).toBeNull();
    expect(computeSavings([m("A", 100, 1, "EA"), m("B", 90, 1, "KG")])).toBeNull();
    expect(computeSavings([m("A", 100, 1, ""), m("B", 90, 1, "")])).toBeNull();
  });

  it("does not invent a quantity", () => {
    const l = computeSavings([m("A", 100, null), m("B", 110, null)])!;
    expect(l.opportunity).toBeNull();
    expect(l.pooledQty).toBeNull();
    expect(l.rowsWithoutQty).toBe(2);
    const p = computeSavings([m("A", 100, null), m("B", 110, 5)])!;
    expect(p.opportunity).toBe(10 * 5);
    expect(p.pooledQty).toBe(5);
  });

  it("treats zero and negative prices as missing", () => {
    expect(computeSavings([m("A", 0, 1), m("B", 5, 1)])).toBeNull();
  });
});
