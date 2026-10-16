# Decisions

Decisions I have approved, and why. Newest at the bottom.

## Plan (approved before Stage 1)

- **One LLM call for Steps 2, 3 and 5.** I chose one call over one per step because all three read the same message. One call costs one round trip and one schema, and the category, entities and summary can't disagree with each other. The n8n nodes and the record's sections are still named after the spec's steps (`classification`, `enrichment`, `routing`, `summary`, `escalation`), so the mapping stays visible. I would split the summary into its own call only if its quality suffers.
- **The LLM never routes or escalates.** It classifies, extracts and summarizes. `src/routing.js` sets the queue and the escalation flag with plain rules, so every routing outcome can be tested and explained without calling a model.
- **Queues.** Bug Report and Incident/Outage go to Engineering, Feature Request to Product, Billing Issue to Billing, and Technical Question to IT/Security. Escalation overrides all of them.
- **The low-confidence fallback is the Escalation queue.** Spec Steps 4 and 6 both cover uncertain classifications. I send both to the same human-review queue instead of adding a separate fallback queue.
- **Escalation criteria.** A record is escalated if any of these holds:
  - confidence below 0.70;
  - an outage signal: an outage keyword in the message, the model reporting multiple users affected, or the category Incident/Outage;
  - a billing discrepancy over $500.
- **The billing threshold uses the discrepancy, not the invoice amount.** I compare invoiced minus contract amount against $500, because the size of the error is what makes a billing issue risky, not the size of the invoice.
  - Only overcharges count.
  - If either amount is missing, this rule doesn't fire; the other rules still apply.
  - I assume the contract rate and the invoice cover the same period.
  - For sample 3 this gives $1,240 − $980 = $260, so it is not escalated on billing.
- **Escalated records keep their standard queue.** `routing.standard_queue` is filled even when the destination is Escalation, so the reviewer can see where the record would have gone.
- **LLM failures escalate, never drop.** If the call still fails after retries, the record goes to Escalation with reason `llm_error`.
- **Urgency is evidence-based.** Urgency carries phrases quoted from the message, so it stays distinct from priority and can be checked.
- **One output file per record.** Concurrent webhook runs can't safely append to one JSON file, so n8n writes `output/records/<id>.json`.
- **Tests compare files, not webhook.site.** The end-to-end test compares `output/records/*.json` with `tests/expected.json`. webhook.site is only for the demo, so the tests don't depend on an outside service.
- **Extra samples are kept separate.** Ambiguous messages that exercise the low-confidence path live in `samples-extra.json`. `tests/expected.json` holds only my expected outcomes for the five spec samples.
- **One-command setup.** The OpenAI credential is loaded with `n8n import:credentials`. The generated credentials file is gitignored because it contains the API key.

## Stage 2: routing

- **The keyword check runs even when the LLM call failed.** It reads only the raw message, so a failed call on a message that says "outage" carries both `outage_keyword` and `llm_error`, and the reviewer can see it may be urgent.
- **The billing rule applies to any category.** If the model extracts both amounts, a discrepancy over $500 escalates whatever the category. I ignore currency and assume USD, as the prompt does.
- **The discrepancy is computed in whole cents.** In floating point, 600.20 − 100.20 is 500.00000000000006, which would fire the "over $500" rule on an exact $500 discrepancy.
- **Unusable LLM output counts as a failed call.** A category outside the map, or a confidence that isn't a number from 0 to 1, gives `llm_error` and a null `standard_queue` instead of an exception, so the record is escalated, not dropped. Strict structured outputs should make this impossible, and the guard is cheap.
- **Escalation reasons follow the schema's order.** Every rule that fires is listed. Comparisons with `tests/expected.json` treat the reasons as a set.
- **Outage keywords.** Matched case-insensitively, as whole words, on the raw message:
  - `outage`, `outages`: the spec's own example and the most direct word. Risks false positives on past or planned outages ("credit for last week's outage").
  - `down`, only after `is`, `are`, `was`, `were`, `went` or `been`, after `'s` or `’s` ("it’s down"), or in `down for` (the spec's "down for all users"): the most common way customers report an outage. Requiring these forms avoids "drop-down", "scroll down" and "download". Risks "usage is down" and "the price went down".
  - I left out "stopped loading" and "multiple users" because they come from sample 5, which the multi-user flag and the Incident/Outage category already cover. I left out "all users", "everyone" and "unavailable" because they are common in how-to and feature questions.
  - There is no negation handling, so "no outage on our end" still escalates. A false positive costs one human review, while a missed outage sits in a normal queue.

## Stage 3: n8n workflow

- **n8n is pinned to `n8nio/n8n:2.43.7`.** The `stable` tag moves, and I checked the workflow and the CLI commands against this version.
- **The OpenAI key never enters the container environment.** `docker-compose.yml` has no `env_file`. The only value it takes from `.env` is `WEBHOOK_SITE_URL`. Compose reads `.env` only to fill in that one variable. n8n 2.x blocks `$env` in nodes by default; I turned that off (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`) so the POST node can read the URL. That is safe only because the key is not in the environment.
- **The credential is imported from a generated file.** `scripts/build-credentials.js` writes `build/credentials.json` from `.env` with the key in plain text. `n8n import:credentials` encrypts it into n8n's database, and `setup.sh` deletes the file however the script ends. `build/` is gitignored. The workflow refers to the credential by a fixed id, so `workflow.json` holds no secret.
- **n8n's state lives in `./.n8n`.** The database, the encryption key and the imported credential survive `docker compose down`. The folder is gitignored.
- **One command sets everything up.** `scripts/setup.sh` builds `workflow.json` and the credential file, starts n8n, imports both, publishes the workflow and restarts n8n, because the running server only picks up CLI changes after a restart. Fixed ids make it safe to rerun.
- **One webhook.site URL stands in for all five queues.** `setup.sh` creates it once through webhook.site's API and appends it to `.env`. Each record is POSTed with `?queue=<destination_queue>`, so the capture shows where it went.
- **The record file is written before the POST.** If webhook.site fails, the record is still in `output/records/<id>.json`.
- **LLM call failures become records, not lost messages.** The call has a 30-second timeout and up to 4 attempts (the first call plus 3 retries), 2 seconds apart. After the last attempt, the error goes to the routing node instead of stopping the run. A failed call, a refusal, a cut-off reply or a reply that isn't JSON all give `llm_error` and the Escalation queue, with the reason in `meta.error`. Anything that looks like an OpenAI key is redacted from that message, because OpenAI's 401 error quotes part of the key.
- **The webhook checks its input.** `id` must be an integer, or a string of letters, digits, `_` or `-`, because it becomes a file name. `source` must be one of the schema's three channels, and `message` a non-empty string.
- **Samples run one at a time.** `scripts/run-samples.js` POSTs them in order and writes `output/records.json`, every record from that run sorted by id, as the single structured output file the spec asks for.
- **The end-to-end test runs separately from the unit tests.** `tests/e2e/pipeline.test.js` needs n8n running and a sample run, so it sits outside the unit test glob. It checks only the fields I set expectations for. I left out schema validation and a `package.json`, to keep the repo free of dependencies.
- **One prompt rule added after the sample run.** Sample 1 came back as Incident/Outage, so I added "Classify by the scope the message states, not by the type of error." to the Bug Report vs Incident/Outage tie-breaker and reran the samples once. It didn't change sample 1. Every other miss stays as it is and is described in `WRITEUP.md`, so the records show what the prompt actually does.
