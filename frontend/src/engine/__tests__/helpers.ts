import path from "node:path";
import { expect } from "vitest";
import { loadAssetsFromDisk } from "../assets";
import type { RawRecord } from "../types";

export const ASSET_DIR = path.resolve(__dirname, "../../../public/engine");
export const assets = loadAssetsFromDisk(ASSET_DIR);

/** Build a RawRecord from a fixture input (fixtures carry no record_id and sometimes omit fields). */
export function mk(i: Partial<RawRecord> & { cpse: string; matnr: string; maktx: string }): RawRecord {
  return {
    record_id: `${i.cpse}:${i.matnr}`.trim(), cpse: i.cpse, matnr: i.matnr, maktx: i.maktx, long_text: i.long_text ?? "",
    meins: i.meins ?? "", characteristics: i.characteristics ?? {}, mfr: i.mfr ?? "", mpn: i.mpn ?? "",
    last_po_price: i.last_po_price ?? null, annual_qty: i.annual_qty ?? null,
  };
}

/** Deep compare: exact for everything except numbers, which must agree within `tol`. Returns a list of differences. */
export function diffs(actual: unknown, expected: unknown, tol = 1e-9, p = "$", out: string[] = []): string[] {
  if (typeof expected === "number" && typeof actual === "number") {
    if (!(Math.abs(actual - expected) <= tol)) out.push(`${p}: ${actual} != ${expected}`);
  } else if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) out.push(`${p}: array length ${Array.isArray(actual) ? actual.length : typeof actual} != ${expected.length}`);
    else expected.forEach((e, i) => diffs(actual[i], e, tol, `${p}[${i}]`, out));
  } else if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object") out.push(`${p}: expected object, got ${actual}`);
    else {
      const ek = Object.keys(expected as object).sort();
      const ak = Object.keys(actual as object).sort();
      if (ek.join("|") !== ak.join("|")) out.push(`${p}: keys ${ak.join(",")} != ${ek.join(",")}`);
      for (const k of ek) if (k in (actual as object)) diffs((actual as any)[k], (expected as any)[k], tol, `${p}.${k}`, out);
    }
  } else if (actual !== expected) out.push(`${p}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  return out;
}

export function expectNoDiffs(d: string[], label = "") {
  expect(d.slice(0, 12), label).toEqual([]);
}
