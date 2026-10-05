"""Versioned YAML config loader (Architecture §6).

`config_version` is the SHA-256 over every config file, so each run records exactly which
tables shaped its decisions. `status` per file feeds the UNVERIFIED TABLE badge.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

DEFAULT_CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"

TABLE_FILES = ("abbreviations", "units", "schedules", "hierarchies", "residual_vocab",
               "risk_words", "manufacturers", "tiers", "models", "equivalence")


@dataclass(frozen=True)
class ClassTemplate:
    class_code: str
    noun: str
    modifier: str | None
    national_name: str
    tier_default: str
    status: str
    head_patterns: tuple[str, ...]
    properties: tuple[dict[str, Any], ...]
    short_text_template: str
    long_text_template: str

    @property
    def critical_props(self) -> list[str]:
        return [p["name"] for p in self.properties if p.get("critical")]

    def prop(self, name: str) -> dict[str, Any]:
        return next(p for p in self.properties if p["name"] == name)


@dataclass(frozen=True, eq=False)       # identity hash, so per-config caches work
class Config:
    root: Path
    tables: dict[str, dict[str, Any]]
    classes: dict[str, ClassTemplate]
    version: str
    status: dict[str, str] = field(default_factory=dict)

    def __getitem__(self, key: str) -> dict[str, Any]:
        return self.tables[key]

    def is_reviewed(self, table: str) -> bool:
        return self.status.get(table) == "reviewed"


def _hash_dir(root: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(root.rglob("*.yaml")):
        if "drafts" in p.parts:
            continue
        h.update(p.relative_to(root).as_posix().encode())
        h.update(p.read_bytes().replace(b"\r\n", b"\n"))   # same hash on Windows and Linux checkouts
    return "sha256:" + h.hexdigest()


def load_config(root: Path | str | None = None) -> Config:
    root = Path(root) if root else DEFAULT_CONFIG_DIR
    tables: dict[str, dict[str, Any]] = {}
    status: dict[str, str] = {}
    for name in TABLE_FILES:
        data = yaml.safe_load((root / f"{name}.yaml").read_text(encoding="utf-8")) or {}
        tables[name] = data
        status[name] = data.get("status", "draft")
    classes: dict[str, ClassTemplate] = {}
    for p in sorted((root / "classes").glob("*.yaml")):
        c = yaml.safe_load(p.read_text(encoding="utf-8"))
        classes[str(c["class_code"])] = ClassTemplate(
            class_code=str(c["class_code"]), noun=c["noun"], modifier=c.get("modifier"),
            national_name=c["national_name"], tier_default=c["tier_default"],
            status=c.get("status", "draft"), head_patterns=tuple(c.get("head_patterns") or ()),
            properties=tuple(c.get("properties") or ()),
            short_text_template=c["short_text_template"], long_text_template=c["long_text_template"])
        status[f"class:{c['class_code']}"] = c.get("status", "draft")
    return Config(root=root, tables=tables, classes=classes, version=_hash_dir(root), status=status)


@lru_cache(maxsize=4)
def default_config() -> Config:
    return load_config()
