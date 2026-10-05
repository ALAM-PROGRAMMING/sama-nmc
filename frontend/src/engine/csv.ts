/**
 * Strict SAMA-NMC evaluator CSV parser. Never throws: always returns a CsvResult whose issues are
 * written in plain language for the person who uploaded the file.
 *
 * Required columns: cpse, matnr, maktx. Optional: long_text, meins, mfr, mpn, last_po_price, annual_qty,
 * characteristics (a JSON object as text). Header names are matched without regard to case or spaces.
 */
import Papa from "papaparse";
import { CSV_MAX_ROWS, CSV_OPTIONAL, CSV_REQUIRED, type CsvIssue, type CsvResult, type RawRecord } from "./types";

const HINT = "Download the sample template to see the required columns.";
const MAX_ROWS_LISTED = 5;

const stripBom = (s: string) => s.replace(/^﻿/, "");
const normHeader = (s: string) => stripBom(String(s ?? "")).trim().toLowerCase();

function rowList(rows: number[]): string {
  const shown = rows.slice(0, MAX_ROWS_LISTED).join(", ");
  return rows.length > MAX_ROWS_LISTED ? `${shown} and ${rows.length - MAX_ROWS_LISTED} more` : shown;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Parse a number cell. Returns undefined for an empty cell, null for an unparseable one. */
function parseNumber(raw: string): number | null | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  const cleaned = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(v) ? v.replace(/,/g, "") : v;
  if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseCsv(text: string): CsvResult {
  const fail = (issue: CsvIssue): CsvResult => ({ records: [], issues: [issue], ok: false });
  try {
    const src = stripBom(String(text ?? ""));
    if (!src.trim()) {
      return fail({ code: "EMPTY_FILE", severity: "error", message: `The file is empty. ${HINT}` });
    }
    const parsed = Papa.parse<string[]>(src, { header: false, skipEmptyLines: false, delimitersToGuess: [",", ";", "\t"] });
    const quoteErrors = parsed.errors.filter((e) => e.type === "Quotes");
    if (quoteErrors.length) {
      return fail({
        code: "UNREADABLE",
        severity: "error",
        message: `The file could not be read: a quoted value is not closed properly (near row ${(quoteErrors[0].row ?? 0) + 1}). Check that every opening quote has a closing one. ${HINT}`,
      });
    }
    const all = parsed.data as string[][];
    const isBlankRow = (r: string[]) => r.every((c) => String(c ?? "").trim() === "");
    const headerIdx = all.findIndex((r) => !isBlankRow(r));
    if (headerIdx < 0) return fail({ code: "EMPTY_FILE", severity: "error", message: `The file has no rows. ${HINT}` });
    const headerRow = all[headerIdx].map(normHeader);
    const missing = CSV_REQUIRED.filter((c) => !headerRow.includes(c));
    if (missing.length) {
      return fail({
        code: "MISSING_COLUMNS",
        severity: "error",
        message: `The file is missing the required ${plural(missing.length, "column", "columns")}: ${missing.join(", ")}. The first row must be a header row with at least cpse, matnr and maktx. ${HINT}`,
      });
    }
    const col = (name: string) => headerRow.indexOf(name);
    const idx = Object.fromEntries([...CSV_REQUIRED, ...CSV_OPTIONAL].map((c) => [c, col(c)])) as Record<string, number>;
    const dataRows = all.slice(headerIdx + 1).map((cells, i) => ({ cells, n: i + 1 }));
    while (dataRows.length && isBlankRow(dataRows[dataRows.length - 1].cells)) dataRows.pop(); // trailing blank lines
    const nonBlank = dataRows.filter((r) => !isBlankRow(r.cells));
    if (nonBlank.length === 0) {
      return fail({ code: "EMPTY_FILE", severity: "error", message: `The file has a header but no records. ${HINT}` });
    }
    if (nonBlank.length > CSV_MAX_ROWS) {
      return fail({
        code: "TOO_MANY_ROWS",
        severity: "error",
        message: `The file has ${nonBlank.length.toLocaleString("en-US")} records, but this demo accepts at most ${CSV_MAX_ROWS.toLocaleString("en-US")}. Please upload a smaller file.`,
      });
    }

    const issues: CsvIssue[] = [];
    const get = (cells: string[], name: string): string => (idx[name] >= 0 ? String(cells[idx[name]] ?? "").trim() : "");
    const records: RawRecord[] = [];
    const seen = new Map<string, number>();
    const blankRows: number[] = [];
    const dupRows: number[] = [];
    const badNumRows: number[] = [];
    const badCharRows: number[] = [];

    for (const { cells, n } of nonBlank) {
      const cpse = get(cells, "cpse");
      const matnr = get(cells, "matnr");
      const maktx = get(cells, "maktx");
      if (!cpse || !matnr || !maktx) {
        blankRows.push(n);
        continue;
      }
      const id = `${cpse}:${matnr}`;
      if (seen.has(id)) {
        dupRows.push(n);
        continue;
      }
      seen.set(id, n);
      let rowBadNum = false;
      const num = (name: string): number | null => {
        const v = parseNumber(get(cells, name));
        if (v === null) rowBadNum = true;
        return v === undefined || v === null ? null : v;
      };
      const price = num("last_po_price");
      const qty = num("annual_qty");
      if (rowBadNum) badNumRows.push(n);
      let characteristics: Record<string, string> = {};
      const chRaw = get(cells, "characteristics");
      if (chRaw) {
        try {
          const o = JSON.parse(chRaw);
          if (o === null || typeof o !== "object" || Array.isArray(o)) throw new Error("not an object");
          for (const [k, v] of Object.entries(o)) characteristics[String(k)] = typeof v === "string" ? v : String(v);
        } catch {
          characteristics = {};
          badCharRows.push(n);
        }
      }
      records.push({
        record_id: id, cpse, matnr, maktx, long_text: get(cells, "long_text"), meins: get(cells, "meins"), characteristics,
        mfr: get(cells, "mfr"), mpn: get(cells, "mpn"), last_po_price: price, annual_qty: qty,
      });
    }

    if (dupRows.length) {
      issues.push({
        code: "DUPLICATE_ID",
        severity: "error",
        rows: dupRows.slice(0, MAX_ROWS_LISTED),
        message: `${dupRows.length} ${plural(dupRows.length, "row repeats", "rows repeat")} an ID (cpse + matnr) that already appears earlier in the file (data ${plural(Math.min(dupRows.length, MAX_ROWS_LISTED), "row", "rows")} ${rowList(dupRows)}). Each cpse and matnr combination must appear only once.`,
      });
    }
    if (blankRows.length) {
      issues.push({
        code: "BLANK_DESCRIPTION",
        severity: "warning",
        rows: blankRows.slice(0, MAX_ROWS_LISTED),
        message: `${blankRows.length} ${plural(blankRows.length, "row was", "rows were")} skipped because the description (maktx), cpse or matnr was blank (data ${plural(Math.min(blankRows.length, MAX_ROWS_LISTED), "row", "rows")} ${rowList(blankRows)}).`,
      });
    }
    if (badNumRows.length) {
      issues.push({
        code: "BAD_NUMBER",
        severity: "warning",
        rows: badNumRows.slice(0, MAX_ROWS_LISTED),
        message: `${badNumRows.length} ${plural(badNumRows.length, "row has", "rows have")} a price or quantity that is not a number (data ${plural(Math.min(badNumRows.length, MAX_ROWS_LISTED), "row", "rows")} ${rowList(badNumRows)}). Those cells were treated as empty.`,
      });
    }
    if (badCharRows.length) {
      issues.push({
        code: "BAD_CHARACTERISTICS",
        severity: "warning",
        rows: badCharRows.slice(0, MAX_ROWS_LISTED),
        message: `${badCharRows.length} ${plural(badCharRows.length, "row has", "rows have")} a characteristics value that is not a JSON object such as {"face": "RF"} (data ${plural(Math.min(badCharRows.length, MAX_ROWS_LISTED), "row", "rows")} ${rowList(badCharRows)}). Those values were ignored.`,
      });
    }
    if (records.length === 0 && !issues.some((i) => i.severity === "error")) {
      issues.push({ code: "EMPTY_FILE", severity: "error", message: `No usable records were found. Every row was skipped. ${HINT}` });
    }
    return { records, issues, ok: !issues.some((i) => i.severity === "error") };
  } catch {
    return fail({ code: "UNREADABLE", severity: "error", message: `The file could not be read as a CSV table. Save it as a plain CSV file (comma separated, UTF-8) and try again. ${HINT}` });
  }
}

/** A tiny valid CSV the person can download as a starting point. */
export function csvTemplate(): string {
  return [
    "cpse,matnr,maktx,long_text,meins,mfr,mpn,last_po_price,annual_qty,characteristics",
    'PLANT_A,10001,"FLANGE WN 2"" CL150 RF SCH40 A105",,EA,,,1180.00,240,',
    'PLANT_B,M-2001,"WELD NECK FLG, NPS 2, 150#, RF, S40, ASTM A105",,EA,,,1235.00,180,',
  ].join("\n") + "\n";
}

/** Plain-text list of skipped-row warnings for RunOutput.warnings. */
export function issueWarnings(r: CsvResult): string[] {
  return r.issues.filter((i) => i.severity === "warning").map((i) => i.message);
}
