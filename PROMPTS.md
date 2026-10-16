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

**Definitions, tie-breakers and three boundary examples.** The five categories overlap in predictable places: one user's error vs. an outage, and "is there a way to" vs. "please add". Each of those boundaries has an explicit rule. The rules alone didn't hold on the outage boundary: one user's 403 still came back as Incident/Outage. So that tie-breaker now says to classify by the scope the message states, not by the type of error, and gives three short examples: one user's 503 (Bug Report), many support agents locked out (Incident/Outage), and a service-wide degradation (Incident/Outage). I wrote the examples myself, and none of them is a sample or an extra test message. That avoids the problem with few-shot examples copied from test cases, where the test only checks that the model can recall them. The rules were still written knowing the five samples, so the 10 extra messages in `samples-extra.json`, written with their intended outcomes before any run, are the fairer check.

**Multi-user impact scoped to a reported problem.** `multi_user_impact` is true only when a problem the message reports affects several users now. Describing the organization ("we're a compliance-heavy org", "all our users would benefit") doesn't count, and it is false for requests and questions. Without that scope, the model set it on a feature request and on a billing question. Routing now also counts the flag only on a Bug Report or an Incident/Outage, so the prompt rule and the code rule back each other up.

**An actionable flag instead of trusting confidence.** `actionable` asks a factual question: is there a problem, a product question or a request here? It is false for an off-topic message, or one too vague to tell what is wrong or where. Code escalates a false value as `not_actionable`. I added it because the model's self-reported confidence never dropped below 0.70 in any run, even on a vague message and an off-topic one (0.85 and 0.95 in the run before this change), so the threshold never fired. Asking for a fact the model can check against the message works better than asking it to estimate its own uncertainty.

**Confidence with anchors.** Self-reported confidence is poorly calibrated and tends to bunch up around 0.9. The prompt ties each score band to a concrete situation. It also says a low score is the right outcome when unsure, so the model has no reason to round up. It is still the model's own estimate, not a measured probability, and it is the weakest signal in the record.

**Grounded extraction.** Identifiers and urgency evidence must be copied verbatim, so each one can be checked against the message. Amounts come back as plain numbers, and the billing discrepancy is computed in code, not by the model. Urgency is tied to quoted evidence so it stays distinct from priority: priority is the triage judgment, urgency is what the customer's words show.

**Untrusted input.** The message sits inside `<message>` tags, and the prompt says its contents are data, not instructions. This lowers the risk that a message steers its own triage, but does not remove it.

## What I would change with more time

- Grow the 10 extra messages into a labeled set of a few hundred (multi-topic, vague, non-English and adversarial), written by someone other than the prompt's author, and measure every prompt change against it.
- Derive confidence from the token log-probabilities of the category instead of asking the model for a number.
- Version the prompt and record the version in each record's `meta`, so any output can be traced back to the prompt that produced it.
