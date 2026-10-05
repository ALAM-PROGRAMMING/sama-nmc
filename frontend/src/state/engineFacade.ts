/**
 * Engine facade: the ONLY place the UI touches the decision engine.
 *
 * Everything runs in the visitor's browser (a Web Worker); nothing is sent to a server.
 */
import type { CsvResult, RawRecord, RunOutput, RunProgress } from "@/engine/types";

export interface RunOpts {
  scope: "sample" | "upload";
  truth?: Record<string, string>;
  /** presentation hint: silent restore after a refresh */
  fast?: boolean;
}

export type ProgressFn = (p: RunProgress) => void;

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
export function withBase(path: string): string {
  return `${BASE}${path}`;
}

/** Run the engine on already-validated records. */
export async function runEngineFor(records: RawRecord[], opts: RunOpts, onProgress?: ProgressFn): Promise<RunOutput> {
  const { runInWorker } = await import("@/engine/client");
  return runInWorker(records, { scope: opts.scope, truth: opts.truth }, onProgress);
}

/** Sample flow: load the bundled demo CSV (+ answer key) and run it. */
export async function runSample(onProgress?: ProgressFn, fast = false): Promise<RunOutput> {
  const [csvText, truth] = await Promise.all([
    fetch(withBase("/sample/sama_nmc_sample.csv")).then((r) => r.text()),
    fetch(withBase("/sample/sample_truth.json")).then((r) => r.json() as Promise<Record<string, string>>),
  ]);
  const parsed = await parseUpload(csvText);
  if (!parsed.ok) throw new Error(parsed.issues[0]?.message ?? "The sample file could not be read.");
  return runEngineFor(parsed.records, { scope: "sample", truth, fast }, onProgress);
}

/** Validate an uploaded CSV using the engine's strict parser. */
export async function parseUpload(text: string): Promise<CsvResult> {
  const { parseCsv } = await import("@/engine/csv");
  return parseCsv(text);
}
