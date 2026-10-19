# ArcVault intake and triage: results

## Results

I ran the five samples and 10 extras live. I committed the extras (`samples-extra.json`) with intended outcomes before any run, but wrote my expectations for the samples (`tests/expected.json`) after seeing the first run's outputs. Scoring category, queue and reasons, the baseline passed 8 of 15 (samples 3 of 5):

| # | Intended | Baseline |
|---|---|---|
| 1 | Bug Report → Engineering | Incident/Outage → Escalation ✗ |
| 2 | Feature Request → Product | Escalation (multi-user) ✗ |
| 3 | Billing Issue → Billing | ✓ |
| 4 | Technical Question → IT/Security | ✓ |
| 5 | Incident/Outage → Escalation | ✓ |
| x01 vague | Escalation (not actionable) | Bug Report → Engineering ✗ |
| x02 $650 overcharge | Billing Issue → Escalation | extra multi-user reason ✗ |
| x03 one user's 504 | Bug Report → Engineering | ✓ |
| x04 whole app down | Incident/Outage → Escalation | ✓ |
| x05 "drop-down for" | Feature Request → Product | ✓ |
| x06 "all our users" | Feature Request → Product | Escalation (multi-user) ✗ |
| x07 bug plus billing question | Bug Report → Engineering | ✓ |
| x08 injection; one user can't sign in | Bug Report, High → Engineering | Incident/Outage ✗ |
| x09 Spanish bug report | Bug Report → Engineering | ✓ |
| x10 off-topic | Escalation (not actionable) | Technical Question → IT/Security ✗ |

Four changes (`DECISIONS.md`) raised the score: multi-user routing only on problem reports (11), the prompt's multi-user scope (11), three self-written outage-boundary examples (12, fixing sample 1 and my made-up 502 message), and the `actionable` flag (14 of 15, samples 5 of 5). Only x08 still misses (Incident/Outage; priority stayed High). After change 3, gpt-4o passed 14 at $0.0054 per message and gpt-4o-mini 12 at $0.0003; I didn't rerun gpt-4o after change 4.

**Priority.** The end-to-end test first passed 2 of 5 samples, with 2, 3 and 4 off on priority only, then 3 of 5 under my policy (`DECISIONS.md`). Sample 3 (invoice above the contract rate) stays Medium, not High, and sample 4 (SSO evaluation question) Low, not Medium. A demo invoice with a $1,100 gap came back High: a hint, not proof, that gap size matters.

**Consistency.** Three more runs of all 15 on the final workflow (temperature 0, same model snapshot), the third committed: 12 matched on category, priority, queue and reasons every time. x01 was escalated only in run 3; runs 1 and 2 and a fresh-clone run sent it to Engineering as actionable. x08 was a Bug Report for Engineering in runs 1 and 2, escalated in run 3. x06's priority was Low once, Medium twice. Each run scored 14 of 15, but the miss moved between x01 and x08: the final score is one draw. Confidence varied only on x01 (0.70–0.85) and x06 (0.85–0.95); summary wording on 10 messages.

## Known weaknesses

Beyond x08 and the unexplained priority misses above:

- **Both safety nets are the model's own judgment:** self-reported confidence and `actionable` (see x01).
- **The tests are small and mine,** and the rules were written knowing the samples.
- **One category per message:** x07's billing question isn't routed.
- **The webhooks have no authentication and accept any origin:** fine locally, where n8n listens on 127.0.0.1 only; production needs authentication and an origin allow-list.
- **Smaller gaps:** bad input gets a generic HTTP 500; no negation handling; USD is assumed; a resent id overwrites its file; webhook.site's free URL takes 50 requests, then the POST fails but the record is kept and returned; the n8n editor first asks for an owner account.
