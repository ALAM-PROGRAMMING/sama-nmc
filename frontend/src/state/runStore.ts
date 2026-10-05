"use client";
import { create } from "zustand";
import {
  STAGE_LABELS,
  type Actor,
  type MasterState,
  type RawRecord,
  type ReasonCode,
  type ReviewOutcome,
  type RunOutput,
  type RunProgress,
} from "@/engine/types";
import { applyReviewAction, createMaster } from "@/engine/master";
import { ensureAssets } from "@/engine/client";
import { runEngineFor, runSample } from "./engineFacade";
import type { StageView } from "@/components/StageList";

const MIN_STAGE_MS = 350; // presentation only: keeps a fast run readable
const SAMPLE_FLAG = "sama.sampleLoaded";
const REVIEW_LOG = "sama.reviewLog"; // sample run only: lets reviewer decisions survive a refresh
const UNITS = ["records", "candidate pairs", "pairs compared", "pairs checked", "decisions", "identities"];

const freshStages = (): StageView[] =>
  STAGE_LABELS.map((label, i) => ({ label, status: "pending", done: 0, total: 0, unit: UNITS[i] }));

export interface ReviewLogEntry {
  decisionId: string;
  actor: Actor;
  action: "approve" | "reject";
  reason?: ReasonCode;
  at: string;
}

export interface RunStore {
  run: RunOutput | null;
  /** The run plus reviewer decisions, identity changes and the continuing audit chain. Reviewer actions never change the run itself. */
  master: MasterState | null;
  /** Who is acting in the demo: a role persona, never a made-up person. */
  actor: Actor;
  reviewLog: ReviewLogEntry[];
  lastOutcome: ReviewOutcome | null;
  setActor: (a: Actor) => void;
  review: (decisionId: string, action: "approve" | "reject", reason?: ReasonCode) => ReviewOutcome | null;
  scope: "sample" | "upload" | null;
  source: "sample" | "upload" | null;
  progress: RunProgress | null;
  stages: StageView[];
  status: "idle" | "running" | "error";
  error: string | null;
  /** false until the first client-side bootstrap has decided whether to restore a sample run */
  hydrated: boolean;
  startSample: (opts?: { silent?: boolean }) => Promise<void>;
  startUpload: (records: RawRecord[]) => Promise<void>;
  reset: () => void;
  bootstrap: () => void;
}

function readLog(): ReviewLogEntry[] {
  try {
    return JSON.parse(sessionStorage.getItem(REVIEW_LOG) ?? "[]") as ReviewLogEntry[];
  } catch {
    return [];
  }
}
function writeLog(log: ReviewLogEntry[]) {
  try {
    if (log.length) sessionStorage.setItem(REVIEW_LOG, JSON.stringify(log));
    else sessionStorage.removeItem(REVIEW_LOG);
  } catch {
    /* storage blocked: decisions will not survive a refresh */
  }
}

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(SAMPLE_FLAG) === "1";
  } catch {
    return false;
  }
}
function writeFlag(on: boolean) {
  try {
    if (on) sessionStorage.setItem(SAMPLE_FLAG, "1");
    else sessionStorage.removeItem(SAMPLE_FLAG);
  } catch {
    /* storage blocked: deep links simply will not survive a refresh */
  }
}

let runToken = 0; // ignores results of a superseded run

export const useRunStore = create<RunStore>((set, get) => {
  /** Drive the stage list from real engine progress, with a minimum visible time per stage. */
  async function execute(source: "sample" | "upload", engine: (onProgress: (p: RunProgress) => void) => Promise<RunOutput>, silent: boolean) {
    const token = ++runToken;
    set({ status: "running", error: null, run: null, source, scope: source, progress: null, stages: freshStages() });

    const latest: Array<RunProgress | undefined> = [];
    let reached = -1;
    let finished = false;
    let failed: unknown = null;
    const enginePromise = engine((p) => {
      latest[p.stage] = p;
      reached = Math.max(reached, p.stage);
    }).then(
      (r) => { finished = true; return r; },
      (e) => { finished = true; failed = e ?? new Error("The run failed."); return null; },
    );

    const patch = (i: number, v: Partial<StageView>) =>
      set((s) => ({ stages: s.stages.map((st, k) => (k === i ? { ...st, ...v } : st)) }));
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    for (let i = 0; i < STAGE_LABELS.length && !failed; i++) {
      while (reached < i && !finished) await wait(25);
      if (token !== runToken) return;
      const shownAt = Date.now();
      patch(i, { status: "active" });
      const sync = () => {
        const p = latest[i];
        if (p) {
          patch(i, { done: p.done, total: p.total });
          set({ progress: p });
        }
      };
      for (;;) {
        sync();
        const complete = latest[i] ? latest[i]!.done >= latest[i]!.total : true;
        const moved = reached > i || finished;
        const elapsed = Date.now() - shownAt >= (silent ? 0 : MIN_STAGE_MS);
        if (elapsed && (complete || moved)) break;
        await wait(30);
        if (token !== runToken) return;
      }
      const p = latest[i];
      patch(i, { status: "done", done: p ? p.total : 0, total: p ? p.total : 0 });
    }

    const result = await enginePromise;
    if (token !== runToken) return;
    if (failed || !result) {
      const msg = failed instanceof Error ? failed.message : "The run could not be completed.";
      set({ status: "error", error: msg, hydrated: true });
      return;
    }
    await ensureAssets();                       // class templates are needed for identity changes after approvals
    let master = createMaster(result);
    let log: ReviewLogEntry[] = [];
    if (source === "sample") {
      // replay decisions made earlier in this tab, with their original timestamps, so the audit chain is reproduced
      for (const e of readLog()) {
        const r = applyReviewAction(master, e.decisionId, e.actor, e.action, { now: e.at, reason_code: e.reason });
        if (r.outcome.ok) {
          master = r.master;
          log.push(e);
        }
      }
    } else {
      writeLog([]);
    }
    if (token !== runToken) return;
    set({ run: result, master, reviewLog: log, lastOutcome: null, status: "idle", hydrated: true });
    if (source === "sample") writeFlag(true);
  }

  return {
    run: null,
    master: null,
    actor: "Demo analyst" as Actor,
    reviewLog: [],
    lastOutcome: null,
    setActor: (a) => set({ actor: a }),
    review: (decisionId, action, reason) => {
      const { master, actor, source } = get();
      if (!master) return null;
      const at = new Date().toISOString();
      const r = applyReviewAction(master, decisionId, actor, action, { now: at, reason_code: reason });
      if (r.outcome.ok) {
        const log = [...get().reviewLog, { decisionId, actor, action, reason, at }];
        set({ master: r.master, reviewLog: log, lastOutcome: r.outcome });
        if (source === "sample") writeLog(log);
      } else {
        set({ lastOutcome: r.outcome });
      }
      return r.outcome;
    },
    scope: null,
    source: null,
    progress: null,
    stages: freshStages(),
    status: "idle",
    error: null,
    hydrated: false,

    startSample: (opts) => execute("sample", (onProgress) => runSample(onProgress, !!opts?.silent), !!opts?.silent),

    // Uploaded data stays in memory only: never written to any storage.
    startUpload: (records) => {
      writeFlag(false);
      return execute("upload", (onProgress) => runEngineFor(records, { scope: "upload" }, onProgress), false);
    },

    reset: () => {
      runToken++;
      writeFlag(false);
      writeLog([]);
      set({ run: null, master: null, reviewLog: [], lastOutcome: null, scope: null, source: null, progress: null, stages: freshStages(), status: "idle", error: null, hydrated: true });
    },

    bootstrap: () => {
      if (get().hydrated) return;
      if (readFlag() && !get().run && get().status === "idle") {
        void get().startSample({ silent: true });
      } else if (get().status === "idle") {
        set({ hydrated: true });
      }
    },
  };
});
