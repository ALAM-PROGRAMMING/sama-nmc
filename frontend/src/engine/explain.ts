/**
 * Plain-language voice of the product: attribute names, state words and the sentences that explain
 * why the engine decided what it did. Pure functions over RunOutput data; nothing here decides anything.
 *
 * Rule: say what happened in words a student could follow, keep the engineering term next to it
 * (R-01, "Class 150") so engineers see exactly what fired.
 */
import type { CompareRow, Decision, RecordView, RuleId, RuleOutcome, State } from "./types";

const ATTRIBUTE_LABELS: Record<string, string> = {
  size_nps: "Size",
  pressure_class: "Class",
  face: "Face",
  bore_wall: "Wall",
  wall: "Wall",
  material: "Material",
  body_material: "Material",
  end_connection: "End connection",
  standard: "Standard",
  design_std: "Design standard",
  thread_size: "Thread",
  length_mm: "Length",
  property_class: "Strength grade",
  ends: "Pipe ends",
};

export function attributeLabel(prop: string): string {
  return ATTRIBUTE_LABELS[prop] ?? prop.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** The four plain states the evaluator sees; the six internal states stay in the data. */
export function stateWord(state: State): "SAME" | "DIFFERENT" | "TOO VAGUE" | "MISSING" | "NOT STATED" {
  switch (state) {
    case "agree": return "SAME";
    case "conflict": return "DIFFERENT";
    case "less_specific": return "TOO VAGUE";
    case "left_missing":
    case "right_missing": return "MISSING";
    case "both_missing": return "NOT STATED";
  }
}

export function stateTone(state: State): "same" | "different" | "vague" | "missing" | "neutral" {
  switch (state) {
    case "agree": return "same";
    case "conflict": return "different";
    case "less_specific": return "vague";
    case "left_missing":
    case "right_missing": return "missing";
    default: return "neutral";
  }
}

/** Friendly rendering of a canonical value, e.g. CL150 -> "Class 150", "2" -> `2"`. */
export function prettyValue(prop: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (prop === "pressure_class") {
    const m = /^CL(\d+)$/.exec(value);
    return m ? `Class ${m[1]}` : value;
  }
  if (prop === "size_nps") return `${value}"`;
  if (prop === "length_mm") return `${value} mm`;
  return value;
}

const RULE_TITLES: Record<RuleId, string> = {
  "R-01": "Critical attribute differs",
  "R-02": "One record is too vague",
  "R-03": "Critical information is missing",
  "R-04": "Unexplained words",
  "R-05": "Risk word",
  "R-06": "Unrecognised value",
  "R-07": "Same manufacturer part number",
  "R-08": "Different part numbers",
  "R-09": "Unverified thickness table",
};

export function ruleTitle(id: RuleId): string {
  return RULE_TITLES[id];
}

function rowsWhere(d: Decision, pred: (r: CompareRow) => boolean): CompareRow[] {
  return d.comparison.filter((r) => r.critical && pred(r));
}

/** One sentence for a fired rule, using the actual values from this decision. */
export function ruleSentence(rule: RuleOutcome, d: Decision): string {
  switch (rule.id) {
    case "R-01": {
      const rows = rowsWhere(d, (r) => r.state === "conflict");
      const parts = rows.map((r) => `${attributeLabel(r.property)} is ${prettyValue(r.property, r.left)} on one record and ${prettyValue(r.property, r.right)} on the other`);
      return `These are different items: ${parts.join("; ") || "a critical attribute differs"}.`;
    }
    case "R-02": {
      const rows = rowsWhere(d, (r) => r.state === "less_specific");
      const parts = rows.map((r) => {
        const chain = r.ancestor_chain ?? [];
        if (r.via === "both_family") return `both records give only the family "${prettyValue(r.property, r.left)}", so the exact grade is unknown`;
        const vague = chain[0] ?? r.left;
        const exact = chain[chain.length - 1] ?? r.right;
        return `${attributeLabel(r.property)}: "${vague}" is only the family, "${exact}" is the exact grade`;
      });
      return `One record is too vague to be sure: ${parts.join("; ")}. A person has to decide.`;
    }
    case "R-03": {
      const rows = rowsWhere(d, (r) => r.state === "left_missing" || r.state === "right_missing");
      const parts = rows.map((r) => `${attributeLabel(r.property)} is not stated on ${r.state === "left_missing" ? "the first" : "the second"} record`);
      return `Important information is missing: ${parts.join("; ")}. The system never guesses a missing value.`;
    }
    case "R-04":
      return `One record has extra words the system cannot explain (${rule.detail.replace("unexplained tokens: ", "")}). Unexplained words could change what the item is.`;
    case "R-05":
      return `A risk word appears (${rule.detail.replace("risk word: ", "")}). Anything that signals critical service always goes to an engineer.`;
    case "R-06":
      return `A value was read that the system does not recognise (${rule.detail.replace("sanity flag: ", "")}). It never guesses, so a person checks it.`;
    case "R-07":
      return `Same manufacturer and the same part number. That is treated as strong proof of the same item.`;
    case "R-08":
      return `Same manufacturer but different part numbers. Even a small suffix can mean a different product.`;
    case "R-09":
      return `The two labels mean the same wall thickness only through the size table, and an engineer has not verified that table yet.`;
  }
}

export interface Explanation {
  headline: string;
  bullets: string[];
  rule_ids: RuleId[]; // fired rules, most important first
  next_step: string;
}

const REVIEW_PRIORITY: RuleId[] = ["R-05", "R-06", "R-02", "R-03", "R-04", "R-09", "R-08", "R-01", "R-07"];

export function explainDecision(d: Decision, records?: Record<string, RecordView>): Explanation {
  const fired = d.rules.filter((r) => r.fired);
  const ids = REVIEW_PRIORITY.filter((id) => fired.some((f) => f.id === id));
  const bullets = ids.map((id) => ruleSentence(fired.find((f) => f.id === id)!, d));
  const generic = d.class_code === "9999";

  if (d.zone === "AUTO_MERGE") {
    const headline = d.zone_step === 4
      ? "Verified: same manufacturer and part number."
      : "Verified: every critical attribute is the same, and no safety rule fired.";
    return { headline, bullets: bullets.length ? bullets : ["Every critical attribute agrees and nothing needed a person's attention."], rule_ids: ids, next_step: "No action needed. This match is part of a verified identity." };
  }

  if (d.zone === "REJECT") {
    const rows = rowsWhere(d, (r) => r.state === "conflict");
    const headline = rows.length
      ? `Different items: ${rows.map((r) => `${attributeLabel(r.property)} differs (${prettyValue(r.property, r.left)} vs ${prettyValue(r.property, r.right)})`).join(", ")}.`
      : "Different items: far too little in common to be the same item.";
    const b = bullets.length ? bullets : ["The records share too little evidence to be the same item."];
    return { headline, bullets: b, rule_ids: ids, next_step: "These stay separate. They will never be merged automatically." };
  }

  // REVIEW
  // GENERIC items have no templates, so every word is "unexplained": say the real reason instead of R-04
  const lead = generic && ids[0] === "R-04" ? undefined : ids[0];
  const headline =
    lead === "R-05" ? "Needs an engineer: a risk word is present."
    : lead === "R-06" ? "Needs an engineer: a value could not be recognised."
    : lead === "R-02" ? "Needs an engineer: one record is too vague."
    : lead === "R-03" ? "Needs an engineer: information is missing."
    : lead === "R-04" ? "Needs an engineer: unexplained words differ."
    : lead === "R-09" ? "Needs an engineer: the thickness table is not verified yet."
    : lead === "R-08" ? "Needs an engineer: part numbers differ."
    : generic ? "Needs an engineer: this item is outside the templated classes."
    : "Needs an engineer: engineered items are never merged automatically.";
  const extra: string[] = [];
  if (generic) extra.push("Outside the currently templated material classes. GENERIC records are never auto-merged.");
  else if (d.zone_step === 6) extra.push(d.tier === "R" ? "This is an engineered item (Tier R), so an engineer always checks it, even when the details look the same." : "");
  return {
    headline,
    bullets: [...bullets, ...extra.filter(Boolean)],
    rule_ids: ids,
    next_step: "Approve if these are the same item, reject if they are not. " + (d.tier === "R" ? "Engineered items need two approvals, including one from an engineer." : "One approval is enough."),
  };
}

/** Short reason for table rows (one line): the headline without its status prefix. */
export function shortReason(d: Decision): string {
  const h = explainDecision(d).headline;
  return h.replace(/^(Verified|Needs an engineer|Different items): ?/, "").replace(/^./, (c) => c.toUpperCase());
}
