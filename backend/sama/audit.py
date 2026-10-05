"""SHA-256 hash-chained audit log (FR-AUD-01/02, Architecture §7.11).

Each event includes the hash of the previous one, so editing any past event breaks the chain
visibly. The browser engine implements the identical canonical-JSON + SHA-256 definition.

Payload values must be strings, integers or booleans (no floats): float formatting differs
between Python and JavaScript, which would break byte-identical hashing.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

GENESIS = "0" * 64


def canonical_json(o: Any) -> str:
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def event_hash(prev_hash: str, body: dict) -> str:
    return hashlib.sha256((prev_hash + canonical_json(body)).encode("utf-8")).hexdigest()


@dataclass
class AuditChain:
    events: list[dict] = field(default_factory=list)

    def append(self, ts: str, actor: str, action: str, entity_type: str, entity_id: str, payload: dict) -> dict:
        prev = self.events[-1]["hash"] if self.events else GENESIS
        body = {"ts": ts, "actor": actor, "action": action, "entity_type": entity_type, "entity_id": entity_id,
                "payload": payload}
        ev = {"seq": len(self.events) + 1, **body, "prev_hash": prev, "hash": event_hash(prev, body)}
        self.events.append(ev)
        return ev

    def verify(self) -> dict:
        prev = GENESIS
        for ev in self.events:
            body = {k: ev[k] for k in ("ts", "actor", "action", "entity_type", "entity_id", "payload")}
            if ev["prev_hash"] != prev or event_hash(prev, body) != ev["hash"]:
                return {"ok": False, "broken_at": ev["seq"]}
            prev = ev["hash"]
        return {"ok": True, "broken_at": None}
