import type { AgentRing } from "../governance/index.js";
import { TehutiGuardHttpAdapter, type TehutiGuardHttpConfig } from "../governance/tehuti-guard-http.js";
import type { OrchestratorGuard } from "./orchestrator.js";

export interface HttpOrchestratorGuardConfig extends TehutiGuardHttpConfig {
	/** Ring used for Orchestrator-originated agent execution decisions. */
	ring?: AgentRing;
}

/**
 * Concrete Orchestrator Guard boundary over the existing Tehuti Guard HTTP v1
 * adapter. Endpoint, bearer token, and machine id are explicit; no laboratory
 * defaults or credentials are embedded here.
 */
export function createHttpOrchestratorGuard(config: HttpOrchestratorGuardConfig): OrchestratorGuard {
	const adapter = new TehutiGuardHttpAdapter(config);
	return {
		async authorize(input) {
			const verdict = await adapter.decide({
				actor: {
					agentId: input.actorId,
					ring: config.ring ?? "outer-ring",
				},
				action: input.action,
				resource: input.resource,
				params: { taskId: input.taskId },
				metadata: { task_id: input.taskId },
			});
			return {
				allowed: verdict.decision === "allow",
				reason: verdict.reason,
			};
		},
	};
}
