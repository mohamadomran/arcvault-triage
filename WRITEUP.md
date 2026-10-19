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

## Results in brief

Scored on category, queue and reasons, the 15 test messages went from 8 of 15 at baseline to 14 of 15 (samples 5 of 5), and priority matches my policy on 3 of the 5 samples. The main weakness is that both safety nets, confidence and `actionable`, are the model's own judgment, and outcomes vary between identical runs: x01 and x08 each changed in one of three, so 14 of 15 is one draw. `RESULTS.md` has the table, the priority and consistency findings and the known weaknesses.

## At production scale

- **Reliability:** queue messages and answer 202 at once; n8n in queue mode on Postgres; records idempotent by id; a dead-letter queue; alerts on the `llm_error` rate.
- **Cost:** about $320 per million messages. The system prompt is identical on every call and over 1,024 tokens, so OpenAI's automatic prompt caching cuts input cost.
- **Latency:** nearly all model call, hidden from the sender by asynchronous processing.

## Phase 2

The list in `PROMPTS.md`, plus reviewer corrections fed back into the labeled set and routing for a multi-topic message's second topic.
