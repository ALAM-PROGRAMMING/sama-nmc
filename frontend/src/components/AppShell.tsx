"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRunStore } from "@/state/runStore";
import { PersonaSwitch } from "./PersonaSwitch";
import { BarsIcon, BookIcon, CloseIcon, FlagIcon, HomeIcon, LockIcon, MenuIcon, ShieldIcon, TableIcon, type IconProps } from "./Icons";

const NAV: Array<{ href: string; label: string; Icon: (p: IconProps) => ReactNode }> = [
  { href: "/", label: "Overview", Icon: HomeIcon },
  { href: "/materials", label: "Material Master", Icon: TableIcon },
  { href: "/review", label: "Match Review", Icon: FlagIcon },
  { href: "/registry", label: "NMC Registry", Icon: BookIcon },
  { href: "/analytics", label: "Analytics", Icon: BarsIcon },
  { href: "/governance", label: "Governance", Icon: ShieldIcon },
];

function isActive(path: string, href: string) {
  const p = path.replace(/\/$/, "") || "/";
  return href === "/" ? p === "/" : p === href || p.startsWith(href + "/");
}

function Brand() {
  return (
    <Link href="/" className="block text-white no-underline hover:text-white">
      <span className="block font-cond text-[22px] font-bold leading-none tracking-wide">SAMA-NMC</span>
      <span className="mt-1 block text-xs text-onnavy">National Material Master</span>
    </Link>
  );
}

function NavList({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main">
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {NAV.map(({ href, label, Icon }) => {
          const active = isActive(path, href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-ctl border-l-[3px] px-3 py-2.5 text-sm no-underline hover:text-white ${
                  active ? "border-white bg-navy-800 font-semibold text-white" : "border-transparent text-onnavy hover:bg-navy-800"
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function RunChip() {
  const run = useRunStore((s) => s.run);
  const status = useRunStore((s) => s.status);
  const scope = useRunStore((s) => s.scope);
  let text = "No run loaded";
  if (status === "running") text = "Run in progress";
  else if (run) text = `${run.scope === "sample" ? "Sample run" : "Your upload"} · ${run.summary.records.toLocaleString("en-IN")} records`;
  else if (status === "error" && scope) text = "Run failed";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-tbl border px-2.5 py-1 text-xs font-semibold ${
        run ? "border-blue-100 bg-blue-50 text-blue-700" : "border-line-strong bg-white text-ink-2"
      }`}
      aria-live="polite"
    >
      <span className={`h-2 w-2 rounded-full ${run ? "bg-blue-600" : "border border-ink-3"}`} aria-hidden="true" />
      {text}
    </span>
  );
}

function AboutDemo() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="about-demo"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-tbl border border-orange-500 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-200"
      >
        <span className="font-mono tracking-wide">DEMO MODE</span>
        <span className="font-normal underline decoration-dotted underline-offset-2">About this demo</span>
      </button>
      {open && (
        <div
          id="about-demo"
          role="dialog"
          aria-label="About this demo"
          className="fixed inset-x-3 top-24 z-50 rounded-ctl border border-line bg-white shadow-pop sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[560px]"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-base">About this demo</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-tbl p-1 text-ink-2 hover:bg-canvas">
              <CloseIcon size={16} />
            </button>
          </div>
          <div className="grid gap-px bg-line sm:grid-cols-2">
            <div className="bg-white p-4">
              <div className="eyebrow text-blue-700">Current demo</div>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm text-ink">
                <li>Runs locally in your browser</li>
                <li>Synthetic sample data</li>
                <li>Demo audit trail</li>
              </ul>
            </div>
            <div className="bg-white p-4">
              <div className="eyebrow">Future pilot</div>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm text-ink">
                <li>On-premise deployment</li>
                <li>Engineer-reviewed engineering tables</li>
                <li>SAP integration</li>
                <li>Larger data volumes</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-line px-4 py-2.5">
            <Link href="/about" onClick={() => setOpen(false)} className="text-sm font-semibold">
              Read more
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Role persona switch in the top bar. Match Review and Governance carry their own copy in the page header. */
function ShellPersona({ path }: { path: string }) {
  const hasRun = useRunStore((s) => !!s.master);
  const own = /^\/(review|governance)(\/|$)/.test(path);
  if (!hasRun || own) return null;
  return <PersonaSwitch compact />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  const [menu, setMenu] = useState(false);
  const bootstrap = useRunStore((s) => s.bootstrap);
  useEffect(() => bootstrap(), [bootstrap]);
  useEffect(() => setMenu(false), [path]);

  return (
    <div className="min-h-screen lg:pl-60 print:pl-0">
      <a
        href="#main"
        className="sr-only z-[60] rounded-ctl bg-white px-3 py-2 font-semibold text-navy focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="on-navy fixed inset-y-0 left-0 hidden w-60 flex-col bg-navy px-3 py-5 lg:flex print:hidden">
        <div className="px-3 pb-6">
          <Brand />
        </div>
        <NavList path={path} />
        <div className="mt-auto border-t border-navy-line px-3 pt-4 text-xs leading-relaxed text-onnavy">
          Smart India Hackathon SIH26099
          <br />
          MoPNG / CPCL
          <br />
          <Link href="/about" className="mt-2 inline-block font-semibold text-white underline underline-offset-2 hover:text-white">
            About this demo
          </Link>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="on-navy sticky top-0 z-40 bg-navy lg:hidden print:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Brand />
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-expanded={menu}
            aria-controls="mobile-nav"
            aria-label={menu ? "Close menu" : "Open menu"}
            className="flex h-10 w-10 items-center justify-center rounded-ctl border border-navy-line text-white"
          >
            {menu ? <CloseIcon size={18} /> : <MenuIcon size={18} />}
          </button>
        </div>
        {menu && (
          <div id="mobile-nav" className="border-t border-navy-line px-3 py-3">
            <NavList path={path} onNavigate={() => setMenu(false)} />
          </div>
        )}
      </header>

      {/* Context bar */}
      <div className="sticky top-14 z-30 border-b border-line bg-white lg:top-0 print:hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:px-8">
          <RunChip />
          <AboutDemo />
          <ShellPersona path={path} />
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-2 lg:ml-auto">
            <LockIcon size={14} className="text-ink-3" />
            Processed locally in your browser
          </span>
        </div>
      </div>

      <main id="main" tabIndex={-1} className="px-4 py-6 outline-none lg:px-8 lg:py-8 print:p-0">
        <div className="mx-auto max-w-[1280px]">{children}</div>
      </main>
    </div>
  );
}
