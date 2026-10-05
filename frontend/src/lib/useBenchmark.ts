"use client";
import { useEffect, useState } from "react";
import type { BenchmarkAsset } from "@/engine/types";

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
let cached: BenchmarkAsset | null | undefined;

/** Offline benchmark results for the certificate. null when missing; undefined while loading. */
export function useBenchmark(): BenchmarkAsset | null | undefined {
  const [b, setB] = useState<BenchmarkAsset | null | undefined>(cached);
  useEffect(() => {
    if (cached !== undefined) return;
    let off = false;
    fetch(`${base}/data/benchmark.json`)
      .then((r) => (r.ok ? (r.json() as Promise<BenchmarkAsset>) : null))
      .catch(() => null)
      .then((j) => {
        cached = j;
        if (!off) setB(j);
      });
    return () => {
      off = true;
    };
  }, []);
  return b;
}
