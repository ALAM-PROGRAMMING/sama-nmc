"use client";
import { useRunStore } from "@/state/runStore";
import { LoadingRun, NoRunState } from "@/components/NoRunState";
import { ThisRun } from "./ThisRun";
import { TwoEngines } from "./TwoEngines";
import { Benchmark } from "./Benchmark";

export function AnalyticsView() {
  const { run, status, hydrated } = useRunStore();
  const loading = !hydrated || status === "running";
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[28px]">Analytics</h1>
        <p className="mt-1 text-sm text-ink-2">Three views: what this run did, how it compares with an ordinary matcher on the same pairs, and the offline benchmark.</p>
      </div>
      {loading ? (
        <LoadingRun />
      ) : run ? (
        <>
          <ThisRun run={run} />
          <TwoEngines run={run} />
        </>
      ) : (
        <section aria-labelledby="this-run-h" className="space-y-3">
          <h2 id="this-run-h" className="text-xl">This run</h2>
          <NoRunState>The first two sections describe a run. Load one to see them. The offline benchmark below does not need a run.</NoRunState>
        </section>
      )}
      <Benchmark />
    </div>
  );
}
