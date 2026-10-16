// POSTs each sample to the n8n webhook, one at a time, then writes every record from this run
// to one file, sorted by id: output/records.json for samples.json (spec 4.2), and
// output/records-extra.json for samples-extra.json. n8n also writes each record to
// output/records/<id>.json. Run: node scripts/run-samples.js [samples file, default samples.json]
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const WEBHOOK = "http://localhost:5678/webhook/intake";
const samplesFile = path.resolve(process.argv[2] ?? path.join(root, "samples.json"));
const samples = JSON.parse(fs.readFileSync(samplesFile, "utf8"));
const outFile = `output/${path.basename(samplesFile, ".json").replace(/^samples/, "records")}.json`;

async function main() {
  const records = [];
  // One at a time, so the run order and the OpenAI rate limit stay predictable.
  for (const sample of samples) {
    const { id, source, message } = sample; // "intended" stays out of the request
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, source, message }),
    });
    if (!res.ok) {
      throw new Error(`Sample ${sample.id}: webhook answered ${res.status}: ${await res.text()}. Is n8n up (scripts/setup.sh)?`);
    }
    const record = await res.json();
    records.push(record);
    console.log(`${record.id}\t${record.classification?.category ?? "-"}\t${record.routing.destination_queue}\t${record.escalation.reasons.join(",") || "-"}`);
  }
  records.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  fs.writeFileSync(path.join(root, outFile), JSON.stringify(records, null, 2) + "\n");
  console.log(`wrote ${outFile} (${records.length} records)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
