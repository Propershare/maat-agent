# Test Evidence

## Environment

- Date: 2026-11-24
- Host: Linux 5.15.0-191-generic x86_64
- Node.js: v22.22.3
- Package: @earendil-works/pi-coding-agent@0.8.0

## Build and install

- npm run build: exit 0
- Portable bundle: exit 0
- Fresh install: exit 0
- Install log: 192 packages added on the initial install; sandbox capability check passed; installed smoke returned maat-install-ok

## Installed three-agent smoke

Command: node smoke-three-agents.mjs (RC root, imports installed package)

- Exit code: 0
- Methods: 27
- Independent research: PASS
- Independent coding: PASS
- Orchestrator research task: completed
- Orchestrator development task: completed
- Orchestrator combined task: completed
- Research context transfer: true
- Adaptive Intelligence: 3 outcomes, 3 successes, 0 failures

## Installed real AgentSession

Command: node smoke-real-session.mjs (installed directory)

- Exit code: 0
- Task status: completed
- Backend: prime-agent-session
- Response: implemented by installed AgentSession
- agent_end events: 1
- Research context: true

## Installed security integration

Command: node smoke-security.mjs (installed directory)

- Exit code: 0
- Guard HTTP allow: PASS
- Mandatory broker execution: PASS, handler calls 1
- Valid signed binding: PASS
- Invalid signature: PASS, rejected
- Replay: PASS, rejected
- Guard deny: PASS, handler not executed
- Broker outage: PASS, fail closed
- Guard outage: PASS, fail closed
- GitMaat evidence: PASS, valid, 6 records

## Full regression

- Test files: 345 passed, 9 skipped, 354 total
- Tests: 4,501 passed, 0 failed, 64 skipped, 4,565 total
- Duration: 128.51s
- Exit status: successful, zero failures

## Supervisor timeout correction

The adoption test now has an explicit 60,000 ms timeout. The suite default is 30,000 ms. The isolated process test file took about 51 seconds; similar process tests already use 60,000 ms. No assertions were changed.

## Limitations

See SECURITY_LIMITATIONS.md. This evidence does not establish authenticated production Guard behavior, host-level broker containment, a fresh-host install, Model Foundry implementation, or organizational intake.
