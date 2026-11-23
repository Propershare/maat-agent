#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$1"
if [ -z "$DEST" ]; then DEST="$SCRIPT_DIR/runtime"; fi
echo "Checking host security capabilities"
command -v node >/dev/null || { echo "node 22+ required"; exit 1; }
node -e 'const v=process.versions.node.split(".").map(Number); if(v[0]<22) process.exit(1)' || { echo "node 22+ required"; exit 1; }
command -v bwrap >/dev/null || { echo "bubblewrap required"; exit 1; }
unshare --user --map-root-user true || { echo "unprivileged user namespaces required"; exit 1; }
mkdir -p "$DEST"
cp "$SCRIPT_DIR"/tarballs/*.tgz "$DEST"/
cd "$DEST"
if [ ! -f package.json ]; then npm init -y >/dev/null; fi
npm install --ignore-scripts --no-audit --no-fund ./earendil-works-pi-ai-0.8.0.tgz ./earendil-works-pi-agent-core-0.8.0.tgz ./earendil-works-pi-tui-0.8.0.tgz ./earendil-works-pi-coding-agent-0.8.0.tgz
cp "$SCRIPT_DIR/smoke.mjs" "$DEST/smoke.mjs"
node "$DEST/smoke.mjs"
echo "Ma'at Runtime installed at $DEST"
