const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { route } = require("../src/routing.js");
const { buildRecord } = require("../src/record.js");
const schema = require("../schema.json");

const INTAKE = {
  id: "t1",
  source: "Email",
  received_at: "2026-10-19T09:00:00.000Z",
  message: "Could someone take a look when you have a moment?", // no outage keyword
};
const PROCESSED_AT = "2026-10-19T09:00:03.000Z";
const SNAPSHOT = "gpt-4o-mini-2024-07-18";

// A valid $defs.llm object.
function llmOutput(category = "Feature Request") {
  return {
    enrichment: {
      core_issue: "The customer asks for a timezone picker.",
      identifiers: [],
      billing: { invoiced_amount: null, contract_amount: null, currency: null },
      urgency: { evidence: [], level: "Low" },
      multi_user_impact: false,
      actionable: true,
    },
    classification: { rationale: "Fixture.", category, priority: "Low", confidence: 0.95 },
    summary: "Fixture.",
  };
}

// A chat completions reply with one choice.
const reply = ({ content = JSON.stringify(llmOutput()), refusal = null, finish_reason = "stop" } = {}) => ({
  model: SNAPSHOT,
  choices: [{ index: 0, finish_reason, message: { role: "assistant", content, refusal } }],
});

const build = (response) =>
  buildRecord({ intake: INTAKE, response, route, model: "gpt-4o-mini", processedAt: PROCESSED_AT });

// Every failure gives the same shape: no model sections, Escalation, llm_error.
function assertFailed(record) {
  assert.equal(record.classification, null);
  assert.equal(record.enrichment, null);
  assert.equal(record.summary, null);
  assert.deepEqual(record.routing, { standard_queue: null, destination_queue: "Escalation" });
  assert.deepEqual(record.escalation, { flagged: true, reasons: ["llm_error"], billing_discrepancy: null });
}

describe("a normal reply", () => {
  const record = build(reply());

  test("fields come out in schema order", () => {
    assert.deepEqual(Object.keys(record), Object.keys(schema.properties));
    assert.deepEqual(Object.keys(record.meta), Object.keys(schema.$defs.meta.properties));
  });

  test("intake is copied, model sections are taken as written, routing comes from route()", () => {
    const llm = llmOutput();
    assert.deepEqual(record, {
      ...INTAKE,
      classification: llm.classification,
      enrichment: llm.enrichment,
      routing: { standard_queue: "Product", destination_queue: "Product" },
      summary: llm.summary,
      escalation: { flagged: false, reasons: [], billing_discrepancy: null },
      meta: { model: SNAPSHOT, processed_at: PROCESSED_AT, error: null },
    });
  });
});

describe("failures escalate with llm_error", () => {
  test("an error response, with the key redacted", () => {
    // OpenAI's 401 message quotes the start and end of the key; this one is fake.
    const record = build({
      error: {
        message:
          "401 - Incorrect API key provided: sk-proj-FAKE****************************0000. You can find your API key at https://platform.openai.com/account/api-keys.",
      },
    });
    assertFailed(record);
    assert.equal(
      record.meta.error,
      "OpenAI call failed: 401 - Incorrect API key provided: [redacted key]. You can find your API key at https://platform.openai.com/account/api-keys.",
    );
    assert.ok(!JSON.stringify(record).includes("sk-"));
    assert.equal(record.meta.model, "gpt-4o-mini"); // no reply, so the requested model
  });

  test("an error given as a string", () => {
    const record = build({ error: "socket hang up" });
    assertFailed(record);
    assert.equal(record.meta.error, "OpenAI call failed: socket hang up");
  });

  test("a refusal", () => {
    const record = build(reply({ content: null, refusal: "I can't help with that." }));
    assertFailed(record);
    assert.equal(record.meta.error, "Model refused: I can't help with that.");
  });

  test('finish_reason "length"', () => {
    const record = build(reply({ content: '{"enrichment": {"core_issue": "The cus', finish_reason: "length" }));
    assertFailed(record);
    assert.equal(record.meta.error, "Model reply cut off: finish_reason length");
  });

  test("content that isn't JSON", () => {
    const record = build(reply({ content: "Category: Bug Report" }));
    assertFailed(record);
    assert.match(record.meta.error, /^Model reply is not JSON: /);
  });

  test("a category outside the allowed list gives null sections", () => {
    const record = build(reply({ content: JSON.stringify(llmOutput("Sales")) }));
    assertFailed(record);
    assert.equal(record.meta.error, "Model output outside the allowed categories or confidence range");
    assert.equal(record.meta.model, SNAPSHOT);
  });
});
