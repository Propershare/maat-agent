#!/usr/bin/env bash
# Verify a clean checkout can install, check, build, test offline, and launch.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT="${1:-${TMPDIR:-/tmp}/maat-runtime-clean-install-report.json}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/maat-runtime-clean-install.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/home"
export HOME="$TMP/home"
export CI=1
export PI_NO_LOCAL_LLM=1

git -C "$ROOT" archive HEAD | tar -C "$TMP" -xf -
cd "$TMP"

install_rc=0
check_rc=0
build_rc=0
test_rc=0
launch_rc=0

npm ci --no-audit --no-fund >/tmp/maat-clean-install.log 2>&1 || install_rc=$?
if [[ "$install_rc" -eq 0 ]]; then
  npm run check >>/tmp/maat-clean-install.log 2>&1 || check_rc=$?
  npm run build >>/tmp/maat-clean-install.log 2>&1 || build_rc=$?
  npm test >>/tmp/maat-clean-install.log 2>&1 || test_rc=$?
  ./prime-agent.sh --dist --no-env --help >/dev/null 2>&1 || launch_rc=$?
fi

ok=false
if [[ "$install_rc" -eq 0 && "$check_rc" -eq 0 && "$build_rc" -eq 0 && "$test_rc" -eq 0 && "$launch_rc" -eq 0 ]]; then
  ok=true
fi

python3 - "$REPORT" "$ok" "$install_rc" "$check_rc" "$build_rc" "$test_rc" "$launch_rc" "$ROOT" "$TMP" <<'PY'
import json
import os
import sys

report, ok, install_rc, check_rc, build_rc, test_rc, launch_rc, root, tmp = sys.argv[1:]
data = {
    "ok": ok == "true",
    "source_root": root,
    "source_commit": os.popen(f"git -C {root!r} rev-parse HEAD").read().strip(),
    "isolated_dir_removed": True,
    "environment": {"CI": "1", "PI_NO_LOCAL_LLM": "1", "HOME": "isolated-temp-home"},
    "commands": {
        "install": {"cmd": "npm ci --no-audit --no-fund", "exit": int(install_rc)},
        "check": {"cmd": "npm run check", "exit": int(check_rc)},
        "build": {"cmd": "npm run build", "exit": int(build_rc)},
        "tests": {"cmd": "npm test", "exit": int(test_rc)},
        "launcher": {"cmd": "./prime-agent.sh --dist --no-env --help", "exit": int(launch_rc)},
    },
    "notes": [
        "Provider integration tests are opt-in; Ollama requires RUN_OLLAMA_INTEGRATION=1.",
        "No private lab configuration is copied into the isolated HOME.",
    ],
}
with open(report, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(json.dumps(data, indent=2))
sys.exit(0 if data["ok"] else 1)
PY
