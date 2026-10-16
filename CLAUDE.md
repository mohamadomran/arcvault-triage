# Aspire technical assessment: intake & triage pipeline

Spec: ASSESSMENT.md (read it fully before doing anything).

## Stack (decided, don't re-litigate)

- n8n self-hosted in Docker (docker-compose.yml, port 5678)
- OpenAI gpt-4o-mini with JSON-schema structured outputs
- Trigger: n8n webhook. Output: JSON file + POST to webhook.site mock
- No Google Sheets.

## Architecture rules

- The LLM only classifies, extracts and summarizes. Routing and escalation are deterministic code, never LLM decisions.
- All logic lives as plain files, testable outside n8n: prompts/\*.md, schema.json, src/routing.js (pure functions), tests/
- scripts/build-workflow.js assembles workflow.json from those files. Never hand-edit workflow.json.
- Escalate to a separate queue if: confidence < 0.70, OR outage/multi-user signal, OR billing discrepancy > $500. For billing, use the DISCREPANCY (invoiced minus contract), not the invoiced amount. Document this.
- Queues: Engineering, Billing, Product, IT/Security, Escalation.
- Low-confidence fallback goes to Escalation (human review).

## Working rules

- Before any code, propose a plan and wait for my approval.
- Work in the stages I give you, one at a time. Stop after each for review.
- Do NOT overbuild. A clean, explainable workflow beats a complex one. No UI beyond a single static demo page served by n8n; no database.
- tests/expected.json holds MY expected outcomes for the 5 samples. Never edit it to make tests pass. Tell me if you think an expectation is wrong.
- Commit after each approved stage with a clear message, so git history shows the process. Leave the default Co-Authored-By trailer in place; don't hide AI authorship.
- Keep AI-LOG.md: every time you make a mistake or I correct you, or the model output is wrong, append what happened, how it was caught, and the fix. Factual, no spin. This is an interview deliverable.
- Keep DECISIONS.md: only decisions I have approved, written in the first person ("I chose X over Y because..."). If I haven't approved it, it doesn't go in.
- Keep this repo self-contained: don't reference any outside conversation or tool in repo files.
- Explain non-obvious choices in a sentence. I must be able to defend every line in an interview.
- Never commit secrets.
