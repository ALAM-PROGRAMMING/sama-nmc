"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRunStore } from "@/state/runStore";
import { LoadingRun, NoRunState } from "@/components/NoRunState";
import { RegistryList } from "./RegistryList";
import { NmcCard } from "./NmcCard";

export function RegistryView() {
  const params = useSearchParams();
  const code = params.get("code");
  const { master, run, status, hydrated } = useRunStore();

  if (!hydrated || status === "running") return <LoadingRun />;
  if (!run || !master) {
    return (
      <div className="space-y-5">
        <h1 className="text-[28px]">NMC Registry</h1>
        <NoRunState>Every national material code, with the old CPSE numbers linked to it, appears here once a run is loaded.</NoRunState>
      </div>
    );
  }
  if (code) return <NmcCard master={master} code={code} />;
  return (
    <div className="space-y-5">
      <RegistryList master={master} />
      <p className="text-sm text-ink-3">
        Looking for the records themselves? <Link href="/materials">Open the Material Master</Link>.
      </p>
    </div>
  );
}
