import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { CodingAgent, K2Agent, MaatOrchestrator } from "../src/maat/orchestrator.js";
import { PrimeAgentSessionRunner } from "../src/maat/prime-agent.js";
import { type EvidenceCandidate, K2Researcher, type ResearchSource } from "../src/maat/researcher.js";
import { createHarness } from "./suite/harness.js";

const allowGuard = {
	async authorize() {
		return { allowed: true, reason: "test approval" };
	},
};

function source(): ResearchSource {
	return {
		id: "real-session-fixture",
		async search(input): Promise<EvidenceCandidate[]> {
			return [
				{
					id: "r1",
					claim: "The documented process has a transition.",
					source: "fixture-doc",
					quote: "A transition was observed in the process.",
					method: input.methodsUsed[0],
					confidence: 0.9,
				},
			];
		},
	};
}

describe("real Prime Agent AgentSession integration", () => {
	it("delegates through the Orchestrator and executes in an actual AgentSession", async () => {
		const harness = await createHarness();
		try {
			harness.setResponses([fauxAssistantMessage("implemented by actual AgentSession")]);
			const researcher = new K2Researcher(source(), {
				guard: { authorize: async () => ({ allowed: true, reason: "research allowed" }) },
			});
			const orchestrator = new MaatOrchestrator({ guard: allowGuard });
			orchestrator.registerAgent(new K2Agent(researcher));
			orchestrator.registerAgent(new CodingAgent(new PrimeAgentSessionRunner(harness.session)));

			const result = await orchestrator.submit({
				request: "Research and implement the documented change",
				kind: "research-and-development",
				methods: ["case-study"],
			});

			expect(result.task.status).toBe("completed");
			expect(result.output).toMatchObject({
				source: "prime-agent-session",
				text: "implemented by actual AgentSession",
			});
			expect(harness.eventsOfType("agent_end").length).toBeGreaterThan(0);
			expect(harness.session.getLastAssistantText()).toBe("implemented by actual AgentSession");
		} finally {
			harness.cleanup();
		}
	});
});
