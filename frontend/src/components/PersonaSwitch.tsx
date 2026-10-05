"use client";
import type { Actor } from "@/engine/types";
import { useRunStore } from "@/state/runStore";

const PERSONAS: Actor[] = ["Demo analyst", "Demo engineer"];

/** Demo role personas, not people. Reviewer clicks are recorded under the chosen role. */
export function PersonaSwitch({ compact = false }: { compact?: boolean }) {
  const actor = useRunStore((s) => s.actor);
  const setActor = useRunStore((s) => s.setActor);
  return (
    <div className="inline-flex flex-wrap items-center gap-2" role="group" aria-label="Reviewing as (demo role personas)">
      <span className="text-xs font-semibold text-ink-2">Reviewing as</span>
      <span className="inline-flex overflow-hidden rounded-ctl border border-navy">
        {PERSONAS.map((p) => {
          const on = actor === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              onClick={() => setActor(p)}
              className={`px-2.5 py-1 text-xs font-semibold ${on ? "bg-navy text-white" : "bg-white text-navy hover:bg-blue-50"}`}
            >
              {p}
            </button>
          );
        })}
      </span>
      {!compact && <span className="text-xs text-ink-3">Demo role personas, not real people.</span>}
    </div>
  );
}
