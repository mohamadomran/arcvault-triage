# ArcVault intake and triage: write-up

An n8n workflow triages inbound messages: one LLM call classifies, enriches and summarizes each one, and plain code routes and escalates it. The spec is marked confidential, so it isn't in this repo; I'm happy to run the workflow live in the interview. `PROMPTS.md` explains the prompt, `DECISIONS.md` gives each rule's details and reasons, and `AI-LOG.md` records what the AI assistant and the model got wrong.

## System design

A POST to `/webhook/intake` with `id`, `source` and `message` runs nodes named after the spec's steps:

1. **Step 1 · Ingestion** checks the input.
2. **Steps 2, 3, 5 · Triage (LLM)**: one gpt-4o-mini call with a strict JSON schema.
3. **Steps 4, 6 · Routing and escalation** runs `src/routing.js`; the model never routes.
4. **Output** writes `output/records/<id>.json`, POSTs it to webhook.site with `?queue=<destination>` and returns it.

`scripts/build-workflow.js` generates `workflow.json` from the logic in `prompts/triage.md`, `schema.json`, `src/routing.js` and `src/record.js` (record assembly). n8n keeps the workflow, encrypted credential and execution history in `./.n8n`; there is no other database.

**Model:** gpt-4o-mini at temperature 0. It supports strict JSON-schema output, costs about $0.0003 per message and answers in 2–4 seconds. On an earlier prompt gpt-4o scored higher, at about 17 times the cost; the final gpt-4o-mini prompt matches that score (see `RESULTS.md`).

## Routing

Bug Reports and Incident/Outages go to Engineering, Feature Requests to Product, Billing Issues to Billing, and Technical Questions to IT/Security, because realistic ones concern setup and integration (sample 4's Okta SSO) and no other queue fits a how-to question. An escalated record keeps its `standard_queue`, so the reviewer sees where it would have gone.

## Escalation

A record goes to Escalation if any of these holds:

- **Confidence is below 0.70, or the model marks the message as not actionable** (off-topic, or too vague to tell what is wrong). Together these are the low-confidence fallback. The second rule exists because self-reported confidence never dropped below 0.70 in any run, even on vague and off-topic messages.
- **There is an outage signal:**
  - an outage keyword in the raw message ("outage", "is down", "down for");
  - multiple users affected, counted only on a Bug Report or Incident/Outage;
  - the category Incident/Outage. A false alarm costs one review; a missed outage costs far more.
- **The billing discrepancy is over $500:** invoiced minus contract amount. The size of the error is what makes a billing issue risky, not the invoice total. Sample 3 is $1,240 − $980 = $260, so it goes to Billing unescalated.
- **The LLM call failed:** after 3 retries, or on a refusal or an unparseable reply. That gives `llm_error`, and the record is escalated, not dropped.

## Results in brief

Scored on category, queue and reasons, the 15 test messages went from 8 of 15 at baseline to 14 of 15 (samples 5 of 5), and priority matches my policy on 3 of the 5 samples. The main weakness is that both safety nets, confidence and `actionable`, are the model's own judgment, and outcomes vary between identical runs: x01 and x08 each changed in one of three, so 14 of 15 is one draw. `RESULTS.md` has the table, the priority and consistency findings and the known weaknesses.

## At production scale

- **Reliability:** queue messages and answer 202 at once; n8n in queue mode on Postgres; records idempotent by id; a dead-letter queue; alerts on the `llm_error` rate.
- **Cost:** about $320 per million messages. The system prompt is identical on every call and over 1,024 tokens, so OpenAI's automatic prompt caching cuts input cost.
- **Latency:** almost all of it is the model call, which asynchronous processing hides from the sender.

## Phase 2

- A labeled set of a few hundred messages, written by someone else, scored on every prompt change.
- Confidence from token log-probabilities.
- A prompt version in each record.
- Reviewer corrections fed back into the set.
- Routing for the second topic of a multi-topic message.
