import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AgentRing, GovernedToolRequest } from "./index.js";

export interface DelegationGrant {
	actorId: string;
	ring: AgentRing;
	expiresAt: number;
}

export interface ActionBinding {
	actionId: string;
	correlationId: string;
	nonce: string;
	issuedAt: number;
	expiresAt: number;
	argumentHash: string;
	actorId: string;
	delegation?: DelegationGrant[];
	signature?: string;
}

export type UnsignedActionBinding = Omit<ActionBinding, "signature">;

export interface ReplayStore {
	has(key: string): boolean;
	add(key: string): void;
}

export class InMemoryReplayStore implements ReplayStore {
	private readonly seen = new Set<string>();

	has(key: string): boolean {
		return this.seen.has(key);
	}

	add(key: string): void {
		this.seen.add(key);
	}
}

export interface SecurityConfig {
	identitySecret: string;
	maxTtlMs: number;
	clock?: () => number;
	replayStore?: ReplayStore;
}

export interface SecurityValidation {
	ok: boolean;
	reason: string;
}

const RING_RANK: Record<AgentRing, number> = {
	"inner-ring": 1,
	"middle-ring": 2,
	"outer-ring": 3,
};

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
	const record = value as Record<string, unknown>;
	return (
		"{" +
		Object.keys(record)
			.sort()
			.map((key) => JSON.stringify(key) + ":" + stableStringify(record[key]))
			.join(",") +
		"}"
	);
}

export function computeActionHash(toolName: string, resource: string, params: unknown): string {
	return "sha256:" + createHash("sha256").update(stableStringify({ toolName, resource, params })).digest("hex");
}

export function signBinding(binding: UnsignedActionBinding, secret: string): string {
	return createHmac("sha256", secret).update(stableStringify(binding)).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	return a.length === b.length && timingSafeEqual(a, b);
}

function validateDelegation(
	delegation: DelegationGrant[] | undefined,
	actorRing: AgentRing,
	now: number,
): SecurityValidation {
	if (!delegation) return { ok: true, reason: "no delegation" };
	if (delegation.length > 8) return { ok: false, reason: "delegation depth exceeds 8" };
	const seen = new Set<string>();
	for (const grant of delegation) {
		if (!grant.actorId.trim()) return { ok: false, reason: "delegation actorId is required" };
		if (seen.has(grant.actorId)) return { ok: false, reason: "delegation contains duplicate actor" };
		seen.add(grant.actorId);
		if (grant.expiresAt <= now) return { ok: false, reason: "delegation grant expired" };
		if (RING_RANK[grant.ring] > RING_RANK[actorRing])
			return { ok: false, reason: "delegation escalates ring authority" };
	}
	return { ok: true, reason: "delegation valid" };
}

export function validateActionSecurity(
	request: GovernedToolRequest,
	binding: ActionBinding,
	actorRing: AgentRing,
	config: SecurityConfig | undefined,
): SecurityValidation {
	if (!config?.identitySecret) return { ok: false, reason: "identity binding secret is not configured" };
	if (!binding.actionId.trim() || !binding.correlationId.trim() || !binding.nonce.trim()) {
		return { ok: false, reason: "actionId, correlationId, and nonce are required" };
	}
	if (binding.actorId !== request.actorId) return { ok: false, reason: "action actorId does not match request actor" };
	const now = (config.clock ?? (() => Date.now()))();
	if (binding.issuedAt > now) return { ok: false, reason: "authorization issuedAt is in the future" };
	if (binding.expiresAt <= now) return { ok: false, reason: "authorization expired" };
	const ttl = binding.expiresAt - binding.issuedAt;
	if (ttl <= 0 || ttl > config.maxTtlMs) return { ok: false, reason: "authorization TTL is invalid or too long" };
	const expectedHash = computeActionHash(request.toolName, request.resource ?? "", request.params);
	if (binding.argumentHash !== expectedHash) return { ok: false, reason: "action/argument hash mismatch" };
	const { signature: suppliedSignature, ...unsigned } = binding;
	if (!suppliedSignature || !safeEqual(suppliedSignature, signBinding(unsigned, config.identitySecret))) {
		return { ok: false, reason: "identity signature invalid" };
	}
	const delegation = validateDelegation(binding.delegation, actorRing, now);
	if (!delegation.ok) return delegation;
	const replayKey = binding.actorId + ":" + binding.actionId + ":" + binding.nonce;
	const replayStore = config.replayStore;
	if (!replayStore) return { ok: false, reason: "replay store is not configured" };
	if (replayStore.has(replayKey)) return { ok: false, reason: "replay detected" };
	replayStore.add(replayKey);
	return { ok: true, reason: "security binding valid" };
}
