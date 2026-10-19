# ArcVault intake and triage: write-up

An n8n workflow triages inbound messages: one LLM call classifies, enriches and summarizes each one, and plain code routes and escalates it. The spec is marked confidential, so it isn't in this repo; I'm happy to run the workflow live in the interview. `PROMPTS.md` explains the prompt, `DECISIONS.md` gives each rule's details and reasons, and `AI-LOG.md` records what the AI assistant and the model got wrong.

## System design

A POST to `/webhook/intake` with `id`, `source` and `message` runs nodes named after the spec's steps:

1. **Step 1 · Ingestion** checks the input.
2. **Steps 2, 3, 5 · Triage (LLM)**: one gpt-4o-mini call with a strict JSON schema.
3. **Steps 4, 6 · Routing and escalation** runs `src/routing.js`; the model never routes.
4. **Output** writes `output/records/<id>.json`, POSTs it to webhook.site with `?queue=<destination>` and returns it.

`scripts/build-workflow.js` generates `workflow.json` from the logic in `prompts/triage.md`, `schema.json`, `src/routing.js` and `src/record.js` (record assembly). n8n keeps the workflow, encrypted credential and execution history in `./.n8n`; there is no other database. gpt-4o-mini at temperature 0 costs about $0.0003 per message and answers in 2–4 seconds.

## Routing and escalation

Bug Reports and Incident/Outages go to Engineering, Feature Requests to Product, Billing Issues to Billing, and Technical Questions to IT/Security, because realistic ones concern setup and integration (sample 4's Okta SSO) and no other queue fits a how-to question.

A record goes to Escalation instead, keeping its `standard_queue`, on low confidence (below 0.70, or marked not actionable), an outage signal (an outage keyword, multi-user impact on a problem report, or the category Incident/Outage), a billing discrepancy over $500 (invoiced minus contract, so sample 3's $260 isn't escalated), or a failed LLM call (`llm_error`).

## Results

I ran the five samples and 10 extras live. I committed the extras (`samples-extra.json`) with intended outcomes before any run, but wrote my expectations for the samples (`tests/expected.json`) after seeing the first run's outputs. Scoring category, queue and reasons, the baseline passed 8 of 15 (samples 3 of 5):

| # | Intended | Baseline |
|---|---|---|
| 1 | Bug Report → Engineering | Incident/Outage → Escalation ✗ |
| 2 | Feature Request → Product | Escalation (multi-user) ✗ |
| 3 | Billing Issue → Billing | ✓ |
| 4 | Technical Question → IT/Security | ✓ |
| 5 | Incident/Outage → Escalation | ✓ |
| x01 vague | Escalation (not actionable) | Bug Report → Engineering ✗ |
| x02 $650 overcharge | Billing Issue → Escalation | extra multi-user reason ✗ |
| x03 one user's 504 | Bug Report → Engineering | ✓ |
| x04 whole app down | Incident/Outage → Escalation | ✓ |
| x05 "drop-down for" | Feature Request → Product | ✓ |
| x06 "all our users" | Feature Request → Product | Escalation (multi-user) ✗ |
| x07 bug plus billing question | Bug Report → Engineering | ✓ |
| x08 injection; one user can't sign in | Bug Report, High → Engineering | Incident/Outage ✗ |
| x09 Spanish bug report | Bug Report → Engineering | ✓ |
| x10 off-topic | Escalation (not actionable) | Technical Question → IT/Security ✗ |

Four changes (`DECISIONS.md`) raised the score: multi-user routing only on problem reports (11), the prompt's multi-user scope (11), three self-written outage-boundary examples (12, fixing sample 1 and my made-up 502 message), and the `actionable` flag (14 of 15, samples 5 of 5). Only x08 still misses (Incident/Outage; priority stayed High). After change 3, gpt-4o passed 14 at $0.0054 per message and gpt-4o-mini 12 at $0.0003; I didn't rerun gpt-4o after change 4.

**Priority.** The end-to-end test first passed 2 of 5 samples, with 2, 3 and 4 off on priority only, then 3 of 5 under my policy (`DECISIONS.md`). Sample 3 (invoice above the contract rate) stays Medium, not High, and sample 4 (SSO evaluation question) Low, not Medium. A demo invoice with a $1,100 gap came back High: a hint, not proof, that gap size matters.

**Consistency.** Three more runs of all 15 on the final workflow (temperature 0, same model snapshot), the third committed: 12 matched on category, priority, queue and reasons every time. x01 was escalated only in run 3; runs 1 and 2 and a fresh-clone run sent it to Engineering as actionable. x08 was a Bug Report for Engineering in runs 1 and 2, escalated in run 3. x06's priority was Low once, Medium twice. Each run scored 14 of 15, but the miss moved between x01 and x08: the final score is one draw. Confidence varied only on x01 (0.70–0.85) and x06 (0.85–0.95); summary wording on 10 messages.

## Known weaknesses

Beyond x08 and the unexplained priority misses above:

- **Both safety nets are the model's own judgment:** self-reported confidence and `actionable` (see x01).
- **The tests are small and mine,** and the rules were written knowing the samples.
- **One category per message:** x07's billing question isn't routed.
- **The webhooks have no authentication and accept any origin:** fine locally, where n8n listens on 127.0.0.1 only; production needs authentication and an origin allow-list.
- **Smaller gaps:** bad input gets a generic HTTP 500; no negation handling; USD is assumed; a resent id overwrites its file; webhook.site's free URL takes 50 requests, then the POST fails but the record is kept and returned; the n8n editor first asks for an owner account.

## At production scale

- **Reliability:** queue messages and answer 202 at once; n8n in queue mode on Postgres; records idempotent by id; a dead-letter queue; alerts on the `llm_error` rate.
- **Cost:** about $320 per million messages. The system prompt is identical on every call and over 1,024 tokens, so OpenAI's automatic prompt caching cuts input cost.
- **Latency:** nearly all model call, hidden from the sender by asynchronous processing.

## Phase 2

The list in `PROMPTS.md`, plus reviewer corrections fed back into the labeled set and routing for a multi-topic message's second topic.

## Demo

`http://localhost:5678/webhook/ui` is a one-page demo showing the returned record for any of the 15 messages or a typed one; `http://localhost:5678/form/triage-form` is n8n's form trigger, whose confirmation page shows category, priority, confidence, queue, reasons and summary. Both feed the Ingestion node and hold no logic.

## Commands

You need Docker, Node 22+ and a `.env` (`cp .env.example .env`, then add `OPENAI_API_KEY`).

```
./scripts/setup.sh                              # build, start n8n, import, publish
node scripts/run-samples.js                     # samples -> output/records.json
node scripts/run-samples.js samples-extra.json  # extras -> output/records-extra.json
node --test "tests/*.test.js"                   # unit tests; no n8n needed
node --test "tests/e2e/*.test.js"               # end-to-end; needs both runs
```
