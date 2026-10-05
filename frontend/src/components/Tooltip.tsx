"use client";
import { useId, useState, type ReactNode } from "react";

/** Hover / focus glossary tip. The trigger is focusable, Escape dismisses. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <span tabIndex={0} aria-describedby={id} className="inline-flex cursor-help rounded-tbl">
        {children}
      </span>
      <span
        role="tooltip"
        id={id}
        className={`pointer-events-none absolute left-0 top-full z-30 mt-1.5 w-64 max-w-[80vw] rounded-ctl bg-navy px-3 py-2 text-left text-xs font-normal normal-case leading-snug tracking-normal text-white shadow-pop ${
          open ? "block" : "hidden"
        }`}
      >
        {label}
      </span>
    </span>
  );
}

const GLOSSARY = {
  NMC: "National Material Code: one permanent national identity for a material, shared by every company that buys it.",
  crosswalk: "The list that links each company's own legacy material number to the one national code.",
  CPSE: "Central Public Sector Enterprise: a government-owned company such as CPCL.",
  "Tier R": "An engineered item. A person always checks it, and approval needs two people including an engineer.",
} as const;

export function Term({ term, children }: { term: keyof typeof GLOSSARY; children?: ReactNode }) {
  return (
    <Tooltip label={GLOSSARY[term]}>
      <span className="border-b border-dotted border-ink-3">{children ?? term}</span>
    </Tooltip>
  );
}
