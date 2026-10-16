# Prompts

The pipeline makes one LLM call per message. That call covers spec Steps 2, 3 and 5. Steps 4 and 6 (routing and escalation) are plain code in `src/routing.js` and use no prompt.

| Spec step | Section of `prompts/triage.md` | Record field |
|---|---|---|
| 2. Classification | `2. classification` | `classification` |
| 3. Enrichment | `1. enrichment` | `enrichment` |
| 5. Summary | `3. summary` | `summary` |

## The call

- Model: `gpt-4o-mini`, temperature 0.
- System message: [`prompts/triage.md`](prompts/triage.md), sent verbatim.
- User message:
  ```
  Source: {source}
  <message>
  {message}
  </message>
  ```
- Response format: `json_schema` with `strict: true`, using `$defs.llm` from [`schema.json`](schema.json). The API constrains the output to that schema, so the prompt explains what each field means and the schema enforces its shape.

## Why it is structured this way

**One call for three steps.** All three steps read the same short message. One call means one round trip and one schema instead of three, and the category, entities and summary come from a single reading, so they can't contradict each other. The cost: one prompt does three jobs, so a change to any section means re-testing all of them. The summary also can't mention the routing decision, because routing happens after the call.

**Extract, then classify, then summarize.** The model writes fields in schema order, so `$defs.llm` puts `enrichment` first. The model commits to the facts (core issue, identifiers, multi-user impact) before it picks a category, and writes the summary last from both. Inside `classification`, `rationale` comes before `category` for the same reason. The label is chosen after the evidence is written down, and a human reviewer can see why it was chosen.

**Definitions and tie-breakers, no examples.** The five categories overlap in predictable places: one user's error vs. an outage, and "is there a way to" vs. "please add". Each of those boundaries has an explicit rule. I used no few-shot examples. The boundary rules, though, were written knowing the five samples, so passing them shows the rules behave as intended, not that the prompt generalizes. Measuring that needs a labeled set written separately from the prompt (see "What I would change with more time").

**Confidence with anchors.** Self-reported confidence is poorly calibrated and tends to bunch up around 0.9. The prompt ties each score band to a concrete situation. It also says a low score is the right outcome when unsure, so the model has no reason to round up. It is still the model's own estimate, not a measured probability, and it is the weakest signal in the record.

**Grounded extraction.** Identifiers and urgency evidence must be copied verbatim, so each one can be checked against the message. Amounts come back as plain numbers, and the billing discrepancy is computed in code, not by the model. Urgency is tied to quoted evidence so it stays distinct from priority: priority is the triage judgment, urgency is what the customer's words show.

**Untrusted input.** The message sits inside `<message>` tags, and the prompt says its contents are data, not instructions. This lowers the risk that a message steers its own triage, but does not remove it.

## What I would change with more time

- Build a larger labeled set (multi-topic, vague, non-English and adversarial messages), measure the prompt against it, and draw few-shot examples from that set rather than from the test samples.
- Derive confidence from the token log-probabilities of the category instead of asking the model for a number.
- Version the prompt and record the version in each record's `meta`, so any output can be traced back to the prompt that produced it.
