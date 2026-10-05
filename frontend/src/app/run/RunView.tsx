"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { LockIcon } from "@/components/Icons";
import { Panel } from "@/components/Panel";
import { StageList } from "@/components/StageList";
import { useRunStore } from "@/state/runStore";

export function RunView() {
  const router = useRouter();
  const params = useSearchParams();
  const { stages, status, run, error, hydrated, reset } = useRunStore();
  const next = params.get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/materials";

  useEffect(() => {
    if (status === "idle" && run) router.replace(target);
    else if (status === "idle" && hydrated && !run) router.replace("/sample");
  }, [status, run, hydrated, target, router]);

  return (
    <div className="max-w-[720px] space-y-5">
      <div>
        <h1 className="text-[28px]">Running SAMA-NMC</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-3">
          <LockIcon size={14} /> Processed locally in your browser
        </p>
      </div>
      {status === "error" ? (
        <>
          <Callout tone="danger" title="The run could not finish" role="alert">
            {error ?? "Something went wrong."}
          </Callout>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                reset();
                router.push("/sample");
              }}
            >
              Back to sample data
            </Button>
          </div>
        </>
      ) : (
        <Panel bodyClassName="px-5 py-1" as="section">
          <StageList stages={stages} />
        </Panel>
      )}
    </div>
  );
}
