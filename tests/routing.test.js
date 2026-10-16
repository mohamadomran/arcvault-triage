const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { route, QUEUE_BY_CATEGORY } = require("../src/routing.js");
const schema = require("../schema.json");

const QUIET = "Could someone take a look when you have a moment?"; // no outage keyword

// A valid $defs.llm object; each test overrides only what it is about.
function llmOutput({
  category = "Feature Request",
  confidence = 0.95,
  billing = {},
  multiUser = false,
} = {}) {
  return {
    enrichment: {
      core_issue: "The customer reports something.",
      identifiers: [],
      billing: {
        invoiced_amount: null,
        contract_amount: null,
        currency: null,
        ...billing,
      },
      urgency: { evidence: [], level: "Low" },
      multi_user_impact: multiUser,
    },
    classification: {
      rationale: "Fixture.",
      category,
      priority: "Medium",
      confidence,
    },
    summary: "Fixture.",
  };
}

const reasonsFor = (llm, message = QUIET) =>
  route(llm, message).escalation.reasons;

describe("category to queue", () => {
  // Written out here rather than imported, so the test checks the map instead of restating it.
  const expected = {
    "Bug Report": "Engineering",
    "Incident/Outage": "Engineering",
    "Feature Request": "Product",
    "Billing Issue": "Billing",
    "Technical Question": "IT/Security",
  };

  for (const [category, queue] of Object.entries(expected)) {
    test(`${category} has standard queue ${queue}`, () => {
      assert.equal(
        route(llmOutput({ category }), QUIET).routing.standard_queue,
        queue,
      );
    });
  }

  test("the map covers exactly the categories in schema.json", () => {
    const categories =
      schema.$defs.llm.properties.classification.properties.category.enum;
    assert.deepEqual(
      Object.keys(QUEUE_BY_CATEGORY).sort(),
      [...categories].sort(),
    );
  });

  test("a confident record with no signals goes to its standard queue", () => {
    assert.deepEqual(
      route(llmOutput({ category: "Technical Question" }), QUIET),
      {
        routing: {
          standard_queue: "IT/Security",
          destination_queue: "IT/Security",
        },
        escalation: { flagged: false, reasons: [], billing_discrepancy: null },
      },
    );
  });
});

describe("confidence threshold", () => {
  test("0.69 escalates and keeps the standard queue", () => {
    assert.deepEqual(route(llmOutput({ confidence: 0.69 }), QUIET), {
      routing: { standard_queue: "Product", destination_queue: "Escalation" },
      escalation: {
        flagged: true,
        reasons: ["low_confidence"],
        billing_discrepancy: null,
      },
    });
  });

  test("0.70 does not escalate", () => {
    assert.deepEqual(reasonsFor(llmOutput({ confidence: 0.7 })), []);
  });
});

describe("billing discrepancy", () => {
  const billingRecord = (invoiced_amount, contract_amount) =>
    route(
      llmOutput({
        category: "Billing Issue",
        billing: { invoiced_amount, contract_amount, currency: "USD" },
      }),
      QUIET,
    );

  test("501 escalates", () => {
    const { escalation } = billingRecord(1481, 980);
    assert.equal(escalation.billing_discrepancy, 501);
    assert.deepEqual(escalation.reasons, ["billing_discrepancy_over_500"]);
  });

  test("500 does not escalate", () => {
    const { escalation } = billingRecord(1480, 980);
    assert.equal(escalation.billing_discrepancy, 500);
    assert.deepEqual(escalation.reasons, []);
  });

  test("600.20 minus 100.20 is exactly 500 and does not escalate", () => {
    assert.ok(
      600.2 - 100.2 > 500,
      "precondition: raw floating-point subtraction exceeds 500",
    );
    const { escalation } = billingRecord(600.2, 100.2);
    assert.equal(escalation.billing_discrepancy, 500);
    assert.deepEqual(escalation.reasons, []);
  });

  test("sample 3 ($1,240 vs $980) is a $260 discrepancy and goes to Billing", () => {
    assert.deepEqual(billingRecord(1240, 980), {
      routing: { standard_queue: "Billing", destination_queue: "Billing" },
      escalation: { flagged: false, reasons: [], billing_discrepancy: 260 },
    });
  });

  test("a missing invoiced amount gives null and does not escalate", () => {
    const { escalation } = billingRecord(null, 980);
    assert.equal(escalation.billing_discrepancy, null);
    assert.deepEqual(escalation.reasons, []);
  });

  test("a missing contract amount gives null and does not escalate", () => {
    const { escalation } = billingRecord(1240, null);
    assert.equal(escalation.billing_discrepancy, null);
    assert.deepEqual(escalation.reasons, []);
  });

  test("an undercharge does not escalate", () => {
    const { escalation } = billingRecord(400, 980);
    assert.equal(escalation.billing_discrepancy, -580);
    assert.deepEqual(escalation.reasons, []);
  });

  test("the rule fires for any category, not only Billing Issue", () => {
    const llm = llmOutput({
      category: "Bug Report",
      billing: { invoiced_amount: 1600, contract_amount: 980 },
    });
    assert.deepEqual(reasonsFor(llm), ["billing_discrepancy_over_500"]);
  });
});

describe("outage signals", () => {
  const matching = [
    "We are seeing an outage on the reporting page.",
    "Third outages this month.",
    "The portal is down.",
    "The servers were down this morning.",
    "It went down at 9am.",
    "It has been down since noon.",
    "It's down again.",
    "It’s down again.", // curly apostrophe, as many email clients send it
    "Reports are down for all users.",
    "OUTAGE in EU region",
  ];
  for (const message of matching) {
    test(`keyword matches: ${message}`, () => {
      assert.deepEqual(reasonsFor(llmOutput(), message), ["outage_keyword"]);
    });
  }

  test("keyword ignores 'scroll down', 'drop-down' and 'download'", () => {
    const message =
      "Scroll down in the drop-down and the download button is missing.";
    assert.deepEqual(reasonsFor(llmOutput(), message), []);
  });

  test("keyword ignores 'drop-down for'", () => {
    assert.deepEqual(
      reasonsFor(llmOutput(), "Can you add a drop-down for this?"),
      [],
    );
  });

  test("multi_user_impact from the model escalates a Bug Report", () => {
    assert.deepEqual(
      reasonsFor(llmOutput({ category: "Bug Report", multiUser: true })),
      ["multi_user_impact"],
    );
  });

  for (const category of [
    "Feature Request",
    "Billing Issue",
    "Technical Question",
  ]) {
    test(`multi_user_impact does not escalate a ${category}`, () => {
      assert.deepEqual(
        route(llmOutput({ category, multiUser: true }), QUIET),
        {
          routing: {
            standard_queue: QUEUE_BY_CATEGORY[category],
            destination_queue: QUEUE_BY_CATEGORY[category],
          },
          escalation: { flagged: false, reasons: [], billing_discrepancy: null },
        },
      );
    });
  }

  test("Incident/Outage escalates and keeps Engineering as the standard queue", () => {
    assert.deepEqual(route(llmOutput({ category: "Incident/Outage" }), QUIET), {
      routing: {
        standard_queue: "Engineering",
        destination_queue: "Escalation",
      },
      escalation: {
        flagged: true,
        reasons: ["incident_category"],
        billing_discrepancy: null,
      },
    });
  });
});

describe("llm_error", () => {
  test("a failed call (null) escalates with no standard queue", () => {
    assert.deepEqual(route(null, QUIET), {
      routing: { standard_queue: null, destination_queue: "Escalation" },
      escalation: {
        flagged: true,
        reasons: ["llm_error"],
        billing_discrepancy: null,
      },
    });
  });

  test("the keyword check still runs when the call failed", () => {
    assert.deepEqual(reasonsFor(null, "The portal is down."), [
      "outage_keyword",
      "llm_error",
    ]);
  });

  const unusable = {
    "unknown category": llmOutput({ category: "Sales" }),
    "inherited object key as category": llmOutput({ category: "toString" }),
    "confidence above 1": llmOutput({ confidence: 1.5 }),
    "confidence below 0": llmOutput({ confidence: -0.1 }),
    "confidence as a string": llmOutput({ confidence: "0.9" }),
    "confidence NaN": llmOutput({ confidence: NaN }),
    "classification missing": { ...llmOutput(), classification: undefined },
  };
  for (const [name, llm] of Object.entries(unusable)) {
    test(`unusable output (${name}) is llm_error with standard_queue null`, () => {
      llm.enrichment.billing = {
        invoiced_amount: 2000,
        contract_amount: 980,
        currency: "USD",
      };
      assert.deepEqual(route(llm, QUIET), {
        routing: { standard_queue: null, destination_queue: "Escalation" },
        escalation: {
          flagged: true,
          reasons: ["llm_error"],
          billing_discrepancy: null,
        },
      });
    });
  }
});

describe("several reasons on one record", () => {
  test("every rule that fires is listed, in schema order", () => {
    const llm = llmOutput({
      category: "Incident/Outage",
      confidence: 0.5,
      multiUser: true,
      billing: { invoiced_amount: 2000, contract_amount: 980 },
    });
    assert.deepEqual(route(llm, "Total outage, everything is down."), {
      routing: {
        standard_queue: "Engineering",
        destination_queue: "Escalation",
      },
      escalation: {
        flagged: true,
        reasons: [
          "low_confidence",
          "outage_keyword",
          "multi_user_impact",
          "incident_category",
          "billing_discrepancy_over_500",
        ],
        billing_discrepancy: 1020,
      },
    });
  });
});

describe("invariants over every combination", () => {
  const cases = [
    [null, QUIET],
    [null, "Total outage."],
  ];
  for (const category of Object.keys(QUEUE_BY_CATEGORY))
    for (const confidence of [0.69, 0.7, 0.95])
      for (const invoiced_amount of [null, 1480, 1481, 400])
        for (const multiUser of [false, true])
          for (const message of [QUIET, "Total outage."])
            cases.push([
              llmOutput({
                category,
                confidence,
                multiUser,
                billing: { invoiced_amount, contract_amount: 980 },
              }),
              message,
            ]);

  const queues = schema.$defs.routing.properties.destination_queue.enum;
  const reasonOrder = schema.$defs.escalation.properties.reasons.items.enum;

  test(`${cases.length} combinations satisfy the flag, destination and schema rules`, () => {
    for (const [llm, message] of cases) {
      const { routing, escalation } = route(llm, message);
      const label = JSON.stringify({
        category: llm?.classification.category,
        message,
        escalation,
      });
      assert.equal(
        escalation.flagged,
        escalation.reasons.length > 0,
        `flagged iff reasons: ${label}`,
      );
      assert.equal(
        routing.destination_queue === "Escalation",
        escalation.flagged,
        `Escalation iff flagged: ${label}`,
      );
      if (!escalation.flagged)
        assert.equal(routing.destination_queue, routing.standard_queue, label);
      assert.ok(queues.includes(routing.destination_queue), label);
      assert.deepEqual(
        escalation.reasons,
        reasonOrder.filter((reason) => escalation.reasons.includes(reason)),
        `reasons are known, unique and in schema order: ${label}`,
      );
      assert.deepEqual(
        Object.keys(routing).sort(),
        [...schema.$defs.routing.required].sort(),
      );
      assert.deepEqual(
        Object.keys(escalation).sort(),
        [...schema.$defs.escalation.required].sort(),
      );
    }
  });
});
