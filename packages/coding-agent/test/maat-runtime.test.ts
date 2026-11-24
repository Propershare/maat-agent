import { describe, expect, it } from "vitest";
import { AdaptiveIntelligence } from "../src/maat/adaptive-intelligence.js";
import { CodingAgent, K2Agent, MaatOrchestrator, type OrchestratorGuard } from "../src/maat/orchestrator.js";
import { ART_OF_RESEARCH_METHODS } from "../src/maat/research-methods.js";
import { type EvidenceCandidate, K2Researcher, type ResearchSource } from "../src/maat/researcher.js";
import { MaatRuntime } from "../src/maat/runtime.js";

const allowGuard: OrchestratorGuard = {
	authorize: async () => ({ allowed: true, reason: "test approval" }),
};

const denyGuard: OrchestratorGuard = {
	authorize: async () => ({ allowed: false, reason: "test denial" }),
};

function fixtureSource(): ResearchSource {
	return {
		id: "fixture-source",
		async search(input): Promise<EvidenceCandidate[]> {
			return [
				{
					id: "evidence-1",
					claim: "The process has a measurable transition point.",
					source: "fixture-document-a",
					quote: "A transition occurred in the observed process.",
					method: input.methodsUsed[0],
					confidence: 0.9,
				},
				{
					id: "evidence-2",
					claim: "An independent source confirms the transition.",
					source: "fixture-document-b",
					quote: "The transition is independently documented.",
					method: input.methodsUsed[0],
					confidence: 0.8,
				},
			];
		},
	};
}

function researcher(): K2Researcher {
	return new K2Researcher(fixtureSource(), {
		guard: {
			authorize: async () => ({ allowed: true, reason: "research allowed" }),
		},
	});
}

describe("Ma'at three-agent runtime", () => {
	it("preserves all 27 original Art of Research methods", () => {
		expect(ART_OF_RESEARCH_METHODS).toHaveLength(27);
		expect(new Set(ART_OF_RESEARCH_METHODS.map((method) => method.id)).size).toBe(27);
	});

	it("runs K2 structured research with provenance and uncertainty", async () => {
		const result = await researcher().research({
			question: "Compare the documented transition across two sources",
			methods: ["mixed-methods"],
		});
		expect(result.methodsUsed).toEqual(["mixed-methods"]);
		expect(result.findings).toHaveLength(2);
		expect(result.sources).toEqual(["fixture-document-a", "fixture-document-b"]);
		expect(result.uncertainty.level).toBe("low");
		expect(result.provenance.registry).toBe("art-of-research.methods.v1");
	});

	it("rejects a method outside the original registry", async () => {
		await expect(researcher().research({ question: "test", methods: ["invented-method"] })).rejects.toThrow(
			"unknown Art of Research method",
		);
	});

	it("delegates research and development through the Orchestrator", async () => {
		const codingCalls: Array<{ request: string; context: Record<string, unknown> }> = [];
		const orchestrator = new MaatOrchestrator({ guard: allowGuard });
		orchestrator.registerAgent(new K2Agent(researcher()));
		orchestrator.registerAgent(
			new CodingAgent({
				async run(input) {
					codingCalls.push({ request: input.request, context: input.context });
					return { implemented: true, sawResearch: Boolean(input.context.research) };
				},
			}),
		);

		const result = await orchestrator.submit({
			request: "Research and implement the documented change",
			kind: "research-and-development",
			methods: ["case-study"],
		});

		expect(result.task.status).toBe("completed");
		expect(codingCalls).toHaveLength(1);
		expect(codingCalls[0]?.context.research).toMatchObject({ methodsUsed: ["case-study"] });
		expect(result.output).toEqual({ implemented: true, sawResearch: true });
		expect(orchestrator.listTasks()).toHaveLength(1);
	});

	it("fails closed when Tehuti Guard denies a development action", async () => {
		const orchestrator = new MaatOrchestrator({ guard: denyGuard });
		orchestrator.registerAgent(
			new CodingAgent({
				async run() {
					return { shouldNotRun: true };
				},
			}),
		);
		const result = await orchestrator.submit({ request: "implement a change", kind: "development" });
		expect(result.task.status).toBe("denied");
		expect(result.output).toBeUndefined();
		expect(result.task.error).toContain("test denial");
	});

	it("requires Guard authorization for development when no Guard is configured", async () => {
		const orchestrator = new MaatOrchestrator();
		orchestrator.registerAgent(
			new CodingAgent({
				async run() {
					return { shouldNotRun: true };
				},
			}),
		);
		const result = await orchestrator.submit({ request: "implement a change", kind: "development" });
		expect(result.task.status).toBe("denied");
		expect(result.task.error).toContain("Tehuti Guard authorization is required");
	});

	it("tracks outcomes and recommends review before model training", () => {
		const adaptive = new AdaptiveIntelligence();
		for (let index = 0; index < 10; index++) {
			adaptive.record({
				taskId: "task-" + index,
				agentId: "k2-master-researcher",
				kind: "research",
				success: false,
				durationMs: 1000,
				domain: "research",
				timestamp: new Date().toISOString(),
			});
		}
		const recommendation = adaptive.recommendSpecialization({ minSamples: 10 });
		expect(recommendation).toMatchObject({
			agentId: "k2-master-researcher",
			sampleSize: 10,
			requiresApproval: true,
			trainingStarted: false,
		});
		expect(adaptive.summary()).toMatchObject({ total: 10, failures: 10, successRate: 0 });
	});

	it("records a successful cooperative run in the shared runtime", async () => {
		const orchestrator = new MaatOrchestrator({ guard: allowGuard });
		orchestrator.registerAgent(new K2Agent(researcher()));
		orchestrator.registerAgent(
			new CodingAgent({
				async run() {
					return { implemented: true };
				},
			}),
		);
		const adaptive = new AdaptiveIntelligence();
		const runtime = new MaatRuntime(orchestrator, adaptive);
		const result = await runtime.handle({
			request: "research and implement a change",
			kind: "research-and-development",
			methods: ["case-study"],
		});
		expect(result.task.status).toBe("completed");
		expect(adaptive.summary()).toMatchObject({ total: 1, successes: 1, failures: 0 });
	});
});
