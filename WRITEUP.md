# ArcVault intake and triage: write-up

An n8n workflow takes an inbound message. One LLM call classifies it, extracts its details and summarizes it, and plain code routes and escalates it. The spec isn't in this repo because it is marked confidential. I'm happy to run the workflow live in the interview.

## System design

A POST to `/webhook/intake` with `id`, `source` and `message` runs these nodes, named after the spec's steps:

1. **Step 1 · Ingestion** checks the input.
2. **Steps 2, 3, 5 · Triage (LLM)** makes one gpt-4o-mini call with a strict JSON schema: enrichment first, then classification, then summary, so the model writes the facts down before it picks a label.
3. **Steps 4, 6 · Routing and escalation** runs `src/routing.js`. The model never routes.
4. **Output** writes `output/records/<id>.json`, POSTs the record to webhook.site with `?queue=<destination>`, and returns it.

n8n keeps the workflow, the encrypted credential and its execution history in `./.n8n`. There is no other database. The logic lives in `prompts/triage.md`, `schema.json` and `src/routing.js`, and `scripts/build-workflow.js` generates `workflow.json` from them.

**Model:** gpt-4o-mini at temperature 0. It supports strict JSON-schema output, costs about $0.0003 per message and answers in 2–4 seconds. On an earlier prompt gpt-4o scored higher, at about 17 times the cost; the final gpt-4o-mini prompt matches that score (see Results).

## Routing

| Category | Queue |
|---|---|
| Bug Report, Incident/Outage | Engineering (Incident/Outage always escalates) |
| Feature Request | Product |
| Billing Issue | Billing |
| Technical Question | IT/Security |

Technical questions go to IT/Security because the realistic ones are about setup and integration, like sample 4's SSO with Okta, and no other queue fits a how-to question. An escalated record keeps its `standard_queue`, so the reviewer sees where it would have gone.

## Escalation

A record goes to Escalation if any of these holds:

- **Confidence is below 0.70, or the model marks the message as not actionable** (off-topic, or too vague to tell what is wrong). Together these are the low-confidence fallback. The second rule exists because self-reported confidence never dropped below 0.70 in any run, even on vague and off-topic messages.
- **There is an outage signal:**
  - an outage keyword in the raw message ("outage", "is down", "down for");
  - multiple users affected, counted only on a Bug Report or Incident/Outage;
  - the category Incident/Outage. A false alarm costs one review; a missed outage costs far more.
- **The billing discrepancy is over $500:** invoiced minus contract amount. The size of the error is what makes a billing issue risky, not the invoice total. Sample 3 is $1,240 − $980 = $260, so it goes to Billing unescalated.
- **The LLM call failed:** after 3 retries, or on a refusal or an unparseable reply. That gives `llm_error`, and the record is escalated, not dropped.

## Results

I ran the five samples and 10 extra messages through the live workflow. I wrote the extras (`samples-extra.json`) with intended outcomes and committed them before any run. After x01 and x10 failed at baseline, I added the `actionable` rule and changed their intended reason from `low_confidence` to `not_actionable` before rerunning. I wrote my expected outcomes for the five samples (`tests/expected.json`) after the first run, so I had seen the outputs. The table scores category, queue and reasons.

| # | Intended | Baseline | Final |
|---|---|---|---|
| 1 | Bug Report → Engineering | Incident/Outage → Escalation ✗ | ✓ |
| 2 | Feature Request → Product | Escalation (multi-user) ✗ | ✓ |
| 3 | Billing Issue → Billing | ✓ | ✓ |
| 4 | Technical Question → IT/Security | ✓ | ✓ |
| 5 | Incident/Outage → Escalation | ✓ | ✓ |
| x01 vague | Escalation (not actionable) | Bug Report → Engineering ✗ | ✓ |
| x02 $650 overcharge | Billing Issue → Escalation | extra multi-user reason ✗ | ✓ |
| x03 one user's 504 | Bug Report → Engineering | ✓ | ✓ |
| x04 whole app down | Incident/Outage → Escalation | ✓ | ✓ |
| x05 "drop-down for" | Feature Request → Product | ✓ | ✓ |
| x06 "all our users" | Feature Request → Product | Escalation (multi-user) ✗ | ✓ |
| x07 bug plus billing question | Bug Report → Engineering | ✓ | ✓ |
| x08 injection; one user can't sign in | Bug Report, High → Engineering | Incident/Outage ✗ | Incident/Outage ✗ (priority stayed High) |
| x09 Spanish bug report | Bug Report → Engineering | ✓ | ✓ |
| x10 off-topic | Escalation (not actionable) | Technical Question → IT/Security ✗ | ✓ |
| **Total** | | **8/15** (samples 3/5) | **14/15** (samples 5/5) |

I made four changes, and kept each only if nothing that had passed before then failed:

1. Routing counts multi-user only on problem reports: 8 to 11.
2. The prompt limits multi-user impact to a reported problem affecting users now: 11.
3. Three self-written examples on the outage boundary: 12. This fixed sample 1, and my made-up 502 message is now a Bug Report too.
4. An `actionable` flag escalates vague and off-topic messages: 14. For x01 and x10 I changed the intended reason from `low_confidence` to `not_actionable` before this run.

On the prompt as of change 3, gpt-4o passed 14 of 15 at $0.0054 per message, against gpt-4o-mini's 12 of 15 at $0.0003. With change 4, gpt-4o-mini reaches 14 of 15 at a seventeenth of the cost. I didn't rerun gpt-4o on the final prompt.

**Priority.** Against my expectations, the end-to-end test first passed 2 of the 5 samples, with samples 2, 3 and 4 off on priority only. I then replaced the prompt's priority rules with my policy (see `DECISIONS.md`): 3 of 5. Sample 3 (an invoice above the contract rate) is still Medium where I expect High, and sample 4 (an SSO evaluation question) is still Low where I expect Medium. The model's priority tracks its urgency reading. No category, queue or reason changed on any of the 15 messages.

## Known weaknesses

- **Both safety nets are the model's own judgment.** Confidence is self-reported, and so is `actionable`.
- **The outage boundary still leaks** (x08), which costs an unneeded escalation.
- **Priority misses my policy on samples 3 and 4.** The model follows urgency instead.
- **The tests are small and mine.** The rules were written knowing the samples.
- **There is one category per message.** x07's billing question isn't routed.
- **Record assembly isn't unit-tested.** It lives in a Code node template in `build-workflow.js`.
- **Smaller gaps:**
  - bad input gets a generic HTTP 500;
  - there's no negation handling;
  - currency is assumed to be USD;
  - a resent id overwrites its file;
  - webhook.site's free URL takes 50 requests, after which the POST fails but the record is still written and returned;
  - opening the n8n editor first asks you to create an owner account.

## At production scale

- **Reliability:**
  - queue messages and answer 202 at once;
  - run n8n in queue mode on Postgres;
  - make records idempotent by id;
  - add a dead-letter queue;
  - alert on the `llm_error` rate.
- **Cost:** about $320 per million messages. The system prompt is identical on every call and over 1,024 tokens, so OpenAI's automatic prompt caching cuts the input cost.
- **Latency:** the model call is nearly all of it, and processing asynchronously hides it from the sender.

## Phase 2

- A labeled set of a few hundred messages, written by someone else, scored on every prompt change.
- Confidence from token log-probabilities.
- A prompt version in each record.
- Reviewer corrections fed back into the set.
- Routing for the second topic of a multi-topic message.

## Commands

You need Docker, Node 22+, and a `.env` with `OPENAI_API_KEY=...`.

```
./scripts/setup.sh                              # build, start n8n, import, publish
node scripts/run-samples.js                     # five samples -> output/records.json
node scripts/run-samples.js samples-extra.json  # extras -> output/records-extra.json
node --test "tests/*.test.js"                   # unit tests; no n8n needed
node --test "tests/e2e/*.test.js"               # end-to-end; needs both runs
```

`PROMPTS.md` explains the prompt, `DECISIONS.md` lists my choices, and `AI-LOG.md` records what the AI assistant and the model got wrong.
