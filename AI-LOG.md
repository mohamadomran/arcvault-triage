# AI log

Each time the AI assistant made a mistake or was corrected, or the model's output was wrong: what happened, how it was caught, and the fix.

## Plan review

- **Overbuilt docs and tests.** The proposed plan had a `docs/` folder with separate architecture and prompt documents, and an end-to-end test that checked the payloads webhook.site captured. Caught in plan review. Fix: one `WRITEUP.md` at the root plus `PROMPTS.md`. The test compares the files n8n writes with `tests/expected.json`, and webhook.site is used only for the demo.
- **Missed a secret-handling step.** The plan proposed scripting the n8n credential import, but did not say that the generated credentials file holds the API key and must stay out of git. Caught in plan review. Fix: that file is gitignored in the setup stage.

## Stage 1

- **Overstated test independence.** `PROMPTS.md` claimed that leaving the five samples out of the prompt as few-shot examples kept the test meaningful. The tie-breaker and priority rules were written knowing the five samples: "is there a way to", "we'd like you to add", "cannot log in" and "multiple users" each match one. So the samples are not independent of the prompt. Caught in Stage 1 review. Fix: `PROMPTS.md` now says the rules were written knowing the samples, so passing them shows the rules behave as intended, not that the prompt generalizes, and measuring generalization needs a labeled set written separately from the prompt. "SSO", which came from sample 4, was also removed from the Technical Question definition in `prompts/triage.md`.
- **Committed a confidential spec.** The spec's markdown copy dropped the .docx footer marking it "Confidential — Internal Use Only", so `ASSESSMENT.md` was committed in Stage 1. Caught in Stage 1 review. Fix: amended the unpushed commit to untrack it, and added it to `.gitignore`.
