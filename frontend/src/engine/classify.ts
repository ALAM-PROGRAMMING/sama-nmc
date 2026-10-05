/** Classification by head patterns (port of backend/sama/classify.py). No fallback model: abstain to GENERIC. */
import type { ConfigAsset } from "./types";
import { pyre, search } from "./pyre";

export const GENERIC = "9999";

export interface ClassResult {
  class_code: string;
  confidence: number;
  abstained: boolean;
  reason: string;
}

export function classify(normText: string, cfg: ConfigAsset): ClassResult {
  const hits = new Map<string, { start: number; text: string }>();
  for (const [code, c] of Object.entries(cfg.classes)) {
    for (const p of c.head_patterns) {
      const h = search(pyre(p), normText);
      if (h && (!hits.has(code) || h.start < hits.get(code)!.start)) hits.set(code, { start: h.start, text: h.m[0] });
    }
  }
  if (hits.size === 0) return { class_code: GENERIC, confidence: 0.0, abstained: true, reason: "no head pattern matched" };
  if (hits.size === 1) {
    const [code, m] = [...hits.entries()][0];
    return { class_code: code, confidence: 1.0, abstained: false, reason: `head pattern '${m.text}'` };
  }
  let best: [string, { start: number; text: string }] | null = null;
  for (const e of hits.entries()) if (best === null || e[1].start < best[1].start) best = e;
  return {
    class_code: best![0],
    confidence: 0.8,
    abstained: false,
    reason: `earliest of ${hits.size} head patterns: '${best![1].text}'`,
  };
}
