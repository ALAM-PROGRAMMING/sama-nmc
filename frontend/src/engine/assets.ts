/** Loading of the three frozen engine artifacts (config.json, text_model.json, gate.json). Works in a Web Worker. */
import type { ConfigAsset, EngineAssets, GateAsset, TextModelAsset } from "./types";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the engine file ${url} (status ${res.status}).`);
  return (await res.json()) as T;
}

/** Fetch the frozen artifacts. `base` is the URL prefix they are served under (default "/engine"). */
export async function loadAssets(base = "/engine"): Promise<EngineAssets> {
  const b = base.replace(/\/+$/, "");
  const [config, textModel, gate] = await Promise.all([
    fetchJson<ConfigAsset>(`${b}/config.json`),
    fetchJson<TextModelAsset>(`${b}/text_model.json`),
    fetchJson<GateAsset>(`${b}/gate.json`),
  ]);
  return { config, textModel, gate };
}

/** Node-only (tests, scripts): read the same three files from a directory. Synchronous. */
export function loadAssetsFromDisk(dir: string): EngineAssets {
  const proc = (globalThis as any).process;
  const fs = proc?.getBuiltinModule?.("node:fs") as typeof import("node:fs") | undefined;
  const path = proc?.getBuiltinModule?.("node:path") as typeof import("node:path") | undefined;
  if (!fs || !path) throw new Error("loadAssetsFromDisk is only available in Node.");
  const read = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")) as T;
  return { config: read<ConfigAsset>("config.json"), textModel: read<TextModelAsset>("text_model.json"), gate: read<GateAsset>("gate.json") };
}
