// End to end: the records n8n wrote, against two sets of outcomes:
// - samples-extra.json: the "intended" outcome of each extra message;
// - tests/expected.json: my expected outcomes for the five samples, once every value is filled in.
// Needs sample runs first: node scripts/run-samples.js and node scripts/run-samples.js samples-extra.json
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const extras = require("../../samples-extra.json");
const expected = require("../expected.json");

const recordsDir = path.join(__dirname, "../../output/records");
const readRecord = (id) =>
  JSON.parse(fs.readFileSync(path.join(recordsDir, `${id}.json`), "utf8"));

// The record's value for each checked field; reasons are compared as a set.
function outcome({ classification, routing, escalation }) {
  return {
    category: classification?.category ?? null,
    priority: classification?.priority ?? null,
    destination_queue: routing.destination_queue,
    flagged: escalation.flagged,
    reasons: [...escalation.reasons].sort(),
  };
}

// Compares only the fields the expectation lists, so "intended" can leave out a category
// it doesn't care about (a vague or off-topic message).
function assertOutcome(record, want) {
  const got = outcome(record);
  const checked = Object.fromEntries(Object.keys(want).map((key) => [key, got[key]]));
  const wanted = { ...want, ...(want.reasons && { reasons: [...want.reasons].sort() }) };
  assert.deepEqual(checked, wanted);
}

for (const { id, message, intended } of extras) {
  test(`extra ${id} matches its intended outcome`, () => {
    const record = readRecord(id);
    assert.equal(record.message, message, "the record is for this message");
    assertOutcome(record, intended);
  });
}

const filled = expected.every(
  (exp) =>
    exp.classification.category !== null &&
    exp.classification.priority !== null &&
    exp.routing.destination_queue !== null &&
    exp.escalation.flagged !== null &&
    exp.escalation.reasons !== null,
);
for (const exp of expected) {
  test(
    `sample ${exp.id} matches tests/expected.json`,
    { skip: !filled && "tests/expected.json is not filled in" },
    () => {
      const record = readRecord(exp.id);
      assert.equal(record.message, exp.message, "the record is for this sample's message");
      assertOutcome(record, {
        category: exp.classification.category,
        priority: exp.classification.priority,
        destination_queue: exp.routing.destination_queue,
        flagged: exp.escalation.flagged,
        reasons: exp.escalation.reasons,
      });
    },
  );
}
