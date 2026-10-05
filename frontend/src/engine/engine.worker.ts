/**
 * Web Worker entry: runs the engine off the main thread.
 *   in : { type: "run", records, opts }   (opts: scope, runId?, truth?, warnings?, base?)
 *   out: { type: "progress", progress } ... then { type: "done", output } or { type: "error", message }
 * No DOM globals are used by the engine modules; only fetch/postMessage here.
 */
import { loadAssets } from "./assets";
import { runEngine } from "./engine";
import type { EngineAssets, RawRecord, RunOutput, RunProgress } from "./types";

export interface WorkerRunOptions {
  scope: "sample" | "upload";
  runId?: string;
  truth?: Record<string, string>;
  warnings?: string[];
  /** Where the engine assets are served from (default "/engine"). */
  base?: string;
}

export type WorkerRequest = { type: "run"; records: RawRecord[]; opts: WorkerRunOptions };
export type WorkerResponse =
  | { type: "progress"; progress: RunProgress }
  | { type: "done"; output: RunOutput }
  | { type: "error"; message: string };

const scope = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((e: { data: WorkerRequest }) => void) | null;
};

let assetsPromise: Promise<EngineAssets> | null = null;

scope.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || msg.type !== "run") return;
  try {
    assetsPromise = assetsPromise ?? loadAssets(msg.opts.base ?? "/engine");
    const assets = await assetsPromise;
    const output = await runEngine(msg.records, assets, {
      scope: msg.opts.scope,
      runId: msg.opts.runId,
      truth: msg.opts.truth,
      warnings: msg.opts.warnings,
      onProgress: (progress) => scope.postMessage({ type: "progress", progress }),
    });
    scope.postMessage({ type: "done", output });
  } catch (err) {
    assetsPromise = null;
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : "The engine stopped unexpectedly." });
  }
};
