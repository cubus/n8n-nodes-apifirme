#!/usr/bin/env bash
# Runs a workflow with the node in a real n8n (Docker) against dev/stub.js,
# prints what came out and what the stub was asked, and removes everything.
# Build first: the node is loaded from dist/.
set -uo pipefail
cd "$(dirname "$0")/.."
net=apifirme-n8n-dev
docker network create $net >/dev/null 2>&1
docker rm -f apifirme-n8n-stub >/dev/null 2>&1
docker run -d --rm --name apifirme-n8n-stub --network $net --network-alias stub -v "$PWD/dev/stub.js":/stub.js:ro node:24-slim node /stub.js >/dev/null

docker run --rm --network $net \
  -e N8N_CUSTOM_EXTENSIONS=/custom -e N8N_DIAGNOSTICS_ENABLED=false -e N8N_VERSION_NOTIFICATIONS_ENABLED=false \
  -e N8N_ENCRYPTION_KEY=dev-stack-only -e N8N_RUNNERS_ENABLED=false \
  -v "$PWD/dist":/custom/n8n-nodes-apifirme/dist:ro -v "$PWD/package.json":/custom/n8n-nodes-apifirme/package.json:ro \
  -v "$PWD/dev":/dev-files:ro --entrypoint sh n8nio/n8n -c '
    n8n --version
    n8n import:credentials --input=/dev-files/credentials.json 2>&1 | tail -2
    n8n import:workflow --input=/dev-files/workflow.json 2>&1 | tail -2
    n8n execute --id=apifirmeDevFlow01 --rawOutput 2>&1 | tail -n +1 > /tmp/out.json
    node -e "
      const text = require(\"fs\").readFileSync(\"/tmp/out.json\", \"utf8\");
      const start = text.indexOf(\"{\");
      try {
        const run = JSON.parse(text.slice(start)).data.resultData.runData;
        for (const [name, runs] of Object.entries(run)) {
          const r = runs[0];
          console.log(name + \": \" + (r.error ? \"ERROR \" + r.error.message : JSON.stringify((r.data.main[0] || []).map((i) => i.json))));
        }
      } catch (e) { console.log(\"could not read the run: \" + e.message + \"\\n\" + text.slice(0, 1500)); }
    "
  '

echo "--- the stub was asked:"
docker run --rm --network $net node:24-slim node -e "fetch('http://stub:8080/seen').then(r=>r.json()).then(s=>s.forEach(x=>console.log(x.method, x.path, 'auth=' + x.auth, 'client=' + x.client)))"
docker rm -f apifirme-n8n-stub >/dev/null 2>&1
docker network rm $net >/dev/null 2>&1
