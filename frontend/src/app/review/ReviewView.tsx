"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RunGate } from "@/components/RunGate";
import { isFilterId } from "@/lib/review";
import { MatchReview } from "./MatchReview";
import { ReviewQueue } from "./ReviewQueue";

function Inner() {
  const q = useSearchParams();
  const d = q.get("d");
  const f = q.get("f");
  const filter = isFilterId(f) ? f : null;
  return (
    <RunGate title="Match Review">
      {(run, master) =>
        d ? (
          <MatchReview run={run} master={master} id={d} filter={filter} evidence={q.get("evidence") === "1"} />
        ) : (
          <ReviewQueue run={run} master={master} initialFilter={filter ?? "open"} />
        )
      }
    </RunGate>
  );
}

export function ReviewView() {
  return (
    <Suspense fallback={<div className="rounded-ctl border border-line bg-white p-8 text-center text-sm text-ink-2">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
