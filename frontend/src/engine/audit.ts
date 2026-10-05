/**
 * SHA-256 hash-chained audit log: the browser twin of backend/sama/audit.py.
 *
 * Each event carries the hash of the previous event, so editing any past event breaks the chain
 * visibly. Payload values are strings, integers or booleans only: float formatting differs between
 * Python and JavaScript, which would make hashes diverge.
 */
import { sha256Hex } from "./sha256";
import type { AuditEvent } from "./types";

export const GENESIS = "0".repeat(64);

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Same bytes as Python json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False). */
export function canonicalJson(o: Json): string {
  if (o === null || typeof o === "boolean" || typeof o === "string") return JSON.stringify(o);
  if (typeof o === "number") {
    if (!Number.isInteger(o)) throw new Error("audit payloads must not contain non-integer numbers");
    return String(o);
  }
  if (Array.isArray(o)) return "[" + o.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson((o as { [k: string]: Json })[k])).join(",") + "}";
}

type Body = Pick<AuditEvent, "ts" | "actor" | "action" | "entity_type" | "entity_id" | "payload">;

export function eventHash(prevHash: string, body: Body): string {
  return sha256Hex(prevHash + canonicalJson(body as unknown as Json));
}

export class AuditChain {
  events: AuditEvent[];

  constructor(events: AuditEvent[] = []) {
    this.events = events;
  }

  append(ts: string, actor: string, action: string, entity_type: string, entity_id: string, payload: AuditEvent["payload"]): AuditEvent {
    const prev = this.events.length ? this.events[this.events.length - 1].hash : GENESIS;
    const body: Body = { ts, actor, action, entity_type, entity_id, payload };
    const ev: AuditEvent = { seq: this.events.length + 1, ...body, prev_hash: prev, hash: eventHash(prev, body) };
    this.events.push(ev);
    return ev;
  }

  verify(): { ok: boolean; broken_at: number | null } {
    return verifyChain(this.events);
  }
}

export function verifyChain(events: AuditEvent[]): { ok: boolean; broken_at: number | null } {
  let prev = GENESIS;
  for (const ev of events) {
    const body: Body = { ts: ev.ts, actor: ev.actor, action: ev.action, entity_type: ev.entity_type, entity_id: ev.entity_id, payload: ev.payload };
    if (ev.prev_hash !== prev || eventHash(prev, body) !== ev.hash) return { ok: false, broken_at: ev.seq };
    prev = ev.hash;
  }
  return { ok: true, broken_at: null };
}

/** Demo helper for the tamper test: returns a COPY of the chain with one event's payload altered. */
export function tamperedCopy(events: AuditEvent[], seq: number): AuditEvent[] {
  return events.map((e) => (e.seq === seq ? { ...e, payload: { ...e.payload, tampered: true } } : e));
}
