"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { MasterState } from "@/engine/types";
import { buildIdentityRows, buildPending, type IdentityRow } from "@/lib/registry";
import { Button } from "@/components/Button";
import { HonestyBadge } from "@/components/HonestyBadge";
import { ArrowRightIcon, ChevronIcon, SearchIcon } from "@/components/Icons";
import { NmcCode } from "@/components/NmcCode";
import { Panel } from "@/components/Panel";
import { StatusPill } from "@/components/StatusPill";
import { Term } from "@/components/Tooltip";

const PAGE = 50;
const PENDING_SHOWN = 12;
type Kind = "all" | "cluster" | "singleton";

function ChangeBadge({ change }: { change: IdentityRow["change"] }) {
  if (!change) return null;
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-tbl border border-blue-600 bg-blue-50 px-1.5 py-px text-xs font-semibold text-blue-700">
      {change === "created" ? "Created by a reviewer" : "Extended by a reviewer"}
    </span>
  );
}

export function RegistryList({ master }: { master: MasterState }) {
  const run = master.run;
  const rows = useMemo(() => buildIdentityRows(master), [master]);
  const pending = useMemo(() => buildPending(master), [master]);
  const [kind, setKind] = useState<Kind>("all");
  const [cls, setCls] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [showAllPending, setShowAllPending] = useState(false);

  const classes = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.nmc.class_code, r.className);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [rows]);

  const counts = useMemo(() => ({
    all: rows.length,
    cluster: rows.filter((r) => r.nmc.kind === "cluster").length,
    singleton: rows.filter((r) => r.nmc.kind === "singleton").length,
  }), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (kind === "all" || r.nmc.kind === kind) && (cls === "all" || r.nmc.class_code === cls) && (!q || r.searchText.includes(q)));
  }, [rows, kind, cls, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const visible = filtered.slice(cur * PAGE, cur * PAGE + PAGE);
  const legacyTotal = rows.reduce((s, r) => s + r.legacyCount, 0);

  const KINDS: Array<{ id: Kind; label: string }> = [
    { id: "all", label: "All identities" },
    { id: "cluster", label: "Verified groups" },
    { id: "singleton", label: "Unique" },
  ];

  return (
    <>
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px]">NMC Registry</h1>
          {run.scope === "sample" && <HonestyBadge kind="SYNTHETIC" />}
        </div>
        <p className="mt-1.5 max-w-[760px] text-[15px] text-ink-2">
          Each material gets one permanent national identity (<Term term="NMC" />). The old codes are kept beside it in a <Term term="crosswalk" />:
          <strong className="text-ink"> nothing is renumbered or erased.</strong>
        </p>
        <p className="mt-1 text-sm text-ink-3">
          {rows.length.toLocaleString("en-IN")} identities carrying {legacyTotal.toLocaleString("en-IN")} legacy codes.
        </p>
      </div>

      <Panel bodyClassName="p-0" as="section">
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => {
                const sel = k.id === kind;
                return (
                  <button
                    key={k.id}
                    type="button"
                    aria-pressed={sel}
                    onClick={() => {
                      setKind(k.id);
                      setPage(0);
                    }}
                    className={`inline-flex items-center gap-2 rounded-ctl border px-3 py-1.5 text-sm font-semibold ${
                      sel ? "border-navy bg-navy text-white" : "border-line-strong bg-white text-ink-2 hover:bg-blue-50"
                    }`}
                  >
                    {k.label}
                    <span className={`rounded-tbl px-1.5 text-xs tnum ${sel ? "bg-navy-800 text-white" : "bg-canvas text-ink-2"}`}>
                      {counts[k.id].toLocaleString("en-IN")}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <label className="block">
                <span className="sr-only">Material class</span>
                <select
                  value={cls}
                  onChange={(e) => {
                    setCls(e.target.value);
                    setPage(0);
                  }}
                  className="h-9 w-full rounded-ctl border border-line-strong bg-white px-2 text-sm sm:w-56"
                >
                  <option value="all">All material classes</option>
                  {classes.map(([c, n]) => (
                    <option key={c} value={c}>{c} · {n}</option>
                  ))}
                </select>
              </label>
              <label className="relative block w-full sm:w-64">
                <span className="sr-only">Search identities, descriptions or legacy codes</span>
                <SearchIcon size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Search NMC, text, legacy code"
                  className="h-9 w-full rounded-ctl border border-line-strong bg-white pl-8 pr-3 text-sm placeholder:text-ink-3"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left text-sm">
            <caption className="sr-only">National material identities</caption>
            <thead>
              <tr className="border-b border-line-strong bg-canvas text-xs text-ink-2">
                <th scope="col" className="w-[230px] px-4 py-2 font-semibold"><Term term="NMC" /></th>
                <th scope="col" className="px-3 py-2 font-semibold">Short text and class</th>
                <th scope="col" className="w-[110px] px-3 py-2 font-semibold">Legacy codes</th>
                <th scope="col" className="w-[90px] px-3 py-2 font-semibold"><Term term="CPSE" />s</th>
                <th scope="col" className="w-[210px] px-3 py-2 font-semibold">Kind</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-2">
                    No identity matches this filter{query ? ` and "${query}"` : ""}.
                  </td>
                </tr>
              )}
              {visible.map((r) => (
                <tr key={r.nmc.code} className="border-b border-line align-top">
                  <td className="px-4 py-3">
                    <Link href={`/registry?code=${encodeURIComponent(r.nmc.code)}`} className="no-underline hover:underline" aria-label={`Open ${r.nmc.code}`}>
                      <NmcCode code={r.nmc.code} size="sm" />
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-ink">{r.nmc.short_text}</div>
                    <div className="mt-0.5 text-xs text-ink-3">{r.className} · class {r.nmc.class_code}</div>
                  </td>
                  <td className="px-3 py-3 tnum">{r.legacyCount}</td>
                  <td className="px-3 py-3 tnum">{r.cpses.length}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start gap-1.5">
                      {r.nmc.kind === "cluster" ? <StatusPill kind="verified" label="Verified group" /> : <StatusPill kind="unique" label="Unique" />}
                      <ChangeBadge change={r.change} />
                    </div>
                  </td>
                </tr>
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

      <section aria-labelledby="pending-h" className="rounded-ctl border border-line bg-white">
        <div className="border-b border-line px-5 py-3">
          <h2 id="pending-h" className="text-lg">
            Pending identity <span className="tnum text-ink-3">({pending.length.toLocaleString("en-IN")})</span>
          </h2>
          <p className="mt-0.5 text-sm text-ink-2">These records wait for an engineer; they get an identity only after a decision.</p>
        </div>
        {pending.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-2">No record is waiting. Every record has an identity.</p>
        ) : (
          <>
            <ul className="m-0 list-none divide-y divide-line p-0">
              {(showAllPending ? pending : pending.slice(0, PENDING_SHOWN)).map(({ record, decision }) => (
                <li key={record.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5">
                  <StatusPill kind="pending" label="Pending" />
                  <span className="font-mono text-xs text-ink-2">{record.id}</span>
                  <span className="min-w-0 flex-1 text-sm text-ink">{record.raw}</span>
                  {decision ? (
                    <Link href={`/review?d=${encodeURIComponent(decision.id)}`} className="inline-flex items-center gap-1 text-sm font-semibold">
                      Open in Match Review <ArrowRightIcon size={12} />
                    </Link>
                  ) : (
                    <span className="text-xs text-ink-3">No open item</span>
                  )}
                </li>
              ))}
            </ul>
            {pending.length > PENDING_SHOWN && (
              <div className="border-t border-line px-5 py-2.5">
                <button type="button" onClick={() => setShowAllPending((v) => !v)} className="text-sm font-semibold text-blue-700 underline underline-offset-2">
                  {showAllPending ? "Show fewer" : `Show all ${pending.length.toLocaleString("en-IN")}`}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <details className="group rounded-ctl border border-line bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[15px] font-semibold text-navy">
          <ChevronIcon size={14} className="transition-transform group-open:rotate-90" />
          Retired identities <span className="tnum font-normal text-ink-3">({master.retired.length})</span>
          <span className="font-normal text-ink-3">· retired, never deleted, never reused</span>
        </summary>
        <div className="border-t border-line px-5 py-3">
          {master.retired.length === 0 ? (
            <p className="text-sm text-ink-2">No identity has been retired. When a reviewer merges two identities, the older code is listed here with the code that replaced it.</p>
          ) : (
            <ul className="m-0 list-none space-y-1.5 p-0">
              {master.retired.map((r) => (
                <li key={r.code} className="flex flex-wrap items-center gap-x-3 text-sm">
                  <span className="line-through decoration-ink-3"><NmcCode code={r.code} size="sm" /></span>
                  <span className="text-ink-3">superseded by</span>
                  <Link href={`/registry?code=${encodeURIComponent(r.superseded_by)}`} className="no-underline hover:underline"><NmcCode code={r.superseded_by} size="sm" /></Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </>
  );
}
