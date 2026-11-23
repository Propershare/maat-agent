#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="$1"
if [ -z "$OUT" ]; then OUT="/tmp/maat-runtime-portable"; fi
mkdir -p "$OUT/tarballs"
echo "Packing local artifacts into $OUT/tarballs"
for pkg in ai agent tui coding-agent; do
  (cd "$ROOT/packages/$pkg" && npm pack --pack-destination "$OUT/tarballs" >/dev/null)
done
cp "$ROOT/packages/coding-agent/scripts/maat-install.sh" "$OUT/install.sh"
cp "$ROOT/packages/coding-agent/scripts/maat-smoke.mjs" "$OUT/smoke.mjs"
cp "$ROOT/packages/coding-agent/scripts/maat-bundle-readme.md" "$OUT/README.md"
chmod +x "$OUT/install.sh"
echo "Bundle ready: $OUT"
