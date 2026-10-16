// Writes build/credentials.json, the OpenAI credential in the format `n8n import:credentials`
// reads. It holds the API key: build/ is gitignored and setup.sh deletes the file after import.
// Prints nothing from .env.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
process.loadEnvFile(path.join(root, ".env"));
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is empty in .env; add the key and rerun setup.sh.");
}

// Must match CREDENTIAL in scripts/build-workflow.js, which references it by id.
const credential = {
  id: "arcvaultOpenAI01",
  name: "OpenAI API key",
  type: "httpHeaderAuth",
  data: { name: "Authorization", value: `Bearer ${process.env.OPENAI_API_KEY}` },
};

fs.mkdirSync(path.join(root, "build"), { recursive: true });
fs.writeFileSync(
  path.join(root, "build/credentials.json"),
  JSON.stringify([credential]),
  { mode: 0o600 },
);
console.log("wrote build/credentials.json");
