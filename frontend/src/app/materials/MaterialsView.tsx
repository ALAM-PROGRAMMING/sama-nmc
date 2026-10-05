"use client";
import Link from "next/link";
import { Fragment, useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useRunStore } from "@/state/runStore";
import { buildRows, type MaterialRow, type RowKind } from "@/lib/materialRows";
import { SAMPLE_META } from "@/lib/sampleMeta";
import { shortReason } from "@/engine/explain";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { HonestyBadge } from "@/components/HonestyBadge";
import { ArrowRightIcon, ChevronIcon, PlayIcon, SearchIcon, StarIcon } from "@/components/Icons";
import { NmcCode } from "@/components/NmcCode";
import { Panel } from "@/components/Panel";
import { Stat } from "@/components/Stat";
import { StatusIcon, StatusPill, type StatusKind } from "@/components/StatusPill";
import { TierChip } from "@/components/TierChip";
import { Callout } from "@/components/Callout";
import { Term } from "@/components/Tooltip";
import { QuickTour } from "@/components/QuickTour";

const PAGE = 50;
type Tab = "all" | RowKind;

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "all", label: "All" },
  { id: "group", label: "Verified" },
  { id: "review", label: "Needs review" },
  { id: "lookalike", label: "Blocked look-alikes" },
  { id: "unique", label: "Unique records" },
];

const KIND_STATUS: Record<RowKind, StatusKind> = { group: "verified", review: "review", lookalike: "reject", unique: "unique" };

function Loading() {
  return <div className="rounded-ctl border border-line bg-white p-8 text-center text-sm text-ink-2">Loading the run…</div>;
}

export function MaterialsView() {
  const { run, status, hydrated, startSample } = useRunStore();
  const router = useRouter();

  if (!hydrated || status === "running") return <Loading />;
  if (!run) {
    return (
      <div className="space-y-5">
        <h1 className="text-[28px]">Material Master</h1>
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
          Run the demo to see which records are verified as the same material, which go to an engineer, and which look-alikes are refused.
        </EmptyState>
      </div>
    );
  }
  return <Loaded />;
}

function Loaded() {
  const run = useRunStore((s) => s.run)!;
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const s = run.summary;

  const rows = useMemo(() => buildRows(run, run.scope === "sample" ? SAMPLE_META.featured : []), [run]);
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: rows.length, group: 0, review: 0, lookalike: 0, unique: 0 };
    for (const r of rows) c[r.kind]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => (tab === "all" || r.kind === tab) && (!q || r.searchText.includes(q)));
    // featured cases are pinned first (stable otherwise)
    return [...list.filter((r) => r.featured), ...list.filter((r) => !r.featured)];
  }, [rows, tab, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const visible = filtered.slice(cur * PAGE, cur * PAGE + PAGE);

  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (!n.delete(k)) n.add(k);
      return n;
    });

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const n = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
      setTab(n.id);
      setPage(0);
      document.getElementById(`tab-${n.id}`)?.focus();
    }
  };

  const f = run.fuzzy;
  const ak = f.answer_key;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px]">Material Master</h1>
        {run.scope === "sample" && (
          <>
            <HonestyBadge kind="SYNTHETIC" />
            <span className="text-sm text-ink-3">{SAMPLE_META.note}</span>
          </>
        )}
      </div>

      <QuickTour />

      <section aria-label="Run summary" className="rounded-ctl border border-line bg-white">
        <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 xl:divide-y-0">
          <Stat value={s.records} label="Records" />
          <Stat value={s.candidate_pairs} label="Candidate pairs examined" />
          <Stat value={s.auto} tone="teal" label="Verified (auto)" icon={<StatusIcon kind="verified" size={14} />} note="pairs" />
          <Stat value={s.review} tone="amber" label="Needs review" icon={<StatusIcon kind="review" size={14} />} note="pairs" />
          <Stat value={s.reject} tone="red" label="Blocked look-alikes (reject)" icon={<StatusIcon kind="reject" size={14} />} note="pairs" />
          <Stat value={s.groups} tone="teal" label="Verified identities" note="groups" />
          <Stat value={s.unique} tone="blue" label="Unique records" icon={<StatusIcon kind="unique" size={14} />} />
        </div>
        <div className="border-t border-line px-4 py-2 text-xs text-ink-3">
          {s.filtered.toLocaleString("en-IN")} unrelated pairs filtered (clearly different, never merged)
          {s.pending > 0 && <> · {s.pending.toLocaleString("en-IN")} records wait on an open review</>}
        </div>
      </section>

      <section aria-label="Comparison with an ordinary matcher" className="rounded-ctl border border-line border-l-4 border-l-navy bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg">Compare with an ordinary matcher</h2>
          <HonestyBadge kind="DEMO" />
        </div>
        <p className="mt-1.5 text-[15px] text-ink">
          An ordinary text matcher would auto-merge <strong className="tnum">{f.fuzzy_auto}</strong> of these pairs; SAMA-NMC stopped{" "}
          <strong className="tnum">{f.stopped_by_sama}</strong> of them.
        </p>
        {ak && (
          <p className="mt-1 text-[15px] text-ink">
            Against the demo answer key it would have made <strong className="tnum text-red-700">{ak.fuzzy_wrong}</strong> wrong merges; SAMA-NMC made{" "}
            <strong className="tnum text-teal-700">{ak.sama_wrong}</strong>.
          </p>
        )}
      </section>

      <Panel bodyClassName="p-0" as="section">
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Filter results" onKeyDown={onTabKey} className="flex flex-wrap gap-1.5">
              {TABS.map((t) => {
                const sel = t.id === tab;
                return (
                  <button
                    key={t.id}
                    id={`tab-${t.id}`}
                    role="tab"
                    type="button"
                    aria-selected={sel}
                    aria-controls="results-panel"
                    tabIndex={sel ? 0 : -1}
                    onClick={() => {
                      setTab(t.id);
                      setPage(0);
                    }}
                    className={`inline-flex items-center gap-2 rounded-ctl border px-3 py-1.5 text-sm font-semibold ${
                      sel ? "border-navy bg-navy text-white" : "border-line-strong bg-white text-ink-2 hover:bg-blue-50"
                    }`}
                  >
                    {t.label}
                    <span className={`rounded-tbl px-1.5 text-xs tnum ${sel ? "bg-navy-800 text-white" : "bg-canvas text-ink-2"}`}>
                      {counts[t.id].toLocaleString("en-IN")}
                    </span>
                  </button>
                );
              })}
            </div>
            <label className="relative block w-full sm:w-72">
              <span className="sr-only">Search descriptions, NMC or legacy codes</span>
              <SearchIcon size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Search description, NMC, code"
                className="h-9 w-full rounded-ctl border border-line-strong bg-white pl-8 pr-3 text-sm placeholder:text-ink-3"
              />
            </label>
          </div>
        </div>

        <div id="results-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line-strong bg-canvas text-xs text-ink-2">
                <th scope="col" className="w-[170px] px-4 py-2 font-semibold">Status</th>
                <th scope="col" className="w-[190px] px-3 py-2 font-semibold">Record / Group</th>
                <th scope="col" className="w-[100px] px-3 py-2 font-semibold"><Term term="CPSE" /></th>
                <th scope="col" className="px-3 py-2 font-semibold">Description</th>
                <th scope="col" className="w-[210px] px-3 py-2 font-semibold">Candidate <Term term="NMC" /></th>
                <th scope="col" className="w-[250px] px-3 py-2 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-2">
                    Nothing matches this filter{query ? ` and "${query}"` : ""}.
                  </td>
                </tr>
              )}
              {visible.map((r) => (
                <Row key={r.key} row={r} expanded={open.has(r.key)} onToggle={() => toggle(r.key)} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm text-ink-2">
          <span aria-live="polite">
            {filtered.length === 0
              ? "No rows"
              : `Showing ${(cur * PAGE + 1).toLocaleString("en-IN")}–${Math.min(filtered.length, cur * PAGE + PAGE).toLocaleString("en-IN")} of ${filtered.length.toLocaleString("en-IN")}`}
          </span>
          {pages > 1 && (
            <span className="flex items-center gap-2">
              <Button variant="secondary" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</Button>
              <span className="tnum">Page {cur + 1} of {pages}</span>
              <Button variant="secondary" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</Button>
            </span>
          )}
        </div>
      </Panel>

      {run.warnings.length > 0 && (
        <Callout tone="attention" title="Notes from the run" role="status">
          {run.warnings.join(" ")}
        </Callout>
      )}
    </div>
  );
}

function Row({ row, expanded, onToggle }: { row: MaterialRow; expanded: boolean; onToggle: () => void }) {
  const d = row.decision;
  const isGroup = row.kind === "group";
  const fired = d && row.kind !== "group" && row.kind !== "unique" ? d.rules.filter((x) => x.fired).map((x) => x.id) : [];
  const statusLabel = row.kind === "lookalike" ? "Blocked look-alike" : undefined;
  const reason =
    row.kind === "unique"
      ? "No other record matches this one."
      : d
        ? shortReason(d)
        : "Every critical attribute is the same.";
  const detailHref = d ? `/review?d=${encodeURIComponent(d.id)}` : null;

  return (
    <Fragment>
      <tr className={`align-top ${row.featured ? "bg-blue-50/60" : "bg-white"} ${expanded ? "" : "border-b border-line"}`}>
        <td className="px-4 py-3">
          <div className="flex flex-col items-start gap-1.5">
            <StatusPill kind={KIND_STATUS[row.kind]} label={statusLabel} />
            {row.featured && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700" title={row.featured.blurb}>
                <StarIcon size={12} className="text-blue-600" /> Featured case
              </span>
            )}
            {d && row.kind !== "group" && row.kind !== "unique" && <TierChip tier={d.tier} />}
          </div>
        </td>
        <td className="px-3 py-3">
          {isGroup ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1.5 rounded-tbl text-left font-semibold text-navy"
            >
              <ChevronIcon size={14} className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
              <span>
                Group of {row.records.length}
                <span className="block text-xs font-normal text-ink-3">{expanded ? "Hide records" : "Show records"}</span>
              </span>
            </button>
          ) : (
            <div className="space-y-0.5 font-mono text-xs text-ink-2">
              {row.records.map((r) => (
                <div key={r.id} className="whitespace-nowrap">{r.id}</div>
              ))}
            </div>
          )}
        </td>
        <td className="px-3 py-3 font-mono text-xs text-ink-2">
          {row.cpses.map((c) => (
            <div key={c} className="whitespace-nowrap">{c}</div>
          ))}
        </td>
        <td className="px-3 py-3">
          {isGroup && row.nmc ? (
            <div className="text-ink">{row.nmc.short_text}</div>
          ) : (
            <div className="space-y-1">
              {row.records.map((r) => (
                <div key={r.id} className="text-ink">{r.raw}</div>
              ))}
            </div>
          )}
          {row.featured && <div className="mt-1 text-xs text-blue-700">{row.featured.title}</div>}
        </td>
        <td className="px-3 py-3">
          {row.nmcCodes.length > 0 ? (
            <div className="space-y-1">
              {row.nmcCodes.map((c) => (
                <div key={c}>
                  <Link href={`/registry?code=${encodeURIComponent(c)}`} className="no-underline hover:underline">
                    <NmcCode code={c} size="sm" />
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-xs text-ink-3">Assigned after review</span>
          )}
        </td>
        <td className="px-3 py-3">
          <div className="text-ink">{reason}</div>
          {fired.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {fired.map((id) => (
                <span key={id} className="rounded-tbl border border-line-strong px-1 font-mono text-xs text-ink-2">{id}</span>
              ))}
            </div>
          )}
          {detailHref && (
            <Link href={detailHref} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold">
              View evidence <ArrowRightIcon size={12} />
            </Link>
          )}
        </td>
      </tr>
      {isGroup && expanded && (
        <tr className="border-b border-line bg-canvas">
          <td colSpan={6} className="px-4 py-3">
            <ul className="m-0 list-none space-y-1.5 p-0">
              {row.records.map((r) => (
                <li key={r.id} className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[190px_1fr_auto]">
                  <span className="font-mono text-xs text-ink-2">{r.id}</span>
                  <span className="text-ink">{r.raw}</span>
                  <span className="font-mono text-xs text-ink-3">legacy {r.matnr}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
