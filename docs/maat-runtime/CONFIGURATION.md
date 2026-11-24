# Configuration

## Model

Ma'at is configured by constructing explicit objects. The Ma'at modules do not load production credentials implicitly.

## Entry points

- dist/maat/orchestrator.js - MaatOrchestrator, K2Agent, CodingAgent
- dist/maat/researcher.js - K2Researcher, getRegisteredMethodCount
- dist/maat/runtime.js - MaatRuntime
- dist/maat/adaptive-intelligence.js - AdaptiveIntelligence
- dist/maat/prime-agent.js - PrimeAgentSessionRunner
- dist/maat/governed-actions.js - GovernedActionService
- dist/maat/broker-tool.js - createBrokerAgentTool
- dist/governance/ - policy, Guard HTTP, broker, replay, GitMaat evidence

## Required values

| Setting | Purpose |
| --- | --- |
| Guard endpoint | Local or approved Tehuti Guard HTTP endpoint |
| Guard token | Bearer token; use a disposable test token only in this RC |
| Guard machine ID | Identity supplied to the Guard adapter |
| Actor ID | Policy actor identity |
| Policy | Ma'at policy document or default policy |
| Broker identity secret | HMAC signing secret for action bindings |
| Replay store | In-memory for the RC; durable store required for production |
| Evidence path | Writable JSONL path for GitMaat receipts |

## Governed execution

Privileged actions must pass through MaatPolicyEngine, TehutiGuardHttpAdapter, GovernedToolRuntime, GovernedActionService, SideEffectBroker, and GitMaatEvidenceLog.

GovernedActionService requires a broker dependency; there is no direct operation path.

## Example

config.example.json is a deployment template. It is not automatically loaded by the CLI. Populate the constructors in your host application. Never commit a real token or identity secret.

## Fixture-only values

The verified security test uses 127.0.0.1, an ephemeral Guard port, the literal test token test-token, machine ID test-machine, actor outer-agent, in-memory replay stores, and disposable temporary evidence files.
