import type { GuardWireDecision } from "./index.js";
import { type ActionBinding, type ReplayStore, type SecurityConfig, validateActionSecurity } from "./security.js";

export interface BrokerRequest {
	actorId: string;
	actorRing: "inner-ring" | "middle-ring" | "outer-ring";
	toolName: string;
	resource?: string;
	params: unknown;
	actionId: string;
	correlationId: string;
	binding: ActionBinding;
	guardDecision: GuardWireDecision;
}

export interface BrokerResult {
	ok: boolean;
	denied: boolean;
	executed: boolean;
	reason: string;
	result?: unknown;
}

export interface BrokerConfig extends SecurityConfig {
	replayStore: ReplayStore;
}

/**
 * Isolated, non-production side-effect broker prototype.
 *
 * It validates a signed canonical action envelope and a Guard allow decision
 * before invoking one mock privileged operation. It is not an OS boundary: a
 * caller with the same shell/user can still invoke a privileged function
 * directly.
 */
export class SideEffectBroker {
	constructor(private readonly config: BrokerConfig) {}

	async execute(request: BrokerRequest, operation: () => Promise<unknown> | unknown): Promise<BrokerResult> {
		if (request.guardDecision !== "allow") {
			return { ok: false, denied: true, executed: false, reason: "Guard decision is not allow" };
		}
		if (request.actionId !== request.binding.actionId || request.correlationId !== request.binding.correlationId) {
			return { ok: false, denied: true, executed: false, reason: "action/correlation binding mismatch" };
		}
		const validation = validateActionSecurity(
			{
				actorId: request.actorId,
				toolName: request.toolName,
				resource: request.resource,
				params: request.params,
				security: request.binding,
			},
			request.binding,
			request.actorRing,
			this.config,
		);
		if (!validation.ok) {
			return { ok: false, denied: true, executed: false, reason: validation.reason };
		}
		try {
			const result = await operation();
			return { ok: true, denied: false, executed: true, reason: "executed once", result };
		} catch (error) {
			return {
				ok: false,
				denied: false,
				executed: false,
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	}
}
