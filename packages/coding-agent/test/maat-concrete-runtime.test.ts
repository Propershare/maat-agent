import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createHttpOrchestratorGuard } from "../src/maat/guard-http.js";
import { CodingAgent, K2Agent, MaatOrchestrator } from "../src/maat/orchestrator.js";
import { PrimeAgentSessionRunner } from "../src/maat/prime-agent.js";
import { type EvidenceCandidate, K2Researcher, type ResearchSource } from "../src/maat/researcher.js";

class FakePrimeSession {
	readonly prompts: string[] = [];
	result = "implemented by prime agent";

	async promptAndWait(text: string): Promise<void> {
		this.prompts.push(text);
	}

	getLastAssistantText(): string {
		return this.result;
	}
}

function researchSource(): ResearchSource {
	return {
		id: "concrete-fixture-source",
		async search(input): Promise<EvidenceCandidate[]> {
			return [
				{
					id: "e1",
					claim: "A documented process changed.",
					source: "fixture-a",
					quote: "The process changed at the recorded transition.",
					method: input.methodsUsed[0],
					confidence: 0.9,
				},
				{
					id: "e2",
					claim: "A second source confirms the change.",
					source: "fixture-b",
					quote: "Independent documentation confirms the transition.",
					method: input.methodsUsed[0],
					confidence: 0.8,
				},
			];
		},
	};
}

async function startGuard(decision: "allow" | "deny"): Promise<{
	endpoint: string;
	setDecision(next: "allow" | "deny"): void;
	close(): Promise<void>;
}> {
	let currentDecision = decision;
	const server = createServer(async (request, response) => {
		let raw = "";
		for await (const chunk of request) raw += String(chunk);
		const body = JSON.parse(raw) as { correlation_id?: string };
		response.writeHead(200, { "content-type": "application/json" });
		response.end(
			JSON.stringify({
				decision: currentDecision,
				correlation_id: body.correlation_id,
				policy_version: "test-policy-v1",
				reason: currentDecision === "allow" ? "allowed by test Guard" : "denied by test Guard",
				severity: "low",
				matched_rules: ["test-rule"],
				explanation_id: "test-explanation",
			}),
		);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("test Guard did not bind a TCP port");
	return {
		endpoint: "http://127.0.0.1:" + address.port,
		setDecision(next) {
			currentDecision = next;
		},
		async close() {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

describe("Concrete Prime Agent and live Tehuti Guard integration", () => {
	it("runs Orchestrator -> K2 -> Prime Agent session under an HTTP Guard", async () => {
		const guardServer = await startGuard("allow");
		try {
			const session = new FakePrimeSession();
			const orchestrator = new MaatOrchestrator({
				guard: createHttpOrchestratorGuard({
					endpoint: guardServer.endpoint,
					token: "test-token",
					machineId: "test-machine",
					timeoutMs: 1000,
				}),
			});
			orchestrator.registerAgent(
				new K2Agent(
					new K2Researcher(researchSource(), {
						guard: { authorize: async () => ({ allowed: true, reason: "research allowed" }) },
					}),
				),
			);
			orchestrator.registerAgent(new CodingAgent(new PrimeAgentSessionRunner(session)));

			const result = await orchestrator.submit({
				request: "Research and implement the documented change",
				kind: "research-and-development",
				methods: ["mixed-methods"],
			});

			expect(result.task.status).toBe("completed");
			expect(result.output).toMatchObject({ source: "prime-agent-session", text: "implemented by prime agent" });
			expect(session.prompts).toHaveLength(1);
			expect(session.prompts[0]).toContain("Research findings:");
			expect(session.prompts[0]).toContain("fixture-a");
		} finally {
			await guardServer.close();
		}
	});

	it("runs the Coding Agent independently and fails closed when Guard denies", async () => {
		const guardServer = await startGuard("deny");
		try {
			const session = new FakePrimeSession();
			const orchestrator = new MaatOrchestrator({
				guard: createHttpOrchestratorGuard({
					endpoint: guardServer.endpoint,
					token: "test-token",
					machineId: "test-machine",
					timeoutMs: 1000,
				}),
			});
			orchestrator.registerAgent(new CodingAgent(new PrimeAgentSessionRunner(session)));

			const denied = await orchestrator.submit({ request: "implement a change", kind: "development" });
			expect(denied.task.status).toBe("denied");
			expect(session.prompts).toHaveLength(0);

			guardServer.setDecision("allow");
			const allowed = await orchestrator.submit({ request: "implement a change", kind: "development" });
			expect(allowed.task.status).toBe("completed");
			expect(session.prompts).toHaveLength(1);
			expect(allowed.output).toMatchObject({ text: "implemented by prime agent" });
		} finally {
			await guardServer.close();
		}
	});
});
