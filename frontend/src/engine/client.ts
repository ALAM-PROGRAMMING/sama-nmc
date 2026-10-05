/**
 * Browser-side entry point: runs the engine in a Web Worker, falling back to the main thread when a
 * worker cannot be created. Also loads the engine assets on the main thread for master-layer
 * operations (approvals need the class templates). Not imported by tests (it touches Worker/fetch).
 */
import { loadAssets } from "./assets";
import { runEngine } from "./engine";
import { registerAssets } from "./master";
import type { EngineAssets, RawRecord, RunOutput, RunProgress } from "./types";
import type { WorkerRequest, WorkerResponse, WorkerRunOptions } from "./engine.worker";

let mainAssets: Promise<EngineAssets> | null = null;

/** Load the engine assets on the main thread once, and register them for master-layer operations. */
export function ensureAssets(base = "/engine"): Promise<EngineAssets> {
  if (!mainAssets) {
    mainAssets = loadAssets(base).then((a) => {
      registerAssets(a);
      return a;
    });
    mainAssets.catch(() => {
      mainAssets = null; // allow a retry
    });
  }
  return mainAssets;
}

async function runOnMainThread(records: RawRecord[], opts: WorkerRunOptions, onProgress?: (p: RunProgress) => void): Promise<RunOutput> {
  const assets = await ensureAssets(opts.base);
  return runEngine(records, assets, { scope: opts.scope, runId: opts.runId, truth: opts.truth, warnings: opts.warnings, onProgress });
}

/** Run the engine in a worker (with progress). Falls back to the main thread if no worker can be started. */
export function runInWorker(records: RawRecord[], opts: WorkerRunOptions, onProgress?: (p: RunProgress) => void): Promise<RunOutput> {
  void ensureAssets(opts.base).catch(() => undefined); // approvals need the assets on the main thread too
  return new Promise<RunOutput>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    } catch {
      runOnMainThread(records, opts, onProgress).then(resolve, reject);
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      fn();
    };
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === "progress") onProgress?.(m.progress);
      else if (m.type === "done") finish(() => resolve(m.output));
      else if (m.type === "error") finish(() => reject(new Error(m.message)));
    };
    worker.onerror = () => {
      // the worker could not start (blocked, bundler issue): run on the main thread instead
      finish(() => {
        runOnMainThread(records, opts, onProgress).then(resolve, reject);
      });
    };
    const req: WorkerRequest = { type: "run", records, opts };
    worker.postMessage(req);
  });
}
