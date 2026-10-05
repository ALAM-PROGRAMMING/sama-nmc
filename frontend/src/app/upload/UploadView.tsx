"use client";
import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { ChevronIcon, DownloadIcon, FileIcon, LockIcon, PlayIcon, UploadIcon } from "@/components/Icons";
import { Panel } from "@/components/Panel";
import { CSV_MAX_ROWS, type CsvIssue, type CsvResult } from "@/engine/types";
import { fmtMoney } from "@/lib/format";
import { parseUpload, withBase } from "@/state/engineFacade";
import { useRunStore } from "@/state/runStore";

const MAX_BYTES = 8 * 1024 * 1024;

const FORMAT: Array<{ col: string; need: "Required" | "Optional"; what: string }> = [
  { col: "cpse", need: "Required", what: "Your company's short name, e.g. PLANT_A" },
  { col: "matnr", need: "Required", what: "The material number in your own system (the legacy code)" },
  { col: "maktx", need: "Required", what: "The material description as it is written today" },
  { col: "long_text", need: "Optional", what: "A longer description, if you have one" },
  { col: "meins", need: "Optional", what: "Unit of measure, e.g. EA" },
  { col: "mfr", need: "Optional", what: "Manufacturer name" },
  { col: "mpn", need: "Optional", what: "Manufacturer part number" },
  { col: "last_po_price", need: "Optional", what: "Last purchase-order price (a number)" },
  { col: "annual_qty", need: "Optional", what: "Annual quantity (a number)" },
  { col: "characteristics", need: "Optional", what: 'Extra attributes as a JSON object, e.g. {"face": "RF"}' },
];

type Problem = { title: string; message: string };

export function UploadView() {
  const router = useRouter();
  const startUpload = useRunStore((s) => s.startUpload);
  const startSample = useRunStore((s) => s.startSample);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<CsvResult | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const template = withBase("/sample/sama_nmc_template.csv");

  function reject(title: string, message: string) {
    setResult(null);
    setProblem({ title, message });
  }

  async function onFile(file: File | undefined | null) {
    if (!file) return;
    setName(file.name);
    setResult(null);
    setProblem(null);
    if (!/\.csv$/i.test(file.name)) {
      reject("That is not a CSV file", `"${file.name}" does not end in .csv. Save your table as a CSV file (comma separated, UTF-8) and choose it again, or start from the template.`);
      return;
    }
    if (file.size === 0) {
      reject("The file is empty", "There is nothing in this file. Start from the template, fill in your materials and upload it again.");
      return;
    }
    if (file.size > MAX_BYTES) {
      reject("The file is too large", `This file is ${(file.size / 1048576).toFixed(1)} MB. The demo reads files up to ${MAX_BYTES / 1048576} MB, and at most ${CSV_MAX_ROWS.toLocaleString("en-US")} rows.`);
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      setResult(await parseUpload(text));
    } catch {
      reject("This file could not be read", "The browser could not open the file. Check that it is a plain CSV (UTF-8) and try again, or start from the template.");
    } finally {
      setBusy(false);
    }
  }

  const errors: CsvIssue[] = result?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings: CsvIssue[] = result?.issues.filter((i) => i.severity === "warning") ?? [];
  const TemplateLink = () => (
    <a href={template} download className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-ctl border border-navy bg-white px-3 text-sm font-semibold text-navy no-underline hover:bg-blue-50 hover:text-navy">
      <DownloadIcon size={15} /> Download template
    </a>
  );

  return (
    <div className="max-w-[820px] space-y-5">
      <div>
        <h1 className="text-[28px] leading-tight">Upload a SAMA-NMC formatted material CSV.</h1>
        <p className="mt-1.5 flex items-start gap-1.5 text-sm text-ink-2">
          <LockIcon size={14} className="mt-0.5 shrink-0 text-ink-3" />
          <span>Your uploaded file is processed locally in this browser. It is never sent anywhere.</span>
        </p>
      </div>

      <Panel bodyClassName="p-5 sm:p-6">
        <div
          onDragOver={(e: DragEvent) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            setDrag(false);
            void onFile(e.dataTransfer.files?.[0]);
          }}
          className={`rounded-ctl border border-dashed p-6 text-center ${drag ? "border-blue-600 bg-blue-50" : "border-line-strong bg-canvas"}`}
        >
          <UploadIcon size={26} className="mx-auto text-blue-600" />
          <p className="mt-2 text-[15px] text-ink">Drop your CSV here, or choose a file.</p>
          <p className="mt-0.5 text-xs text-ink-3">.csv only, up to {CSV_MAX_ROWS.toLocaleString("en-US")} rows</p>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            id="csv-file"
            aria-label="Choose a CSV file"
            data-testid="csv-input"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button onClick={() => input.current?.click()}>
              <FileIcon size={15} /> Choose a file
            </Button>
            <a href={template} download className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-navy bg-white px-3.5 text-sm font-semibold text-navy no-underline hover:bg-blue-50 hover:text-navy">
              <DownloadIcon size={15} /> Download template
            </a>
          </div>
          {name && <p className="mt-3 break-all font-mono text-xs text-ink-2" data-testid="file-name">{name}</p>}
          {busy && <p className="mt-2 text-sm text-ink-2" role="status">Reading the file…</p>}
        </div>

        <details className="group mt-4 rounded-ctl border border-line">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-semibold text-navy">
            <ChevronIcon size={14} className="transition-transform group-open:rotate-90" /> Required format
          </summary>
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[520px] border-collapse text-left text-sm">
              <caption className="sr-only">Columns of the SAMA-NMC CSV</caption>
              <thead>
                <tr className="bg-canvas text-xs text-ink-2">
                  <th scope="col" className="px-4 py-2 font-semibold">Column</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Needed?</th>
                  <th scope="col" className="px-3 py-2 font-semibold">What to put in it</th>
                </tr>
              </thead>
              <tbody>
                {FORMAT.map((f) => (
                  <tr key={f.col} className="border-t border-line align-top">
                    <td className="px-4 py-2 font-mono text-[13px] text-ink">{f.col}</td>
                    <td className={`px-3 py-2 text-xs font-semibold ${f.need === "Required" ? "text-navy" : "text-ink-3"}`}>{f.need}</td>
                    <td className="px-3 py-2 text-ink-2">{f.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
              The first row must be the header. Each cpse and matnr pair may appear once. At most {CSV_MAX_ROWS.toLocaleString("en-US")} rows. UTF-8 text.
            </p>
          </div>
        </details>

        <div className="mt-3">
          <Callout tone="info">
            Items outside the currently templated material classes become GENERIC: review only, never auto-merged.
          </Callout>
        </div>

        {problem && (
          <div className="mt-4">
            <Callout tone="danger" title={problem.title} role="alert">
              {problem.message}
              <div><TemplateLink /></div>
            </Callout>
          </div>
        )}

        {result && (
          <div className="mt-4 space-y-3">
            {errors.map((i, k) => (
              <Callout key={`e${k}`} tone="danger" title="This file cannot be used yet" role="alert">
                {i.message}
                <div><TemplateLink /></div>
              </Callout>
            ))}
            {warnings.map((i, k) => (
              <Callout key={`w${k}`} tone="attention" title="Heads up" role="status">
                {i.message}
              </Callout>
            ))}
            {result.ok && (
              <div className="space-y-4" data-testid="preview">
                <Callout tone="good" role="status">
                  <strong className="tnum">{result.records.length.toLocaleString("en-IN")}</strong> {result.records.length === 1 ? "record" : "records"} ready.
                  {warnings.length > 0 && " Some rows needed attention (see above); everything else is used as it is."}
                </Callout>
                <div>
                  <div className="eyebrow">First {Math.min(5, result.records.length)} rows</div>
                  <div className="mt-1.5 overflow-x-auto rounded-ctl border border-line">
                    <table className="w-full min-w-[600px] border-collapse text-left text-sm">
                      <caption className="sr-only">Preview of the first rows</caption>
                      <thead>
                        <tr className="bg-canvas text-xs text-ink-2">
                          <th scope="col" className="px-3 py-2 font-semibold">cpse</th>
                          <th scope="col" className="px-3 py-2 font-semibold">matnr</th>
                          <th scope="col" className="px-3 py-2 font-semibold">maktx</th>
                          <th scope="col" className="px-3 py-2 font-semibold">meins</th>
                          <th scope="col" className="px-3 py-2 text-right font-semibold">price</th>
                          <th scope="col" className="px-3 py-2 text-right font-semibold">qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.records.slice(0, 5).map((r) => (
                          <tr key={r.record_id} className="border-t border-line align-top">
                            <td className="px-3 py-2 font-mono text-xs text-ink-2">{r.cpse}</td>
                            <td className="px-3 py-2 font-mono text-xs text-ink-2">{r.matnr}</td>
                            <td className="px-3 py-2 text-ink">{r.maktx}</td>
                            <td className="px-3 py-2 text-ink-2">{r.meins || "—"}</td>
                            <td className="px-3 py-2 text-right tnum text-ink-2">{r.last_po_price === null ? "—" : fmtMoney(r.last_po_price)}</td>
                            <td className="px-3 py-2 text-right tnum text-ink-2">{r.annual_qty === null ? "—" : fmtMoney(r.annual_qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="lg"
                    onClick={() => {
                      void startUpload(result.records);
                      router.push("/run");
                    }}
                  >
                    <PlayIcon size={14} /> Run SAMA-NMC
                  </Button>
                  <span className="text-sm text-ink-3">on {result.records.length.toLocaleString("en-IN")} records</span>
                </div>
              </div>
            )}
          </div>
        )}
      </Panel>

      <p className="text-sm text-ink-2">
        No file to hand?{" "}
        <button
          type="button"
          className="font-semibold text-blue-700 underline underline-offset-2"
          onClick={() => {
            void startSample();
            router.push("/run");
          }}
        >
          Use sample data instead
        </button>
        . It is synthetic demo data. <Link href="/about">How decisions are made</Link>.
      </p>
    </div>
  );
}
