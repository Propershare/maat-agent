# Security Limitations

These limitations are part of the RC acceptance record.

## Not production-validated

- No authenticated production Tehuti Guard validation has been performed. The verified Guard path is a disposable local HTTP fixture.
- Host-level broker containment is not proven. The broker is mandatory in the action path, but kernel/container isolation of the broker process was not independently attacked.
- Independent fresh-host installation is not proven. Installation was verified on the current development host and in a disposable directory.
- The default outer-ring allow policy grants broad authority. It requires a focused security review before sensitive data, financial operations, or autonomous privileged actions are enabled.
- GitMaat evidence is a local SHA-256 hash chain. Without external anchoring or signing, an attacker with sufficient control of the log could rewrite the chain. It is tamper-evident under local assumptions, not tamper-proof.

## Unimplemented scope

- Optional Model Foundry is an interface only. No model training or foundry implementation is included.
- Organizational intake is not implemented.

## Durability and replay

- The RC security test uses in-memory replay stores.
- GitMaat evidence is a local JSONL log. Durable, replicated production evidence storage is not included.

## Fixture credentials

The security smoke uses only literal test fixtures such as test-token, test-machine, test-identity-secret, and an ephemeral local identity secret. These are not production credentials.

## Sandbox

The installer checks Bubblewrap and user namespaces and runs a sandbox smoke. That is a capability check, not a complete multi-tenant security certification.

## Distribution

The RC must not be published to GitHub or used for production until the limitations above are accepted and the remaining production security review is complete.
