/** Opt-in: PERF=1 npx vitest run perf. Builds a 3,000-row upload from the demo CSV and times runEngineSync. */
import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "../csv";
import { runEngineSync } from "../engine";
import { assets } from "./helpers";

const run = process.env.PERF ? describe : describe.skip;

run("perf: 3,000-row upload", () => {
  it("measures wall time", () => {
    const text = fs.readFileSync(path.resolve(__dirname, "../../../../data/synthetic/demo/records.csv"), "utf-8");
    const lines = text.replace(/^﻿/, "").split(/\r?\n/);
    // keep the header plus the first 3,000 records (a record can span lines only if quoted newlines exist; the demo has none)
    const csv = lines.slice(0, 3001).join("\n");
    const parsed = parseCsv(csv);
    console.log(`parsed ${parsed.records.length} records, ok=${parsed.ok}, issues=${parsed.issues.map((i) => i.code).join(",")}`);
    const t0 = performance.now();
    const out = runEngineSync(parsed.records, assets, { scope: "upload", runId: "RUN-PERF" });
    const ms = performance.now() - t0;
    console.log(
      `runEngineSync: ${(ms / 1000).toFixed(2)} s | records ${out.summary.records} | candidate pairs ${out.summary.candidate_pairs} | ` +
        `auto ${out.summary.auto} review ${out.summary.review} reject(lookalike) ${out.summary.reject} filtered ${out.summary.filtered} | ` +
        `groups ${out.summary.groups} unique ${out.summary.unique} pending ${out.summary.pending} | nmcs ${out.summary.nmcs} | audit ${out.audit.length}`,
    );
  });
});
