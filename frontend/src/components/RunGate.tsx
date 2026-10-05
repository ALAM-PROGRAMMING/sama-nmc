"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { MasterState, RunOutput } from "@/engine/types";
import { useRunStore } from "@/state/runStore";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { PlayIcon } from "./Icons";

/** Waits for hydration, then shows either the empty state ("Try sample run") or the children with the loaded run. */
export function RunGate({ title, children }: { title: string; children: (run: RunOutput, master: MasterState) => ReactNode }) {
  const { run, master, status, hydrated, startSample } = useRunStore();
  const router = useRouter();
  if (!hydrated || status === "running") {
    return <div className="rounded-ctl border border-line bg-white p-8 text-center text-sm text-ink-2">Loading the run…</div>;
  }
  if (!run || !master) {
    return (
      <div className="space-y-5">
        <h1 className="text-[28px]">{title}</h1>
        <EmptyState
          title="No material run loaded yet."
          action={
            <>
              <Button
                size="lg"
                onClick={() => {
                  void startSample();
                  router.push("/run");
                }}
              >
                <PlayIcon size={14} /> Try sample run
              </Button>
              <Link href="/upload" className="inline-flex h-11 items-center px-3 text-sm font-semibold">
                or upload your own file
              </Link>
            </>
          }
        >
          Run the demo first. Then the decisions, the evidence behind each one and the audit trail appear here.
        </EmptyState>
      </div>
    );
  }
  return <>{children(run, master)}</>;
}
