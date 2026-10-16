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
