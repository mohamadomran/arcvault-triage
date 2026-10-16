#!/usr/bin/env bash
# One-command setup: builds the workflow and credential, starts n8n, imports both and publishes
# the workflow. Rerunning it replaces both, because their ids are fixed.
set -euo pipefail
cd "$(dirname "$0")/.."

WORKFLOW_ID=arcvaultTriage01
N8N="docker compose exec -T n8n n8n"

# The credential file holds the API key: delete it however this script ends.
trap 'rm -f build/credentials.json' EXIT

wait_for_n8n() {
  for _ in $(seq 1 60); do
    curl -sf http://localhost:5678/healthz >/dev/null && return 0
    sleep 2
  done
  echo "n8n did not answer on http://localhost:5678/healthz within 120 s; see: docker compose logs n8n" >&2
  exit 1
}

# webhook.site mock for the queue POSTs: created once through its API, then kept in .env.
if ! node -e 'process.loadEnvFile(".env"); process.exit(process.env.WEBHOOK_SITE_URL ? 0 : 1)'; then
  token=$(curl -sf -X POST -H "Accept: application/json" https://webhook.site/token)
  uuid=$(node -e 'console.log(JSON.parse(process.argv[1]).uuid)' "$token")
  printf '\nWEBHOOK_SITE_URL=https://webhook.site/%s\n' "$uuid" >> .env
  echo "created https://webhook.site/$uuid and added it to .env"
fi

mkdir -p build output/records .n8n
node scripts/build-workflow.js
cp workflow.json build/workflow.json
node scripts/build-credentials.js

docker compose up -d
wait_for_n8n
$N8N import:credentials --input=/import/credentials.json
$N8N import:workflow --input=/import/workflow.json
$N8N publish:workflow --id="$WORKFLOW_ID"
# The running server only picks up CLI changes after a restart.
docker compose restart n8n
wait_for_n8n
echo "ready: POST http://localhost:5678/webhook/intake"
