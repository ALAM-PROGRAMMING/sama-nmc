"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useRunStore } from "@/state/runStore";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { PlayIcon } from "./Icons";

/** Shown by every data screen when no run is loaded. */
export function NoRunState({ children }: { children?: ReactNode }) {
  const router = useRouter();
  const startSample = useRunStore((s) => s.startSample);
  return (
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
      {children ?? "Run the demo first. This page then shows the result of that run."}
    </EmptyState>
  );
}

export function LoadingRun() {
  return <div className="rounded-ctl border border-line bg-white p-8 text-center text-sm text-ink-2">Loading the run…</div>;
}
