import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import golden from "../golden/audit.json";
import { AuditChain, canonicalJson, tamperedCopy, verifyChain } from "../audit";
import { sha256Hex } from "../sha256";
import type { AuditEvent } from "../types";

describe("sha256", () => {
  it("matches node crypto on assorted inputs, including unicode and block boundaries", () => {
    const inputs = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(1000), "ÄÖÜ ß 日本語 😀"];
    for (const s of inputs) expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
  });
});

describe("audit chain parity with Python", () => {
  it("reproduces every event hash from the Python reference", () => {
    const chain = new AuditChain();
    for (const [actor, action, et, eid, payload] of golden.events_in as [string, string, string, string, AuditEvent["payload"]][]) {
      chain.append(golden.ts, actor, action, et, eid, payload);
    }
    expect(chain.events).toEqual(golden.chain);
    expect(chain.verify()).toEqual({ ok: true, broken_at: null });
  });

  it("canonical JSON sorts keys and keeps non-ASCII raw", () => {
    expect(canonicalJson({ b: 1, a: "ß", c: [true, null] })).toBe('{"a":"ß","b":1,"c":[true,null]}');
    expect(() => canonicalJson({ x: 1.5 })).toThrow();
  });

  it("tampering breaks the chain at exactly that event", () => {
    const events = golden.chain as unknown as AuditEvent[];
    expect(verifyChain(tamperedCopy(events, 3))).toEqual({ ok: false, broken_at: 3 });
    expect(verifyChain(events).ok).toBe(true);                      // the original is untouched
  });
});
