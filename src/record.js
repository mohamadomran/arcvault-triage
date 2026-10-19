// Record assembly: parses the model's reply and builds the output record in schema order. Pure
// functions, no I/O. scripts/build-workflow.js inlines this file after src/routing.js in the same
// n8n Code node, so it must not use require/import. route() comes in as an argument instead.

// A failed call, a refusal, a cut-off reply or content that isn't JSON all leave llm null, which
// route() turns into llm_error and the Escalation queue.
function parseReply(response) {
  if (response.error !== undefined) {
    const e = response.error;
    return {
      llm: null,
      error: "OpenAI call failed: " + (typeof e === "string" ? e : e.message ?? JSON.stringify(e)),
    };
  }
  const choice = response.choices?.[0];
  if (choice?.message?.refusal) return { llm: null, error: "Model refused: " + choice.message.refusal };
  if (choice?.finish_reason !== "stop") {
    return { llm: null, error: "Model reply cut off: finish_reason " + choice?.finish_reason };
  }
  try {
    return { llm: JSON.parse(choice.message.content), error: null };
  } catch (e) {
    return { llm: null, error: "Model reply is not JSON: " + e.message };
  }
}

// OpenAI's 401 message quotes part of the key; keep it out of the record.
function redactKey(text) {
  return text.replace(/sk-[\w*-]+/g, "[redacted key]");
}

// intake: { id, source, received_at, message } from Step 1. response: the OpenAI reply, or the
// HTTP node's error item. model: the requested model, used when the reply doesn't name one.
function buildRecord({ intake, response, route, model, processedAt }) {
  const { llm, error } = parseReply(response);
  const { routing, escalation } = route(llm, intake.message);
  const failed = escalation.reasons.includes("llm_error");
  const reason = failed
    ? error ?? "Model output outside the allowed categories or confidence range"
    : null;
  return {
    ...intake,
    classification: failed ? null : llm.classification,
    enrichment: failed ? null : llm.enrichment,
    routing,
    summary: failed ? null : llm.summary,
    escalation,
    meta: {
      model: response.model ?? model,
      processed_at: processedAt,
      error: reason && redactKey(reason),
    },
  };
}

if (typeof module !== "undefined") {
  module.exports = { parseReply, redactKey, buildRecord };
}
