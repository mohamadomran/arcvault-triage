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
- **One prompt rule added after the sample run.** Sample 1 came back as Incident/Outage, so I added "Classify by the scope the message states, not by the type of error." to the Bug Report vs Incident/Outage tie-breaker and reran the samples once. It didn't change sample 1. Every other miss stays as it is and is described in `RESULTS.md`, so the records show what the prompt actually does.

## Extra test set and fixes

- **An extra test set with intended outcomes, committed before any run.** `samples-extra.json` has 10 messages written separately from the five samples: a vague message, a billing discrepancy over $500, a single-user server error, an explicit outage, "add a drop-down for…", a feature request for "all our users", a bug plus a billing question, a prompt injection, a Spanish bug report and an off-topic message. Each has an `intended` outcome, and the end-to-end test checks only the fields that outcome lists, so a vague or off-topic message is judged on its queue and reasons, not on a category nobody could pin down. I committed the set before running it, so the intended outcomes couldn't be fitted to the results.
- **The multi-user flag escalates only a Bug Report or an Incident/Outage.** On a feature request, a billing issue or a question, "all our users" describes who is asking, not an incident.
- **The prompt scopes `multi_user_impact` to a reported problem.** It is true only when a problem the message reports affects several users now; describing the organization doesn't count, and it is false for requests and questions.
- **Three boundary examples for Bug Report vs Incident/Outage.** I wrote them myself, unlike any sample or extra message: a single user's 503, many agents locked out, and a service-wide degradation. They teach the boundary without copying a test case.
- **A prompt change stays only if nothing that passed before now fails.** Both changes met that bar on the 15 messages.
- **I stayed on gpt-4o-mini.** gpt-4o passed 14 of 15 against gpt-4o-mini's 12, at about 17 times the cost per message. The routing rules already send the remaining misses to a human or the right team, and the gap is mostly in confidence on vague and off-topic messages, which I would rather fix with log-probability confidence than with a bigger model.
- **`setup.sh` waits until n8n serves the build it just published.** After a restart, n8n's health check answers before the webhook exists, and for a few seconds n8n serves the previously published version. `build-workflow.js` stamps the workflow with a build id, a hash of the pipeline's nodes, and a GET to `/webhook/intake-build` returns it. `setup.sh` waits until that id matches the `workflow.json` it imported. Before importing, it waits for `/healthz/readiness`, which answers only once n8n has migrated its database; on a fresh database, an import started earlier fails.
- **A failed queue POST doesn't fail the intake.** The record is already written, so the POST node's error output also goes to the response. webhook.site's free URL takes only 50 requests.

## Not-actionable messages

- **Messages with nothing to act on go to Escalation.** The model fills `enrichment.actionable`: true for a problem with the product, a question about it or a request; false for an off-topic message or one too vague to tell what is wrong or where. When it is false, code adds the reason `not_actionable`. The record keeps its standard queue. This is the low-confidence fallback driven by an extracted fact instead of self-reported confidence, which never dropped below 0.70 in any run: 0.85 on the vague message and 0.95 on the off-topic one in the run before this change, and 0.80 at its lowest in the baseline.
- **x01 and x10 now intend `not_actionable`.** Before the rule existed, their only route to Escalation was `low_confidence`. I changed their intended reason before the rerun, in a separate commit, so the change couldn't be fitted to the results.

## Priority policy

- **My priority policy.** Priority is the triage judgment; it doesn't affect routing.
  - **High**: the customer can't use the product or a core workflow now, multiple users are affected, there is a security or data-loss concern, or the invoice doesn't match the agreed price. A wrong invoice takes the customer's money and their trust at the same time, so I treat it like a blocking problem, not a routine billing question.
  - **Medium**: something is wrong but there is a workaround; how-to, setup or evaluation questions; feature requests that state a concrete business impact (time, cost, compliance). An evaluation or setup question can decide a purchase or a rollout, and a feature request with a stated cost tells me what the gap is worth.
  - **Low**: feature requests with no stated impact, general questions and off-topic messages.
- **Urgency doesn't set priority.** Urgency stays a reading of the message's wording; the prompt now says so, and I dropped "the impact is financial" from urgency's Medium level, because under my policy a billing mismatch is a priority call, not an urgency one.
- **I kept the policy because routing didn't move.** On all 15 messages, no category, queue or escalation reason changed. That was the condition, since priority doesn't feed routing.

## Demo extras

- I added n8n's form trigger (the spec lists form submission as a trigger, and Web Form is a source) and a one-page demo UI served by n8n, after the pipeline was done, as demo extras. They contain no logic: routing stays in `src/routing.js`.
