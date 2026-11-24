# Architecture

## Three core agents

### Ma'at Orchestrator

MaatOrchestrator registers agents and accepts research, development, or research-and-development assignments. It routes research to K2 and development to the Coding Agent. For combined work, the K2 result is placed in the task context before coding.

### K2 Master Researcher

K2Researcher loads the original 27-method Art of Research registry. getRegisteredMethodCount returns 27. The registry preserves the method IDs and titles. Process-file metadata is portable and no longer contains laboratory absolute paths.

### Ma'at Coding Agent

CodingAgent accepts a CodingSessionRunner. PrimeAgentSessionRunner adapts a real Prime Agent AgentSession. The installed verification uses a deterministic faux provider and observes agent_end.

## Runtime and Adaptive Intelligence

MaatRuntime wraps the Orchestrator and records outcomes in AdaptiveIntelligence. AdaptiveIntelligence records success, failure, latency, and agent metrics, and produces approval-gated specialization recommendations.

## Optional Model Foundry

The installed module exports the ModelFoundry interface. No implementation or training system is included. This remains an interface only.

## Governance

- MaatPolicyEngine evaluates policy and actor ring.
- TehutiGuardHttpAdapter calls Guard HTTP.
- GovernedToolRuntime authorizes and records.
- SideEffectBroker signs and validates bindings, checks replay, and executes handlers.
- GitMaatEvidenceLog writes and verifies JSONL receipts.

createBrokerAgentTool always enters the governed service path.

## Distribution

The runtime is packaged in @earendil-works/pi-coding-agent@0.8.0 under dist/maat and dist/governance, with the maat binary and the existing Prime Agent package.