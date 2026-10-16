# AI log

Each time the AI assistant made a mistake or was corrected, or the model's output was wrong: what happened, how it was caught, and the fix.

## Plan review

- **Overbuilt docs and tests.** The proposed plan had a `docs/` folder with separate architecture and prompt documents, and an end-to-end test that checked the payloads webhook.site captured. Caught in plan review. Fix: one `WRITEUP.md` at the root plus `PROMPTS.md`. The test compares the files n8n writes with `tests/expected.json`, and webhook.site is used only for the demo.
- **Missed a secret-handling step.** The plan proposed scripting the n8n credential import, but did not say that the generated credentials file holds the API key and must stay out of git. Caught in plan review. Fix: that file is gitignored in the setup stage.

## Stage 1

- **Overstated test independence.** `PROMPTS.md` claimed that leaving the five samples out of the prompt as few-shot examples kept the test meaningful. The tie-breaker and priority rules were written knowing the five samples: "is there a way to", "we'd like you to add", "cannot log in" and "multiple users" each match one. So the samples are not independent of the prompt. Caught in Stage 1 review. Fix: `PROMPTS.md` now says the rules were written knowing the samples, so passing them shows the rules behave as intended, not that the prompt generalizes, and measuring generalization needs a labeled set written separately from the prompt. "SSO", which came from sample 4, was also removed from the Technical Question definition in `prompts/triage.md`.
- **Committed a confidential spec.** The spec's markdown copy dropped the .docx footer marking it "Confidential — Internal Use Only", so `ASSESSMENT.md` was committed in Stage 1. Caught in Stage 1 review. Fix: amended the unpushed commit to untrack it, and added it to `.gitignore`.

## Stage 2

- **Wrong floating-point example.** The Stage 2 proposal said 1480.10 − 980.10 is 500.00000000000006 in JavaScript. It is 499.9999999999999, which doesn't fire the "over 500" rule with or without rounding, so the example didn't show the bug it was meant to show. Caught in Stage 2 review. Fix: the rounding test and the code comment use 600.20 − 100.20, which is 500.00000000000006. A sabotage run that removes the rounding fails that test.
- **Missed curly apostrophes.** The proposed "it's down" pattern covered only the straight apostrophe, but email clients often send "it’s". Caught in Stage 2 review. Fix: the pattern matches both, and a test covers the curly form.
- **Wrong test command.** The proposal said to run `node --test tests/`. On Node 22 that treats `tests/` as a file and fails with MODULE_NOT_FOUND. Caught on the first run. Fix: `node --test "tests/*.test.js"`.
- **Missed "were" in the down pattern.** The verb list had "was" but not "were", so "the servers were down" didn't match. Caught in Stage 2 review. Fix: added "were" to the pattern, and a test for "The servers were down this morning."
- **Model labeled a single-user error Incident/Outage.** In the strict-mode schema check, the made-up message "Our SAML login page shows error 502 since this morning for my account" came back from gpt-4o-mini-2024-07-18 as Incident/Outage with confidence 0.9 and the rationale "suggesting a service issue". Its own enrichment said `multi_user_impact: false`. The prompt's tie-breaker says one user's error is a Bug Report unless the service is down or multiple users are affected. Routing would send it to Escalation (`incident_category`) instead of Engineering. The same output's summary also speculated ("This issue is likely impacting their ability to log in."), which `prompts/triage.md` forbids ("Use only what the message says."). Caught by reading the raw output of the schema check. Fix: no prompt change yet; decide after the five-sample run.
