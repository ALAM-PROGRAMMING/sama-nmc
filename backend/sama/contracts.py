"""Shared data contracts for the SAMA-NMC pipeline (Architecture §5, §7.12).

Every module reads and writes these models. Keep them stable: change a field only
together with every producer and consumer.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

State = Literal["agree", "conflict", "less_specific", "left_missing", "right_missing", "both_missing"]
Zone = Literal["AUTO_MERGE", "REVIEW", "REJECT"]
Mode = Literal["sama", "baseline", "model_only"]
EvidenceScope = Literal["synthetic", "unseen_noise", "real_labelled", "production"]
Tier = Literal["R", "E"]
SanityType = Literal["not_allowed", "out_of_range", "multi_value", "internal_conflict"]
RULE_IDS = ("R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07", "R-08", "R-09")


class RawRecord(BaseModel):
    """One row of a SAP-shaped extract (FR-ING-02). Immutable once ingested."""
    record_id: str                       # stable id inside this dataset, e.g. "CPSE_A:10004521"
    cpse: str
    matnr: str
    maktx: str
    long_text: str = ""
    mtart: str = ""
    matkl: str = ""
    meins: str = ""
    characteristics: dict[str, str] = Field(default_factory=dict)
    mfr: str = ""
    mpn: str = ""
    last_po_price: Optional[float] = None
    annual_qty: Optional[float] = None
    plant: str = ""


class Transform(BaseModel):
    rule_id: str
    before: str
    after: str


class NormRecord(BaseModel):
    record_id: str
    norm_text: str
    tokens: list[str]
    uom_norm: str = ""
    transforms: list[Transform] = Field(default_factory=list)


class Attribute(BaseModel):
    value: Optional[str]                 # canonical value; None when unrecognised (kept in `raw_value`)
    raw_value: Optional[str] = None      # value as read, kept for display even when not recognised
    designation: Optional[str] = None    # size-dependent designation, e.g. "STD"
    resolved: Optional[float] = None     # table-resolved physical value, e.g. wall_mm
    source: Literal["char", "text", "llm"] = "text"
    rule_id: str = ""
    confidence: float = 1.0
    span: Optional[tuple[int, int]] = None   # token indices [start, end)


class SanityFlag(BaseModel):
    type: SanityType
    prop: str
    detail: str = ""


class Residuals(BaseModel):
    ignorable: list[str] = Field(default_factory=list)
    reference: list[str] = Field(default_factory=list)
    unknown: list[str] = Field(default_factory=list)
    risk: list[str] = Field(default_factory=list)


class RecordAttributes(BaseModel):
    record_id: str
    class_code: str
    class_confidence: float = 1.0
    abstained: bool = False
    tier: Tier = "R"
    tier_reasons: list[str] = Field(default_factory=list)
    attributes: dict[str, Attribute] = Field(default_factory=dict)
    mfr_norm: str = ""
    mpn_norm: str = ""
    residuals: Residuals = Field(default_factory=Residuals)
    sanity_flags: list[SanityFlag] = Field(default_factory=list)
    tables_used: list[str] = Field(default_factory=list)   # config tables that shaped this record


class CompareRow(BaseModel):
    property: str
    critical: bool
    left: Optional[str] = None
    right: Optional[str] = None
    state: State
    via: Optional[str] = None            # "size_table" when agreement came from schedules.yaml
    ancestor_chain: list[str] = Field(default_factory=list)   # for less_specific: [ancestor, ..., descendant]


class ResidualSide(BaseModel):
    left_only: list[str] = Field(default_factory=list)
    right_only: list[str] = Field(default_factory=list)


class ResidualDiff(BaseModel):
    unknown: ResidualSide = Field(default_factory=ResidualSide)
    reference: ResidualSide = Field(default_factory=ResidualSide)


class RuleOutcome(BaseModel):
    id: str
    fired: bool
    detail: str = ""


class CandidatePair(BaseModel):
    left_id: str
    right_id: str
    class_code: str
    tier: Tier
    blockers: list[str] = Field(default_factory=list)
    comparison: list[CompareRow] = Field(default_factory=list)
    residual_diff: ResidualDiff = Field(default_factory=ResidualDiff)
    rules: list[RuleOutcome] = Field(default_factory=list)
    features: dict[str, float] = Field(default_factory=dict)
    gate_score: Optional[float] = None
    rank_score: Optional[float] = None
    baseline_score: Optional[float] = None
    zone: Optional[Zone] = None
    zone_step: Optional[int] = None
    zone_reason: str = ""

    def fired(self, rule_id: str) -> bool:
        return any(r.id == rule_id and r.fired for r in self.rules)


class Certificate(BaseModel):
    """Evidence Certificate, schema 4.0 (Architecture §7.12)."""
    certificate_id: str
    schema_version: str = "4.0"
    kind: Literal["pair", "cluster", "substitution", "singleton"] = "pair"
    run_id: str
    mode: Mode = "sama"
    config_version: str
    config_status: dict[str, str]
    subject: dict[str, Any]
    comparison: list[CompareRow]
    residual_diff: ResidualDiff
    rules: list[RuleOutcome]
    scores: dict[str, Any]
    tier: dict[str, Any]
    threshold: dict[str, Any]
    measured_precision: list[dict[str, Any]]
    decision: dict[str, Any]
    audit: dict[str, Any] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)
