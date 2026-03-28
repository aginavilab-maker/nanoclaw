#!/bin/bash
set -e
echo "[DEBUG] entrypoint started" >&2
echo "[DEBUG] memory: $(free -m | grep Mem | awk '{print $2"MB total, "$3"MB used, "$4"MB free"}')" >&2
echo "[DEBUG] starting tsc..." >&2
cd /app && npx tsc --outDir /tmp/dist 2>&1 >&2
echo "[DEBUG] tsc done" >&2
ln -s /app/node_modules /tmp/dist/node_modules
chmod -R a-w /tmp/dist
echo "[DEBUG] waiting for input..." >&2
cat > /tmp/input.json
echo "[DEBUG] input received, size=$(wc -c < /tmp/input.json) bytes" >&2
echo "[DEBUG] starting node..." >&2
node /tmp/dist/index.js < /tmp/input.json
echo "[DEBUG] node finished with exit code $?" >&2
