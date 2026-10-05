"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { HonestyBadge } from "@/components/HonestyBadge";
import { PlayIcon, StarIcon } from "@/components/Icons";
import { Panel } from "@/components/Panel";
import { SAMPLE_META } from "@/lib/sampleMeta";
import { useRunStore } from "@/state/runStore";

export function SampleView() {
  const router = useRouter();
  const startSample = useRunStore((s) => s.startSample);
  const go = (next?: string) => {
    void startSample();
    router.push(next ? `/run?next=${encodeURIComponent(next)}` : "/run");
  };
  return (
    <div className="max-w-[860px] space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px]">Sample data</h1>
        <HonestyBadge kind="SYNTHETIC" />
        <HonestyBadge kind="DEMO DATA" />
      </div>
      <Panel title={SAMPLE_META.title} bodyClassName="p-5 sm:p-6">
        <p className="text-[17px] leading-relaxed text-ink">
          Three demo companies describe the same equipment differently. Run SAMA-NMC to see what it verifies, what it sends to engineers, and what it
          refuses to merge.
        </p>
        <p className="mt-2 text-sm text-ink-3">{SAMPLE_META.note}</p>

        <h3 className="mt-6 text-lg">What to look for</h3>
        <p className="mt-1 text-sm text-ink-2">After the run, each of these opens straight to its evidence.</p>
        <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
          {SAMPLE_META.featured.map((f) => (
            <li key={f.key}>
              <button
                type="button"
                title={f.blurb}
                onClick={() => go(`/review?d=${encodeURIComponent(f.decision_id)}`)}
                className="inline-flex items-center gap-1.5 rounded-ctl border border-line-strong bg-white px-3 py-1.5 text-left text-sm text-ink hover:border-blue-600 hover:bg-blue-50"
              >
                <StarIcon size={12} className="shrink-0 text-blue-600" />
                {f.title}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={() => go()}>
            <PlayIcon size={14} /> Run SAMA-NMC
          </Button>
          <Link href="/upload" className="text-sm font-semibold">
            or upload your own file
          </Link>
        </div>
      </Panel>
    </div>
  );
}
