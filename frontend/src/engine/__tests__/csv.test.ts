import { describe, expect, it } from "vitest";
import { csvTemplate, parseCsv } from "../csv";
import { CSV_MAX_ROWS } from "../types";

const H = "cpse,matnr,maktx";

describe("parseCsv", () => {
  it("parses the template and builds record ids", () => {
    const r = parseCsv(csvTemplate());
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.records.map((x) => x.record_id)).toEqual(["PLANT_A:10001", "PLANT_B:M-2001"]);
    expect(r.records[0].maktx).toBe('FLANGE WN 2" CL150 RF SCH40 A105');
    expect(r.records[0].last_po_price).toBe(1180);
    expect(r.records[0].annual_qty).toBe(240);
  });

  it("strips a BOM and matches headers without case or spaces", () => {
    const r = parseCsv("\uFEFF CPSE , MatNr ,MAKTX\nA,1,GATE VALVE\n");
    expect(r.ok).toBe(true);
    expect(r.records[0].record_id).toBe("A:1");
  });

  it("empty file", () => {
    for (const t of ["", "   \n  "]) {
      const r = parseCsv(t);
      expect(r.ok).toBe(false);
      expect(r.issues[0].code).toBe("EMPTY_FILE");
      expect(r.issues[0].message).toMatch(/sample template/);
    }
  });

  it("missing columns are named", () => {
    const r = parseCsv("cpse,description\nA,x\n");
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe("MISSING_COLUMNS");
    expect(r.issues[0].message).toMatch(/matnr, maktx/);
  });

  it("too many rows states the limit", () => {
    const rows = Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => `A,${i},ITEM ${i}`);
    const r = parseCsv([H, ...rows].join("\n"));
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe("TOO_MANY_ROWS");
    expect(r.issues[0].message).toMatch(/3,000/);
    expect(parseCsv([H, ...rows.slice(0, CSV_MAX_ROWS)].join("\n")).ok).toBe(true);
  });

  it("duplicate ids are an error that lists rows", () => {
    const r = parseCsv(`${H}\nA,1,X\nA,2,Y\nA,1,Z\n`);
    expect(r.ok).toBe(false);
    const d = r.issues.find((i) => i.code === "DUPLICATE_ID")!;
    expect(d.rows).toEqual([3]);
    expect(d.severity).toBe("error");
  });

  it("blank descriptions are skipped with a warning and counted", () => {
    const r = parseCsv(`${H}\nA,1,\nA,2,GATE VALVE\nA,3,  \n`);
    expect(r.ok).toBe(true);
    expect(r.records.map((x) => x.record_id)).toEqual(["A:2"]);
    const w = r.issues.find((i) => i.code === "BLANK_DESCRIPTION")!;
    expect(w.severity).toBe("warning");
    expect(w.rows).toEqual([1, 3]);
    expect(w.message).toMatch(/^2 rows were skipped/);
  });

  it("bad numbers become empty cells with a warning", () => {
    const r = parseCsv(`${H},last_po_price,annual_qty\nA,1,X,abc,5\nA,2,Y,"1,200.50",\n`);
    expect(r.ok).toBe(true);
    expect(r.records[0].last_po_price).toBeNull();
    expect(r.records[0].annual_qty).toBe(5);
    expect(r.records[1].last_po_price).toBe(1200.5);
    expect(r.issues.find((i) => i.code === "BAD_NUMBER")!.rows).toEqual([1]);
  });

  it("bad characteristics JSON is a warning and ignored; good JSON is kept", () => {
    const r = parseCsv(`${H},characteristics\nA,1,X,"{""face"": ""RF""}"\nA,2,Y,not json\n`);
    expect(r.records[0].characteristics).toEqual({ face: "RF" });
    expect(r.records[1].characteristics).toEqual({});
    expect(r.issues.find((i) => i.code === "BAD_CHARACTERISTICS")!.rows).toEqual([2]);
  });

  it("an unclosed quote is reported in plain language, never thrown", () => {
    const r = parseCsv(`${H}\nA,1,"GATE VALVE\nA,2,Y\n`);
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe("UNREADABLE");
    expect(r.issues[0].message).not.toMatch(/stack|undefined|Error/);
  });

  it("never throws on garbage input", () => {
    for (const t of [null as unknown as string, undefined as unknown as string, "\u0000\u0001", "a,b\n\"", "{}"]) {
      expect(() => parseCsv(t)).not.toThrow();
      expect(parseCsv(t).ok).toBe(false);
    }
  });
});
