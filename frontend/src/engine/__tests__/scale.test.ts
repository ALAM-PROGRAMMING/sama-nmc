/**
 * Opt-in large-scale parity: SCALE_CSV=<csv of up to 3,000 rows> SCALE_JSON=<build_run_output JSON from Python,
 * run id RUN-PERF, scope upload, ts 2026-10-03T00:00:00Z / ...01Z> npx vitest run scale
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { parseCsv } from "../csv";
import { runEngineSync } from "../engine";
import { assets, diffs } from "./helpers";

const on = process.env.SCALE_CSV && process.env.SCALE_JSON;
(on ? describe : describe.skip)("scale parity vs Python", () => {
  it("3,000 records: whole RunOutput equals Python (audit hashes included)", () => {
    const py = JSON.parse(fs.readFileSync(process.env.SCALE_JSON!, "utf-8"));
    const parsed = parseCsv(fs.readFileSync(process.env.SCALE_CSV!, "utf-8"));
    const ts = ["2026-10-03T00:00:00Z", "2026-10-03T00:00:01Z"];
    let i = 0;
    const out = runEngineSync(parsed.records, assets, { scope: "upload", runId: "RUN-PERF", now: () => ts[Math.min(i++, 1)] });
    const d = diffs(out, py, 1e-9);
    console.log(`differences: ${d.length}`, d.slice(0, 10));
    expect(d.slice(0, 10)).toEqual([]);
    expect(out.audit).toEqual(py.audit);
  });
});
