// End to end: the records n8n wrote for the five samples against my expected outcomes in
// tests/expected.json. Needs a sample run first (node scripts/run-samples.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const expected = require("../expected.json");

const recordsDir = path.join(__dirname, "../../output/records");

// Only the fields I set expectations for; reasons are compared as a set.
function outcome({ classification, routing, escalation }) {
  return {
    category: classification?.category ?? null,
    priority: classification?.priority ?? null,
    destination_queue: routing.destination_queue,
    flagged: escalation.flagged,
    reasons: escalation.reasons === null ? null : [...escalation.reasons].sort(),
  };
}

for (const exp of expected) {
  test(`sample ${exp.id} matches tests/expected.json`, () => {
    const record = JSON.parse(fs.readFileSync(path.join(recordsDir, `${exp.id}.json`), "utf8"));
    assert.equal(record.message, exp.message, "the record is for this sample's message");
    assert.deepEqual(outcome(record), outcome(exp));
  });
}
