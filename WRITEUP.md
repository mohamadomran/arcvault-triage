# ArcVault intake and triage: write-up

An n8n workflow takes an inbound message. One LLM call classifies it, extracts its details and summarizes it, and plain code routes and escalates it. The assessment spec isn't in this repo because it is marked confidential. I'm happy to run the workflow live in the interview.

## System design

A POST to the n8n webhook `/webhook/intake` with `id`, `source` and `message` runs these nodes, named after the spec's steps:

1. **Step 1 · Webhook / Ingestion**: checks the input and builds the OpenAI request.
2. **Steps 2, 3, 5 · Triage (LLM)**: one gpt-4o-mini call with a strict JSON schema. It returns the enrichment first (core issue, identifiers, billing amounts, urgency evidence, multi-user impact), then the classification (rationale, category, priority, confidence), then the summary. That order means the model writes down the facts before it picks a label.
3. **Steps 4, 6 · Routing and escalation**: `src/routing.js` picks the queue and decides escalation. The model never routes.
4. **Output**: writes `output/records/<id>.json`, POSTs the record to webhook.site with `?queue=<destination>`, and returns it to the caller.

There is no database of my own. n8n keeps the workflow, the encrypted OpenAI credential and its execution history in `./.n8n`, and each record is a JSON file. The logic lives in plain files: `prompts/triage.md`, `schema.json` and `src/routing.js`. `scripts/build-workflow.js` copies them into `workflow.json`, which is generated, never edited by hand.

**Model.** I used gpt-4o-mini at temperature 0:

- It supports strict JSON-schema output, so every reply has the record's exact shape.
- It costs about $0.0003 per message (about 1,430 input and 150 output tokens).
- It answers in under 4 seconds.

Five-way classification of short messages doesn't need a bigger model, and deterministic routing limits the damage of a wrong label.

## Routing

| Category | Queue |
|---|---|
| Bug Report, Incident/Outage | Engineering (Incident/Outage always escalates) |
| Feature Request | Product |
| Billing Issue | Billing |
| Technical Question | IT/Security |

Technical questions go to IT/Security because the realistic ones are about setup and integration, like sample 4's SSO with Okta. Identity and integration configuration sits with that team, and no other queue fits a how-to question. A real company would likely have a solutions queue for these. Routing is a lookup table in code, so it is unit-tested without a model. An escalated record keeps its `standard_queue`, so the reviewer sees where it would have gone.

## Escalation

A record goes to the Escalation queue if any of these holds:

- **Confidence below 0.70.** The low-confidence fallback and human review are the same queue.
- **An outage signal:**
  - an outage keyword in the raw message ("outage", "is down", "it's down", "down for");
  - the model reporting multiple users affected, on a Bug Report or Incident/Outage only (on a feature request or a question it describes who is asking, not an incident);
  - the category Incident/Outage, which always escalates, because an outage is urgent and a false alarm costs one review.
  
  The keyword check doesn't depend on the model, so it still works when the call fails.
- **A billing discrepancy over $500:** invoiced minus contract amount, computed in whole cents in code. The size of the error is what makes a billing issue risky, not the invoice total. Sample 3 ($1,240 against $980) is a $260 discrepancy, so it goes to Billing unescalated.
- **An LLM failure:** a timeout, an HTTP error after 3 retries, a refusal or an unparseable reply. It gives `llm_error`, and the record still goes to Escalation, with the reason in `meta.error`.

Every rule that fires is listed in `escalation.reasons`.

## Results on the five samples

The records are in `output/records.json`, one file each in `output/records/`. The run took about 2.8 seconds per message. I didn't write expected outcomes independently of the prompt, so I didn't run the end-to-end comparison (`tests/e2e/pipeline.test.js`). The verdicts below are against the prompt's own rules.

| # | Category (confidence) | Priority | Queue | Reasons | Verdict |
|---|---|---|---|---|---|
| 1 | Incident/Outage (0.90) | High | Escalation | incident_category | **Miss**: one user's 403 should be a Bug Report and go to Engineering |
| 2 | Feature Request (0.90) | Low | Escalation | multi_user_impact | **Miss**: "a compliance-heavy org" was read as multiple users; should go to Product |
| 3 | Billing Issue (0.90) | Medium | Billing | none | As intended |
| 4 | Technical Question (0.95) | Low | IT/Security | none | As intended |
| 5 | Incident/Outage (0.95) | High | Escalation | multi_user_impact, incident_category | As intended |

After the first run I added one rule to the prompt, "Classify by the scope the message states, not by the type of error.", and reran once. Sample 1 didn't change, so both misses stand. Each sends a record to review unnecessarily; neither hides an urgent one. `output/records/` also holds two made-up test records:

- `smoke-saml.json`: a 502 message.
- `smoke-llm-error.json`: a forced 401 with a fake key, which shows the failure path (Escalation, `outage_keyword` plus `llm_error`, key redacted).

## Known weaknesses

- **Single-user errors get labeled outages.** Sample 1's 403 and my made-up "SAML login page shows error 502… for my account" both came back as Incident/Outage at 0.9. In both, the model itself said `multi_user_impact: false`. The summaries also guessed at impact the messages didn't state.
- **Confidence is self-reported.** The model gave 0.9 on wrong labels, so the 0.70 threshold catches only cases where the model knows it's unsure.
- **The multi-user flag escalates any category.** Sample 2 shows the model can set it on a feature request. I would limit that rule to problem reports.
- **The prompt rules were written knowing the samples.** Passing them doesn't show the prompt generalizes.
- **Record assembly isn't unit-tested.** It lives in a Code node template in `build-workflow.js`, not in `src/`.
- **Smaller gaps:**
  - Bad input gets n8n's generic HTTP 500, not a 400 with the reason.
  - Outage keywords have no negation handling.
  - USD is assumed.
  - Resending an id overwrites its file.

## At production scale

- **Reliability:**
  - Put messages on a queue and answer 202 at once; today the caller waits for the model, about 2 minutes in the worst case with retries.
  - Run n8n in queue mode with Postgres.
  - Make records idempotent by id, add a dead-letter queue, and alert on the `llm_error` rate.
  - Send to real ticketing queues with their own retries.
- **Cost:** about $300 per million messages. The system prompt is the same on every call and over 1,024 tokens, so OpenAI's automatic prompt caching cuts input cost.
- **Latency:** almost all of it is the model call. Async processing hides it from the sender; a shorter prompt cuts it.

## Phase 2

- A labeled set of a few hundred messages written separately from the prompt, scored per category on every prompt change.
- Few-shot examples drawn from that set, aimed at the outage boundary.
- Confidence from the category's token log-probabilities, with the threshold tuned on the labeled set.
- A prompt version in each record's `meta`.
- Reviewer corrections fed back into the labeled set.
- 400 responses for bad input.

## Commands

You need Docker, Node 22+, and a `.env` with `OPENAI_API_KEY=...`.

```
./scripts/setup.sh                  # build workflow.json and the credential, start n8n, import, publish
node scripts/build-workflow.js      # rebuild workflow.json only (setup.sh runs it)
node scripts/run-samples.js         # POST the five samples, write output/records.json
node --test "tests/*.test.js"       # unit tests for routing and escalation; no n8n needed
node --test "tests/e2e/*.test.js"   # end-to-end check against tests/expected.json; needs a sample run
```

`PROMPTS.md` explains the prompt, `DECISIONS.md` lists my choices and why, and `AI-LOG.md` records what the AI assistant and the model got wrong and how each was caught.
