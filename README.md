# ArcVault intake and triage

An n8n workflow that triages inbound ArcVault support messages: one LLM call classifies, enriches and summarizes each one, and plain code routes and escalates it.

## Commands

You need Docker, Node 22+ and a `.env` (`cp .env.example .env`, then add `OPENAI_API_KEY`).

```
./scripts/setup.sh                              # build, start n8n, import, publish
node scripts/run-samples.js                     # samples -> output/records.json
node scripts/run-samples.js samples-extra.json  # extras -> output/records-extra.json
node --test "tests/*.test.js"                   # unit tests; no n8n needed
node --test "tests/e2e/*.test.js"               # end-to-end; needs both runs
```

## Demo

`http://localhost:5678/webhook/ui` is a one-page demo showing the returned record for any of the 15 messages or a typed one; `http://localhost:5678/form/triage-form` is n8n's form trigger, whose confirmation page shows category, priority, confidence, queue, reasons and summary. Both feed the Ingestion node and hold no logic.

## Docs

- `WRITEUP.md`: the system design, routing and escalation, production scale and Phase 2.
- `RESULTS.md`: results on the 15 test messages, and known weaknesses.
- `PROMPTS.md`: the prompt and why it is structured this way.
- `DECISIONS.md`: each decision and the reason for it.
- `AI-LOG.md`: what the AI assistant and the model got wrong, and the fixes.
- `CLAUDE.md`: the working rules given to the AI assistant.
