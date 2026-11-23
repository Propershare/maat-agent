// biome-ignore-all lint/suspicious/noThenProperty: the Ma'at policy schema defines the rule outcome as "then".
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type ActionBinding, type SecurityConfig, validateActionSecurity } from "./security.js";

export type AgentRing = "inner-ring" | "middle-ring" | "outer-ring";

export interface AgentIdentity {
	agentId: string;
	ring: AgentRing;
	displayName?: string;
}

export interface MaatPolicyRule {
	id: string;
	when: Record<string, string | string[]>;
	then: "allow" | "deny" | "escalate" | "require_approval" | "log";
	reason?: string;
}

export interface MaatPolicyDocument {
	id: string;
	name: string;
	version: string;
	description?: string;
	inherits?: string[];
	rules: MaatPolicyRule[];
}

export interface MaatPolicyDecision {
	allowed: boolean;
	reason: string;
	policyId?: string;
	escalate?: boolean;
	requiresApproval?: boolean;
	action: string;
	resource: string;
	agentId: string;
	ring: AgentRing;
}

export type GuardWireDecision = "allow" | "deny" | "review" | "quarantine" | "escalate";

export interface GuardRequest {
	actor: AgentIdentity;
	action: string;
	resource: string;
	params: unknown;
	actionId?: string;
	correlationId?: string;
	argumentHash?: string;
	policyVersion?: string;
	metadata?: Record<string, unknown>;
}

export interface GuardVerdict {
	decision: GuardWireDecision;
	reason: string;
	policyId?: string;
	policyVersion?: string;
	correlationId?: string;
	explanationId?: string;
	matchedRules?: string[];
	severity?: string;
	blockingActions?: string[];
	evidence?: Record<string, unknown>;
}

export interface EvidenceInput {
	actorId: string;
	actorRing: AgentRing;
	action: string;
	resource: string;
	toolName: string;
	decision: "allow" | "deny";
	outcome: "authorized" | "denied" | "executed" | "failed";
	reason: string;
	actionId?: string;
	correlationId?: string;
	policyVersion?: string;
	argumentHash?: string;
	guardExplanationId?: string;
	nonce?: string;
	expiresAt?: number;
}

export interface EvidenceReceipt extends EvidenceInput {
	version: "maat-gitmaat-receipt:v1";
	sequence: number;
	timestamp: string;
	previousHash: string;
	hash: string;
}

export interface GovernedToolRequest {
	actorId: string;
	toolName: string;
	params: unknown;
	resource?: string;
	actionId?: string;
	correlationId?: string;
	argumentHash?: string;
	policyVersion?: string;
	sessionId?: string;
	security?: ActionBinding;
}

export type ToolHandler = (params: unknown) => Promise<unknown>;

export const MAAT_DEFAULT_POLICY: MaatPolicyDocument = {
	id: "maat-default-v1",
	name: "MAAT Default Policy",
	version: "1",
	description: "The constitutional default. Fail-closed. Three-Ring.",
	rules: [
		{
			id: "default-deny-unknown",
			when: { ring: "inner-ring", action: "execute" },
			then: "deny",
			reason: "Inner-ring agents cannot execute",
		},
		{
			id: "default-deny-delete-constitutional",
			when: { action: "memory.delete", resource: "constitutional*" },
			then: "deny",
			reason: "Constitutional memories cannot be deleted",
		},
		{
			id: "default-escalate-unknown-tool",
			when: { ring: "inner-ring", action: "tool.*" },
			then: "escalate",
			reason: "Inner-ring tool use requires approval",
		},
		{
			id: "default-log-all-memory-writes",
			when: { action: "memory.write" },
			then: "log",
			reason: "All memory writes are auditable",
		},
		{
			id: "default-outer-allow",
			when: { ring: "outer-ring" },
			then: "allow",
			reason: "Outer-ring has full authority",
		},
	],
};

const RING_ACTIONS: Record<AgentRing, readonly string[]> = {
	"outer-ring": ["read", "write", "execute", "propose", "memory.write", "memory.read", "tool.*", "task.*"],
	"middle-ring": ["read", "propose", "memory.read", "memory.write"],
	"inner-ring": ["read", "memory.read"],
};

export class MaatPolicyEngine {
	private readonly policies: MaatPolicyDocument[] = [];
	private readonly identities = new Map<string, AgentIdentity>();

	constructor(policies: MaatPolicyDocument[] = []) {
		for (const policy of policies) this.loadPolicy(policy);
	}

	loadPolicy(policy: MaatPolicyDocument): void {
		this.policies.push(policy);
	}

	registerAgent(agentId: string, ring: AgentRing, displayName?: string): AgentIdentity {
		const identity: AgentIdentity = { agentId, ring, displayName };
		this.identities.set(agentId, identity);
		return identity;
	}

	getIdentity(agentId: string): AgentIdentity {
		return this.identities.get(agentId) ?? { agentId, ring: "inner-ring" };
	}

	evaluate(agentId: string, action: string, resource = ""): MaatPolicyDecision {
		const ring = this.getIdentity(agentId).ring;
		for (const policy of this.policies) {
			for (const rule of policy.rules) {
				if (!this.matches(rule, { agent_id: agentId, action, resource, ring })) continue;
				const reason = rule.reason ?? "Rule " + rule.id + " matched";
				if (rule.then === "allow") {
					return { allowed: true, reason, policyId: policy.id, action, resource, agentId, ring };
				}
				if (rule.then === "deny") {
					return { allowed: false, reason, policyId: policy.id, action, resource, agentId, ring };
				}
				if (rule.then === "require_approval") {
					return {
						allowed: false,
						reason,
						policyId: policy.id,
						requiresApproval: true,
						action,
						resource,
						agentId,
						ring,
					};
				}
				if (rule.then === "escalate") {
					return {
						allowed: false,
						reason: "Escalation required: " + reason,
						policyId: policy.id,
						escalate: true,
						action,
						resource,
						agentId,
						ring,
					};
				}
			}
		}

		const allowedActions = RING_ACTIONS[ring];
		const allowed = allowedActions.some((candidate) =>
			candidate.endsWith("*") ? action.startsWith(candidate.slice(0, -1)) : action === candidate,
		);
		return {
			allowed,
			reason: ring + " " + (allowed ? "can" : "cannot") + " perform " + action + " (default rule)",
			action,
			resource,
			agentId,
			ring,
		};
	}

	private matches(rule: MaatPolicyRule, context: Record<string, string>): boolean {
		for (const [key, expected] of Object.entries(rule.when)) {
			const actual = context[key] ?? "";
			const values = Array.isArray(expected) ? expected : [expected];
			const matched = values.some((candidate) =>
				candidate.endsWith("*") ? actual.startsWith(candidate.slice(0, -1)) : actual === candidate,
			);
			if (!matched) return false;
		}
		return true;
	}
}

export interface TehutiGuard {
	decide(request: GuardRequest): Promise<GuardVerdict>;
}

/**
 * Local deterministic Tehuti Guard adapter.
 *
 * This is the local pre-check layer from the Guard contract. It is not
 * Sentinel and does not claim to make high-impact external decisions.
 */
export class PolicyGuard implements TehutiGuard {
	constructor(private readonly policy: MaatPolicyEngine) {}

	async decide(request: GuardRequest): Promise<GuardVerdict> {
		const decision = this.policy.evaluate(request.actor.agentId, request.action, request.resource);
		if (decision.allowed) {
			return { decision: "allow", reason: decision.reason, policyId: decision.policyId };
		}
		if (decision.requiresApproval) {
			return { decision: "review", reason: decision.reason, policyId: decision.policyId };
		}
		if (decision.escalate) {
			return { decision: "escalate", reason: decision.reason, policyId: decision.policyId };
		}
		return { decision: "deny", reason: decision.reason, policyId: decision.policyId };
	}
}

export interface EvidenceVerification {
	valid: boolean;
	records: number;
	brokenAt?: number;
}

const GENESIS_HASH = "GENESIS";
const EVIDENCE_VERSION = "maat-gitmaat-receipt:v1" as const;

function hashPayload(payload: Omit<EvidenceReceipt, "hash">): string {
	return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class GitMaatEvidenceLog {
	private loaded = false;
	private records: EvidenceReceipt[] = [];

	constructor(private readonly path: string) {}

	async append(input: EvidenceInput): Promise<EvidenceReceipt> {
		await this.ensureLoaded();
		const previous = this.records.at(-1);
		const payload: Omit<EvidenceReceipt, "hash"> = {
			version: EVIDENCE_VERSION,
			sequence: this.records.length + 1,
			timestamp: new Date().toISOString(),
			...input,
			previousHash: previous?.hash ?? GENESIS_HASH,
		};
		const receipt: EvidenceReceipt = { ...payload, hash: hashPayload(payload) };
		await mkdir(dirname(this.path), { recursive: true });
		await appendFile(this.path, JSON.stringify(receipt) + "\n", "utf8");
		this.records.push(receipt);
		return receipt;
	}

	async verify(): Promise<EvidenceVerification> {
		await this.ensureLoaded();
		let previousHash = GENESIS_HASH;
		for (const [index, record] of this.records.entries()) {
			const { hash, ...payload } = record;
			if (payload.previousHash !== previousHash || hashPayload(payload) !== hash) {
				return { valid: false, records: this.records.length, brokenAt: index + 1 };
			}
			previousHash = hash;
		}
		return { valid: true, records: this.records.length };
	}

	async all(): Promise<EvidenceReceipt[]> {
		await this.ensureLoaded();
		return [...this.records];
	}

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const content = await readFile(this.path, "utf8");
			this.records = content
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.map((line) => JSON.parse(line) as EvidenceReceipt);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

export interface GovernedToolResult {
	ok: boolean;
	denied: boolean;
	reason: string;
	policy: MaatPolicyDecision;
	guard: GuardVerdict;
	receipt: EvidenceReceipt;
	result?: unknown;
	error?: string;
}

export interface AuthorizedAction {
	request: GovernedToolRequest;
	allowed: boolean;
	reason: string;
	policy: MaatPolicyDecision;
	guard: GuardVerdict;
	receipt?: EvidenceReceipt;
}

export class GovernedToolRuntime {
	constructor(
		private readonly options: {
			policy: MaatPolicyEngine;
			guard: TehutiGuard;
			evidence: GitMaatEvidenceLog;
			tools: Map<string, ToolHandler>;
			security?: SecurityConfig;
		},
	) {}

	async authorize(request: GovernedToolRequest): Promise<AuthorizedAction> {
		const actor = this.options.policy.getIdentity(request.actorId);
		const action = "tool." + request.toolName;
		const resource = request.resource ?? "";
		const binding = request.security;
		if (binding) {
			const validation = validateActionSecurity(request, binding, actor.ring, this.options.security);
			if (!validation.ok) {
				const deniedPolicy = this.options.policy.evaluate(request.actorId, action, resource);
				const deniedGuard: GuardVerdict = { decision: "deny", reason: validation.reason };
				const receipt = await this.options.evidence.append({
					actorId: actor.agentId,
					actorRing: actor.ring,
					action,
					resource,
					toolName: request.toolName,
					decision: "deny",
					outcome: "denied",
					reason: validation.reason,
					actionId: binding.actionId,
					correlationId: binding.correlationId,
					argumentHash: binding.argumentHash,
					nonce: binding.nonce,
					expiresAt: binding.expiresAt,
				});
				return {
					request,
					allowed: false,
					reason: validation.reason,
					policy: deniedPolicy,
					guard: deniedGuard,
					receipt,
				};
			}
		}
		const actionId = binding?.actionId ?? request.actionId ?? randomUUID();
		const correlationId = binding?.correlationId ?? request.correlationId ?? randomUUID();
		const argumentHash = binding?.argumentHash ?? request.argumentHash;
		const policy = this.options.policy.evaluate(request.actorId, action, resource);
		let guard: GuardVerdict;
		try {
			guard = await this.options.guard.decide({
				actor,
				action,
				resource,
				params: request.params,
				actionId,
				correlationId,
				argumentHash,
				policyVersion: request.policyVersion,
				metadata: {
					sessionId: request.sessionId,
					nonce: binding?.nonce,
					expiresAt: binding?.expiresAt,
					delegation: binding?.delegation,
				},
			});
		} catch (error) {
			guard = {
				decision: "deny",
				reason: "Governance guard unavailable: " + (error instanceof Error ? error.message : String(error)),
			};
		}
		const allowed = policy.allowed && guard.decision === "allow";
		if (allowed) {
			return { request, allowed: true, reason: guard.reason, policy, guard };
		}
		const receipt = await this.options.evidence.append({
			actorId: actor.agentId,
			actorRing: actor.ring,
			action,
			resource,
			toolName: request.toolName,
			decision: "deny",
			outcome: "denied",
			reason: guard.reason,
			actionId,
			correlationId,
			policyVersion: guard.policyVersion ?? request.policyVersion,
			argumentHash,
			guardExplanationId: guard.explanationId,
			nonce: binding?.nonce,
			expiresAt: binding?.expiresAt,
		});
		return { request, allowed: false, reason: guard.reason, policy, guard, receipt };
	}

	async complete(authorized: AuthorizedAction, _result: unknown, isError = false): Promise<EvidenceReceipt> {
		const actor = this.options.policy.getIdentity(authorized.request.actorId);
		return this.options.evidence.append({
			actorId: actor.agentId,
			actorRing: actor.ring,
			action: "tool." + authorized.request.toolName,
			resource: authorized.request.resource ?? "",
			toolName: authorized.request.toolName,
			decision: "allow",
			outcome: isError ? "failed" : "executed",
			reason: isError ? "Tool execution failed after authorization" : authorized.reason,
			actionId: authorized.request.security?.actionId ?? authorized.request.actionId,
			correlationId: authorized.request.security?.correlationId ?? authorized.request.correlationId,
			policyVersion: authorized.guard.policyVersion ?? authorized.request.policyVersion,
			argumentHash: authorized.request.security?.argumentHash ?? authorized.request.argumentHash,
			guardExplanationId: authorized.guard.explanationId,
			nonce: authorized.request.security?.nonce,
			expiresAt: authorized.request.security?.expiresAt,
		});
	}

	async execute(request: GovernedToolRequest): Promise<GovernedToolResult> {
		const authorized = await this.authorize(request);
		if (!authorized.allowed) {
			return {
				ok: false,
				denied: true,
				reason: authorized.reason,
				policy: authorized.policy,
				guard: authorized.guard,
				receipt: authorized.receipt as EvidenceReceipt,
			};
		}
		const handler = this.options.tools.get(request.toolName);
		if (!handler) {
			const receipt = await this.options.evidence.append({
				actorId: request.actorId,
				actorRing: this.options.policy.getIdentity(request.actorId).ring,
				action: "tool." + request.toolName,
				resource: request.resource ?? "",
				toolName: request.toolName,
				decision: "deny",
				outcome: "denied",
				reason: "No governed tool implementation registered",
				actionId: request.actionId,
				correlationId: request.correlationId,
				policyVersion: request.policyVersion,
				argumentHash: request.argumentHash,
			});
			return {
				ok: false,
				denied: true,
				reason: "No governed tool implementation registered",
				policy: authorized.policy,
				guard: authorized.guard,
				receipt,
			};
		}
		try {
			const result = await handler(request.params);
			const receipt = await this.complete(authorized, result, false);
			return {
				ok: true,
				denied: false,
				reason: authorized.reason,
				policy: authorized.policy,
				guard: authorized.guard,
				receipt,
				result,
			};
		} catch (error) {
			const receipt = await this.complete(authorized, error, true);
			return {
				ok: false,
				denied: false,
				reason: error instanceof Error ? error.message : String(error),
				policy: authorized.policy,
				guard: authorized.guard,
				receipt,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}
}

export interface GovernanceHooks {
	beforeToolCall(input: {
		toolCall: { id: string; name: string };
		args: unknown;
	}): Promise<{ block: true; reason: string } | undefined>;
	afterToolCall(input: { toolCall: { id: string; name: string }; result: unknown; isError: boolean }): Promise<void>;
}

export function createGovernanceHooks(runtime: GovernedToolRuntime, actorId: string): GovernanceHooks {
	const pending = new Map<string, AuthorizedAction>();
	return {
		async beforeToolCall({ toolCall, args }) {
			const authorized = await runtime.authorize({
				actorId,
				toolName: toolCall.name,
				params: args,
			});
			if (!authorized.allowed) {
				return { block: true, reason: authorized.reason };
			}
			pending.set(toolCall.id, authorized);
		},
		async afterToolCall({ toolCall, result, isError }) {
			const authorized = pending.get(toolCall.id);
			if (!authorized) return;
			await runtime.complete(authorized, result, isError);
			pending.delete(toolCall.id);
		},
	};
}
