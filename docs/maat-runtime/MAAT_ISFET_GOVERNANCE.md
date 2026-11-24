# Ma'at / Isfet Governance Principles

Status: design requirement and gap analysis for the development release candidate. This document does not add a new policy engine, agent, or runtime capability. Existing authorization and security enforcement remain authoritative.

## 1. Purpose

Ma'at Runtime is intended to support intelligent, accountable, adaptable operations grounded in truth, justice, balance, order, harmony, right conduct, and accountability. Isfet names the failure modes that threaten those principles: falsehood, injustice, disorder, deception, destructive imbalance, abuse of authority, and harmful conduct.

Philosophical terms are not treated as executable policy by themselves. Any future evaluation must translate them into explicit, documented, testable criteria and must integrate with Tehuti Guard, the Ma'at policy engine, the mandatory security broker, and GitMaat evidence. Technical authorization remains mandatory; philosophical evaluation must never replace security enforcement.

## 2. Existing enforceable controls

The current runtime already represents several principles operationally.

| Principle | Existing enforcement | Scope and limit |
| --- | --- | --- |
| Truth | K2 research results include sources, findings, contradictions, uncertainty level and reasons, gaps, and provenance. | Evidence metadata is not independent fact verification. |
| Justice | Agent identity and ring are registered in MaatPolicyEngine; actions are restricted by policy and ring. | There is no affected-party, rights, or interest model. |
| Balance | Guard decisions can be allow, deny, review, quarantine, or escalate. Policy rules can require approval, escalation, or logging. | Risk is supplied through Guard metadata; there is no proportionality calculation. |
| Order | TehutiGuardHttpAdapter requires an explicit endpoint, token, and machine identity. Guard transport/protocol failures are treated as denials. | The local Guard fixture is not a production Guard validation. |
| Accountability | Governed actions produce correlation IDs, action IDs, Guard explanation IDs, and GitMaat receipts. | Receipts are a local hash chain, not an externally anchored transparency log. |
| Right conduct | GovernedActionService requires a broker dependency; invalid signatures and replayed bindings are rejected. | There is no explicit right-conduct rule set beyond policy and security controls. |
| Isfet recognition | Deny, review, quarantine, and escalate decisions exist; bypass attempts can fail closed. | There is no explicit Isfet indicator engine or calibrated deception assessment. |

### Enforced now

- Ring- and action-based policy evaluation.
- Explicit Guard endpoint, bearer credential, and machine identity.
- Fail-closed behavior for Guard and broker outages.
- Signed action bindings with actor, argument hash, nonce, and TTL validation.
- Replay rejection.
- Mandatory broker path for brokered AgentTools.
- GitMaat hash-chained evidence verification.
- Adaptive Intelligence outcome recording without automatic policy or authority changes.

## 3. Five-question decision framework

Future Ma'at/Isfet evaluation should answer these questions and record the answers:

1. Truth: What evidence supports the proposed action, and what remains uncertain?
2. Justice: Whose rights or interests are affected, and are any parties excluded from consideration?
3. Balance: Are expected benefits proportionate to risks, harms, and consequences?
4. Order: Does the action preserve security, operational, legal, and authority boundaries?
5. Accountability: Can the decision, evidence, actor, and consequences be reviewed and explained?

Possible outcomes are allow, deny, escalate, require human review, or quarantine. Insufficient evidence must produce uncertainty or escalation, not a claim of moral certainty.

## 4. Isfet indicator mapping

| Isfet indicator | Existing coverage | Genuine gap |
| --- | --- | --- |
| Unsupported factual claims | K2 sources, confidence, contradictions, uncertainty, gaps | No independent claim verification or calibrated truth score |
| Fabricated evidence | K2 provenance and source IDs | No cryptographic source attestation or contradiction stress test |
| Deceptive reporting | Guard reason, explanation ID, evidence receipts | No deception-specific criteria or audit of narrative consistency |
| Unauthorized access | Policy rings, Guard decisions, broker execution | None for the tested local path; production identity proof remains unverified |
| Concealed actions | Mandatory broker path and GitMaat receipts | Local evidence is not externally anchored |
| Excessive financial risk | Guard risk metadata field | No financial exposure model or threshold policy |
| Unjustified harm | Guard allow/deny/review/escalate | No harm taxonomy, affected-party input, or impact assessment |
| Conflicts of interest | Actor identity and ring | No conflict registry or relationship model |
| Governance bypass attempts | Signed bindings, replay rejection, no direct service path | No dedicated bypass adversary suite beyond the existing security smoke |
| Evidence manipulation | SHA-256 hash chain and receipt verification | No signature or external timestamp anchor |
| Disproportionate actions | Policy escalation and review options | No benefit-risk or proportionality calculation |

## 5. Genuine gaps

1. No explicit truthfulness assessment beyond K2 evidence metadata.
2. No affected-party, rights, or interest model.
3. No proportionality or benefit-risk scoring.
4. No conflict-of-interest registry.
5. No uncertainty thresholds tied to Guard decisions or human review.
6. No Ma'at/Isfet explanation fields in evidence receipts.
7. No human-review queue or approval workflow beyond review and escalate decisions.
8. No adversarial test suite for deception, fabricated evidence, or concealed action.
9. The default outer-ring allow rule is broad and requires review before any philosophical evaluation is added.
10. GitMaat evidence is tamper-evident locally but not externally anchored or signed.
11. Production Guard authentication and host-level broker containment remain unproven.
12. Optional Model Foundry and organizational intake remain unimplemented.

## 6. Integration constraints

- Do not create a competing policy authority.
- Feed evaluations into the existing Guard and GovernedActionService path; do not bypass the broker.
- Do not let a moral label replace technical authorization.
- Do not silently rewrite policy, expand agent authority, or start model training.
- Record uncertainty and human-review outcomes explicitly.
- Preserve the three-agent architecture: Orchestrator, K2, and Coding Agent all remain subject to Tehuti Guard.

## 7. Future acceptance criteria

Any Ma'at/Isfet evaluation capability must eventually demonstrate:

- Explicit policy definitions.
- Evidence-based assessments.
- Consistent decision criteria.
- Appropriate uncertainty handling.
- Human review and escalation.
- Protection against governance bypass.
- Tamper-evident decision records.
- Adversarial testing.
- No unauthorized expansion of agent powers.

A moral label alone is not evidence that an action is safe or appropriate. Acceptance must be based on measurable behavior and auditable records.

## 8. Current release status

The RC remains a controlled development release. This document records requirements and gaps; it does not claim that Ma'at/Isfet evaluation is implemented. No production Guard, Hermes, installed maat, or production service was modified.
