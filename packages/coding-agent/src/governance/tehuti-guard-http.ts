import { randomUUID } from "node:crypto";
import type { GuardRequest, GuardVerdict, GuardWireDecision, TehutiGuard } from "./index.js";

export interface TehutiGuardHttpConfig {
	/** Full decision endpoint URL, for example http://127.0.0.1:8013. */
	endpoint: string;
	/** Bearer credential. Never hardcode or log this value. */
	token: string;
	/** Machine identity consumed by live Guard/Sentinel. */
	machineId: string;
	timeoutMs?: number;
	expectedPolicyVersion?: string;
}

const DECISIONS: readonly GuardWireDecision[] = ["allow", "deny", "review", "quarantine", "escalate"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("Guard response missing valid " + field);
	}
	return value;
}

function stringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
		throw new Error("Guard response missing valid " + field);
	}
	return value;
}

/**
 * Live Tehuti Guard v1 HTTP adapter.
 *
 * Authorization is explicit: endpoint, bearer token, and machine id are
 * required. A valid action-bound allow is the only decision that authorizes
 * tool execution; transport/config/protocol failures throw and are treated as
 * denials by GovernedToolRuntime.
 *
 * This adapter does not implement replay caches, TTL enforcement, delegation,
 * or cryptographic identity binding. Those must be enforced by the eventual
 * privileged execution boundary or added explicitly with tests.
 */
export class TehutiGuardHttpAdapter implements TehutiGuard {
	private readonly endpoint: string;
	private readonly token: string;
	private readonly machineId: string;
	private readonly timeoutMs: number;

	constructor(private readonly config: TehutiGuardHttpConfig) {
		const endpoint = config.endpoint.trim();
		const token = config.token.trim();
		const machineId = config.machineId.trim();
		if (!endpoint || !token || !machineId) {
			throw new Error("Tehuti Guard requires explicit endpoint, token, and machineId");
		}
		if (!/^https?:\/\//i.test(endpoint)) {
			throw new Error("Tehuti Guard endpoint must be an http(s) URL");
		}
		this.endpoint = endpoint.replace(/\/+$/, "");
		this.token = token;
		this.machineId = machineId;
		this.timeoutMs = config.timeoutMs ?? 5000;
	}

	async decide(request: GuardRequest): Promise<GuardVerdict> {
		const correlationId = request.correlationId ?? randomUUID();
		const actionId = request.actionId ?? randomUUID();
		const toolName = request.action.startsWith("tool.") ? request.action.slice(5) : request.action;
		const metadata = {
			action_id: actionId,
			correlation_id: correlationId,
			tool_name: toolName,
			argument_hash: request.argumentHash,
			policy_version: request.policyVersion,
			actor_ring: request.actor.ring,
			...request.metadata,
		};
		const body = {
			machine_id: this.machineId,
			actor: { id: request.actor.agentId, role: request.actor.ring },
			action: {
				kind: "execute",
				resource: request.resource || request.action,
				risk: String(request.metadata?.risk ?? "medium"),
				metadata,
			},
			correlation_id: correlationId,
		};

		const response = await fetch(this.endpoint + "/decision", {
			method: "POST",
			headers: {
				Authorization: "Bearer " + this.token,
				"Content-Type": "application/json",
				"X-Correlation-ID": correlationId,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		if (response.status !== 200) {
			throw new Error("Tehuti Guard HTTP status " + response.status);
		}

		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			throw new Error("Tehuti Guard returned malformed JSON");
		}
		if (!isRecord(payload)) throw new Error("Tehuti Guard returned a non-object response");

		const decision = payload.decision;
		if (typeof decision !== "string" || !DECISIONS.includes(decision as GuardWireDecision)) {
			throw new Error("Tehuti Guard returned an invalid decision");
		}
		const responseCorrelation = requiredString(payload.correlation_id, "correlation_id");
		if (responseCorrelation !== correlationId) {
			throw new Error("Tehuti Guard response correlation_id mismatch");
		}
		const policyVersion = requiredString(payload.policy_version, "policy_version");
		if (this.config.expectedPolicyVersion && policyVersion !== this.config.expectedPolicyVersion) {
			throw new Error("Tehuti Guard policy_version mismatch");
		}
		const reason = requiredString(payload.reason, "reason");
		const severity = requiredString(payload.severity, "severity");
		const matchedRules = stringArray(payload.matched_rules, "matched_rules");
		const explanationId = requiredString(payload.explanation_id, "explanation_id");
		const blockingActions =
			payload.blocking_actions === undefined ? [] : stringArray(payload.blocking_actions, "blocking_actions");

		return {
			decision: decision as GuardWireDecision,
			reason,
			policyVersion,
			correlationId: responseCorrelation,
			explanationId,
			matchedRules,
			severity,
			blockingActions,
			evidence: isRecord(payload.evidence) ? payload.evidence : undefined,
		};
	}
}
