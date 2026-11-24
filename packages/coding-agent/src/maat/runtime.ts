import type { AdaptiveIntelligence, ModelFoundry } from "./adaptive-intelligence.js";
import type { MaatOrchestrator, OrchestratorRequest, OrchestratorResult } from "./orchestrator.js";

export class MaatRuntime {
	constructor(
		private readonly orchestrator: MaatOrchestrator,
		private readonly adaptive: AdaptiveIntelligence,
		private readonly modelFoundry?: ModelFoundry,
	) {}

	async handle(request: OrchestratorRequest): Promise<OrchestratorResult> {
		const startedAt = Date.now();
		try {
			const result = await this.orchestrator.submit(request);
			const { task } = result;
			this.adaptive.record({
				taskId: task.id,
				agentId: task.assignedAgentId ?? "maat-orchestrator",
				kind: task.kind,
				success: task.status === "completed",
				durationMs: Date.now() - startedAt,
				error: task.error,
				domain: typeof task.context.domain === "string" ? task.context.domain : undefined,
				timestamp: new Date().toISOString(),
			});
			return result;
		} catch (error) {
			this.adaptive.record({
				taskId: "unassigned",
				agentId: "maat-orchestrator",
				kind: request.kind ?? "unknown",
				success: false,
				durationMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message : String(error),
				domain: typeof request.context?.domain === "string" ? request.context.domain : undefined,
				timestamp: new Date().toISOString(),
			});
			throw error;
		}
	}

	getOptionalModelFoundry(): ModelFoundry | undefined {
		return this.modelFoundry;
	}
}
