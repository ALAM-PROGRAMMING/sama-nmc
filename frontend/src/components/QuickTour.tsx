"use client";
import { useEffect, useState } from "react";
import { CloseIcon, InfoIcon } from "./Icons";

const KEY = "sama.tourDismissed";

const TIPS = [
  { t: "What the table shows", d: "Each row is a verified group of records, a pair waiting for a person, a blocked look-alike or a unique record. The coloured status always comes with a word." },
  { t: "How to open a match", d: "Use View evidence on a row to see the two descriptions side by side and why the system decided as it did. Click a group to see its records." },
  { t: "Where the evidence is", d: "Evidence lives in Match Review, and every identity with its old codes is in NMC Registry. Nothing is hidden behind a score." },
];

/** A small, dismissible first-run card. Dismissal is remembered for this tab only (sessionStorage). */
export function QuickTour() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(sessionStorage.getItem(KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* storage blocked: the tip simply returns on the next visit */
    }
  };
  return (
    <section aria-label="Quick tour" className="rounded-ctl border border-blue-100 bg-blue-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <InfoIcon size={16} className="mt-1 shrink-0 text-blue-600" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base">Quick tour</h2>
          <ul className="m-0 mt-1.5 grid list-none gap-x-6 gap-y-2 p-0 md:grid-cols-3">
            {TIPS.map((t) => (
              <li key={t.t} className="text-sm text-ink">
                <strong className="text-navy">{t.t}.</strong> <span className="text-ink-2">{t.d}</span>
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss quick tour"
          className="shrink-0 rounded-tbl p-1.5 text-ink-2 hover:bg-blue-100"
        >
          <CloseIcon size={16} />
        </button>
      </div>
    </section>
  );
}
