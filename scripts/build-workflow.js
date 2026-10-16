// Assembles workflow.json from the plain files. prompts/triage.md, schema.json ($defs.llm and the
// source enum) and src/routing.js are copied in verbatim, so workflow.json is never edited by hand.
// Run: node scripts/build-workflow.js
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const schema = JSON.parse(read("schema.json"));
const prompt = read("prompts/triage.md");
const routing = read("src/routing.js");

// Fixed ids: re-importing replaces the same workflow, and the LLM node finds the imported credential.
const WORKFLOW_ID = "arcvaultTriage01";
const CREDENTIAL = { id: "arcvaultOpenAI01", name: "OpenAI API key" }; // see build-credentials.js
const MODEL = "gpt-4o-mini";

// Node names follow the spec's steps, so the canvas maps onto the assessment.
const N = {
  webhook: "Step 1 · Webhook",
  ingest: "Step 1 · Ingestion",
  triage: "Steps 2, 3, 5 · Triage (LLM)",
  route: "Steps 4, 6 · Routing and escalation",
  toFile: "Output · Record to JSON",
  write: "Output · Write record file",
  post: "Output · POST to queue",
  respond: "Output · Respond",
};
const ref = (name) => `$(${JSON.stringify(name)}).first().json`;

// Step 1: validate the body and build the OpenAI request. The id becomes a file name, so a
// string id is limited to letters, digits, "_" and "-".
const ingestCode = `const SOURCES = ${JSON.stringify(schema.properties.source.enum)};
const SYSTEM_PROMPT = ${JSON.stringify(prompt)};
const LLM_SCHEMA = ${JSON.stringify(schema.$defs.llm)};

const { id, source, message } = $input.first().json.body ?? {};
if (!(Number.isInteger(id) || (typeof id === "string" && /^[\\w-]+$/.test(id)))) {
  throw new Error('Body needs "id": an integer, or a string of letters, digits, "_" or "-".');
}
if (!SOURCES.includes(source)) {
  throw new Error('Body needs "source": one of ' + SOURCES.join(", ") + ".");
}
if (typeof message !== "string" || message.trim() === "") {
  throw new Error('Body needs "message": a non-empty string.');
}

const openai_request = {
  model: ${JSON.stringify(MODEL)},
  temperature: 0,
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: \`Source: \${source}\\n<message>\\n\${message}\\n</message>\` },
  ],
  response_format: {
    type: "json_schema",
    json_schema: { name: "triage", strict: true, schema: LLM_SCHEMA },
  },
};
return [{ json: { record: { id, source, received_at: new Date().toISOString(), message }, openai_request } }];
`;

// Steps 4 and 6: src/routing.js decides; this code only parses the model's reply and assembles
// the record in schema order. A failed call, a refusal, a cut-off reply or content that isn't
// JSON all leave llm null, which route() turns into llm_error and the Escalation queue.
const routeCode = `${routing}
// ---- end of src/routing.js ----

const intake = ${ref(N.ingest)}.record;
const response = $input.first().json;

function parseReply(response) {
  if (response.error !== undefined) {
    const e = response.error;
    return { llm: null, error: "OpenAI call failed: " + (typeof e === "string" ? e : e.message ?? JSON.stringify(e)) };
  }
  const choice = response.choices?.[0];
  if (choice?.message?.refusal) return { llm: null, error: "Model refused: " + choice.message.refusal };
  if (choice?.finish_reason !== "stop") return { llm: null, error: "Model reply cut off: finish_reason " + choice?.finish_reason };
  try {
    return { llm: JSON.parse(choice.message.content), error: null };
  } catch (e) {
    return { llm: null, error: "Model reply is not JSON: " + e.message };
  }
}

const { llm, error } = parseReply(response);
const { routing, escalation } = route(llm, intake.message);
const failed = escalation.reasons.includes("llm_error");
// OpenAI's 401 message quotes part of the key; keep it out of the record.
const reason = failed ? (error ?? "Model output outside the allowed categories or confidence range") : null;

return [{ json: {
  ...intake,
  classification: failed ? null : llm.classification,
  enrichment: failed ? null : llm.enrichment,
  routing,
  summary: failed ? null : llm.summary,
  escalation,
  meta: {
    model: response.model ?? ${JSON.stringify(MODEL)},
    processed_at: new Date().toISOString(),
    error: reason && reason.replace(/sk-[\\w*-]+/g, "[redacted key]"),
  },
} }];
`;

const nodes = [
  {
    id: "a1f0c001-0000-4000-8000-000000000001",
    name: N.webhook,
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [0, 0],
    webhookId: "a1f0c001-0000-4000-8000-0000000000aa",
    parameters: { httpMethod: "POST", path: "intake", responseMode: "responseNode", options: {} },
  },
  {
    id: "a1f0c001-0000-4000-8000-000000000002",
    name: N.ingest,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [220, 0],
    parameters: { jsCode: ingestCode },
  },
  {
    id: "a1f0c001-0000-4000-8000-000000000003",
    name: N.triage,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [440, 0],
    parameters: {
      method: "POST",
      url: "https://api.openai.com/v1/chat/completions",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify(${ref(N.ingest)}.openai_request) }}`,
      options: { timeout: 30000 },
    },
    credentials: { httpHeaderAuth: CREDENTIAL },
    // n8n's maxTries counts attempts, so 4 is the first call plus 3 retries.
    retryOnFail: true,
    maxTries: 4,
    waitBetweenTries: 2000,
    // After the last retry the error goes to the second output instead of stopping the run.
    onError: "continueErrorOutput",
  },
  {
    id: "a1f0c001-0000-4000-8000-000000000004",
    name: N.route,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [660, 0],
    parameters: { jsCode: routeCode },
  },
  {
    id: "a1f0c001-0000-4000-8000-000000000005",
    name: N.toFile,
    type: "n8n-nodes-base.convertToFile",
    typeVersion: 1.1,
    position: [880, 0],
    parameters: { operation: "toJson", mode: "each", options: { format: true } },
  },
  {
    // Written before the POST, so the record is kept even if webhook.site fails.
    id: "a1f0c001-0000-4000-8000-000000000006",
    name: N.write,
    type: "n8n-nodes-base.readWriteFile",
    typeVersion: 1,
    position: [1100, 0],
    parameters: {
      operation: "write",
      fileName: `=/files/output/records/{{ ${ref(N.route)}.id }}.json`,
      dataPropertyName: "data",
      options: {},
    },
  },
  {
    // One mock endpoint stands in for all five queues; the queue name rides in the query string.
    id: "a1f0c001-0000-4000-8000-000000000007",
    name: N.post,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [1320, 0],
    parameters: {
      method: "POST",
      url: "={{ $env.WEBHOOK_SITE_URL }}",
      sendQuery: true,
      queryParameters: {
        parameters: [{ name: "queue", value: `={{ ${ref(N.route)}.routing.destination_queue }}` }],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify(${ref(N.route)}) }}`,
      options: {},
    },
    // The record is already on disk, so a failed POST (webhook.site's free URL takes 50 requests,
    // then answers 429) must not turn the intake into an error: the error output also responds.
    onError: "continueErrorOutput",
  },
  {
    id: "a1f0c001-0000-4000-8000-000000000008",
    name: N.respond,
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [1540, 0],
    parameters: { respondWith: "json", responseBody: `={{ ${ref(N.route)} }}`, options: {} },
  },
];

const next = (name) => ({ main: [[{ node: name, type: "main", index: 0 }]] });
const connections = {
  [N.webhook]: next(N.ingest),
  [N.ingest]: next(N.triage),
  // Output 0 is the reply, output 1 the error after retries; both go to routing.
  [N.triage]: {
    main: [
      [{ node: N.route, type: "main", index: 0 }],
      [{ node: N.route, type: "main", index: 0 }],
    ],
  },
  [N.route]: next(N.toFile),
  [N.toFile]: next(N.write),
  [N.write]: next(N.post),
  [N.post]: {
    main: [
      [{ node: N.respond, type: "main", index: 0 }],
      [{ node: N.respond, type: "main", index: 0 }],
    ],
  },
};

// After a restart, n8n serves the previously published version for a few seconds before it
// switches to the new one. The build id is a hash of the pipeline; GET /webhook/intake-build
// returns it, so setup.sh can wait until the version it just published is the one serving.
const BUILD_ID = crypto
  .createHash("sha256")
  .update(JSON.stringify({ nodes, connections }))
  .digest("hex")
  .slice(0, 12);
nodes.push({
  id: "a1f0c001-0000-4000-8000-000000000009",
  name: "Setup · Build check",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
  position: [0, 200],
  webhookId: "a1f0c001-0000-4000-8000-0000000000bb",
  parameters: {
    httpMethod: "GET",
    path: "intake-build",
    responseMode: "onReceived",
    options: { responseData: BUILD_ID },
  },
});

const workflow = {
  id: WORKFLOW_ID,
  name: "ArcVault intake and triage",
  nodes,
  connections,
  settings: { executionOrder: "v1" },
  pinData: {},
  active: false,
};

fs.writeFileSync(path.join(root, "workflow.json"), JSON.stringify(workflow, null, 2) + "\n");
console.log("wrote workflow.json");
