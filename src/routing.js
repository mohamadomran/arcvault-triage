// Routing (spec Step 4) and escalation (spec Step 6): pure functions, no I/O.
// scripts/build-workflow.js inlines this file into an n8n Code node, so it must
// not use require/import or touch files or the network.

const QUEUE_BY_CATEGORY = {
  "Bug Report": "Engineering",
  "Incident/Outage": "Engineering",
  "Feature Request": "Product",
  "Billing Issue": "Billing",
  "Technical Question": "IT/Security",
};

const ESCALATION_QUEUE = "Escalation";
const CONFIDENCE_THRESHOLD = 0.7; // escalate below this
const BILLING_DISCREPANCY_LIMIT = 500; // escalate when invoiced minus contract exceeds this

// Outage keywords, matched case-insensitively on the raw message. No "g" flag:
// a global regex keeps lastIndex between test() calls and would skip matches.
const OUTAGE_PATTERN = new RegExp(
  [
    /\boutages?\b/, // "outage(s)": the spec's own example
    /\b(?:is|are|was|were|went|been)\s+down\b/, // "the portal is down", "it went down"
    /\w['’]s\s+down\b/, // "it's down" / "it’s down": straight or curly apostrophe
    /\bdown\s+for\b/, // "down for all users": the spec's other example
  ]
    .map((part) => part.source)
    .join("|"),
  "i",
);

// Strict structured outputs should make bad output impossible, but a category
// outside the map or a confidence outside 0–1 is treated as an LLM failure
// rather than throwing, so the record is escalated instead of dropped.
function isUsable(llm) {
  const classification = llm?.classification;
  return (
    Object.hasOwn(QUEUE_BY_CATEGORY, classification?.category ?? "") &&
    typeof classification.confidence === "number" &&
    classification.confidence >= 0 &&
    classification.confidence <= 1
  );
}

// Invoiced minus contract, or null if either amount is missing. Works in whole
// cents: in floating point 600.20 − 100.20 is 500.00000000000006, which would
// fire the "> 500" rule on an exact $500 discrepancy.
function billingDiscrepancy(billing) {
  const invoiced = billing?.invoiced_amount;
  const contract = billing?.contract_amount;
  if (typeof invoiced !== "number" || typeof contract !== "number") return null;
  return (Math.round(invoiced * 100) - Math.round(contract * 100)) / 100;
}

// Reasons in the order schema.json lists them. Unusable LLM output contributes
// only llm_error; the keyword check still runs on the raw message.
function escalationReasons(llm, message) {
  const usable = isUsable(llm);
  const discrepancy = usable
    ? billingDiscrepancy(llm.enrichment?.billing)
    : null;
  const fired = {
    low_confidence:
      usable && llm.classification.confidence < CONFIDENCE_THRESHOLD,
    outage_keyword: OUTAGE_PATTERN.test(message),
    multi_user_impact: usable && llm.enrichment?.multi_user_impact === true,
    incident_category:
      usable && llm.classification.category === "Incident/Outage",
    billing_discrepancy_over_500:
      discrepancy !== null && discrepancy > BILLING_DISCREPANCY_LIMIT,
    llm_error: !usable,
  };
  return Object.keys(fired).filter((reason) => fired[reason]);
}

// llm is the $defs.llm object, or null when the call failed.
function route(llm, message) {
  const usable = isUsable(llm);
  const standardQueue = usable
    ? QUEUE_BY_CATEGORY[llm.classification.category]
    : null;
  const reasons = escalationReasons(llm, message);
  const flagged = reasons.length > 0;
  return {
    routing: {
      standard_queue: standardQueue,
      destination_queue: flagged ? ESCALATION_QUEUE : standardQueue,
    },
    escalation: {
      flagged,
      reasons,
      billing_discrepancy: usable
        ? billingDiscrepancy(llm.enrichment?.billing)
        : null,
    },
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    QUEUE_BY_CATEGORY,
    CONFIDENCE_THRESHOLD,
    BILLING_DISCREPANCY_LIMIT,
    OUTAGE_PATTERN,
    billingDiscrepancy,
    escalationReasons,
    route,
  };
}
