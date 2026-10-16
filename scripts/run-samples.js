// POSTs each sample to the n8n webhook, one at a time, then writes output/records.json: every
// record from this run in one file, sorted by id (spec 4.2). n8n also writes each record to
// output/records/<id>.json. Run: node scripts/run-samples.js [samples file, default samples.json]
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const WEBHOOK = "http://localhost:5678/webhook/intake";
const samplesFile = path.resolve(process.argv[2] ?? path.join(root, "samples.json"));
const samples = JSON.parse(fs.readFileSync(samplesFile, "utf8"));

async function main() {
  const records = [];
  // One at a time, so the run order and the OpenAI rate limit stay predictable.
  for (const sample of samples) {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sample),
    });
    if (!res.ok) {
      throw new Error(`Sample ${sample.id}: webhook answered ${res.status}: ${await res.text()}. Is n8n up (scripts/setup.sh)?`);
    }
    const record = await res.json();
    records.push(record);
    console.log(`${record.id}\t${record.classification?.category ?? "-"}\t${record.routing.destination_queue}\t${record.escalation.reasons.join(",") || "-"}`);
  }
  records.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  fs.writeFileSync(path.join(root, "output/records.json"), JSON.stringify(records, null, 2) + "\n");
  console.log(`wrote output/records.json (${records.length} records)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
