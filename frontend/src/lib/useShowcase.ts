"use client";
import { useEffect, useState } from "react";
import type { RunOutput } from "@/engine/types";
import { parseUpload, runEngineFor, withBase } from "@/state/engineFacade";
import { useRunStore } from "@/state/runStore";
import { SAMPLE_META } from "./sampleMeta";

/**
 * The run behind the illustrations on the Overview: the loaded sample run if there is one, otherwise a tiny LIVE run of
 * the real engine on the few sample records being illustrated (ids come from sample_meta.json). Nothing is canned:
 * every verdict shown is computed by the engine, in this browser, when the page opens.
 */
export function useShowcase(): RunOutput | null {
  const run = useRunStore((s) => s.run);
  const live = run && run.scope === "sample" ? run : null;
  const [mini, setMini] = useState<RunOutput | null>(null);
  useEffect(() => {
    if (live) return;
    let off = false;
    (async () => {
      try {
        const text = await fetch(withBase("/sample/sama_nmc_sample.csv")).then((r) => r.text());
        const parsed = await parseUpload(text);
        const ids = new Set(SAMPLE_META.showcase_records);
        const out = await runEngineFor(parsed.records.filter((r) => ids.has(r.record_id)), { scope: "sample" });
        if (!off) setMini(out);
      } catch {
        /* the illustration simply stays hidden if the engine cannot start */
      }
    })();
    return () => {
      off = true;
    };
  }, [live]);
  return live ?? mini;
}
