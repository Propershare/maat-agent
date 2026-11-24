#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORK="$(mktemp -d /tmp/maat-install-test-XXXXXX)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
bash "$ROOT/packages/coding-agent/scripts/maat-portable-bundle.sh" "$WORK"
"$WORK/install.sh" "$WORK/runtime" | tee "$WORK/install.log"
grep -q 'maat-install-ok' "$WORK/install.log"
echo "AUTOMATED_INSTALL_TEST=PASS"
