export interface OutcomeRecord {
	taskId: string;
	agentId: string;
	kind: string;
	success: boolean;
	durationMs: number;
	error?: string;
	domain?: string;
	timestamp: string;
}

export interface AdaptiveMetrics {
	total: number;
	successes: number;
	failures: number;
	successRate: number;
	averageLatencyMs: number;
	byAgent: Record<string, { total: number; failures: number; averageLatencyMs: number }>;
}

export interface SpecializationRecommendation {
	agentId: string;
	kind: string;
	domain?: string;
	sampleSize: number;
	failureRate: number;
	averageLatencyMs: number;
	recommendation: "review-prompts-retrieval-routing-tools-before-model-training";
	requiresApproval: true;
	trainingStarted: false;
	reasons: readonly string[];
}

export interface ModelFoundry {
	propose(input: { agentId: string; reason: string; evidence: AdaptiveMetrics }): Promise<unknown>;
}

export interface RecommendationOptions {
	minSamples?: number;
	failureRateThreshold?: number;
	latencyThresholdMs?: number;
}

export class AdaptiveIntelligence {
	private readonly outcomes: OutcomeRecord[] = [];

	record(outcome: OutcomeRecord): void {
		this.outcomes.push(outcome);
	}

	summary(): AdaptiveMetrics {
		const byAgent: AdaptiveMetrics["byAgent"] = {};
		let successes = 0;
		let totalLatency = 0;
		for (const outcome of this.outcomes) {
			if (outcome.success) successes++;
			totalLatency += outcome.durationMs;
			let agent = byAgent[outcome.agentId];
			if (!agent) {
				agent = { total: 0, failures: 0, averageLatencyMs: 0 };
				byAgent[outcome.agentId] = agent;
			}
			agent.total++;
			agent.averageLatencyMs += outcome.durationMs;
			if (!outcome.success) agent.failures++;
		}
		for (const agent of Object.values(byAgent)) {
			agent.averageLatencyMs = agent.total > 0 ? Math.round(agent.averageLatencyMs / agent.total) : 0;
		}
		return {
			total: this.outcomes.length,
			successes,
			failures: this.outcomes.length - successes,
			successRate: this.outcomes.length > 0 ? successes / this.outcomes.length : 1,
			averageLatencyMs: this.outcomes.length > 0 ? Math.round(totalLatency / this.outcomes.length) : 0,
			byAgent,
		};
	}

	recommendSpecialization(options: RecommendationOptions = {}): SpecializationRecommendation | undefined {
		const minSamples = options.minSamples ?? 10;
		const failureRateThreshold = options.failureRateThreshold ?? 0.3;
		const latencyThresholdMs = options.latencyThresholdMs ?? 30_000;
		const groups = new Map<string, OutcomeRecord[]>();
		for (const outcome of this.outcomes) {
			const key = [outcome.agentId, outcome.kind, outcome.domain ?? ""].join("|");
			const group = groups.get(key) ?? [];
			group.push(outcome);
			groups.set(key, group);
		}
		for (const group of groups.values()) {
			if (group.length < minSamples) continue;
			const failures = group.filter((outcome) => !outcome.success).length;
			const failureRate = failures / group.length;
			const averageLatencyMs = Math.round(
				group.reduce((sum, outcome) => sum + outcome.durationMs, 0) / group.length,
			);
			if (failureRate < failureRateThreshold && averageLatencyMs < latencyThresholdMs) continue;
			const first = group[0]!;
			const reasons: string[] = [];
			if (failureRate >= failureRateThreshold) reasons.push("failure rate exceeds review threshold");
			if (averageLatencyMs >= latencyThresholdMs) reasons.push("latency exceeds review threshold");
			return {
				agentId: first.agentId,
				kind: first.kind,
				domain: first.domain,
				sampleSize: group.length,
				failureRate,
				averageLatencyMs,
				recommendation: "review-prompts-retrieval-routing-tools-before-model-training",
				requiresApproval: true,
				trainingStarted: false,
				reasons,
			};
		}
		return undefined;
	}
}
