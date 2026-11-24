import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { SideEffectBroker } from "../src/governance/broker.js";
import {
	GitMaatEvidenceLog,
	GovernedToolRuntime,
	MAAT_DEFAULT_POLICY,
	MaatPolicyEngine,
} from "../src/governance/index.js";
import { type ActionBinding, computeActionHash, InMemoryReplayStore, signBinding } from "../src/governance/security.js";
import { TehutiGuardHttpAdapter } from "../src/governance/tehuti-guard-http.js";
import { createBrokerAgentTool } from "../src/maat/broker-tool.js";
import type { BrokerClient } from "../src/maat/governed-actions.js";
import { GovernedActionService } from "../src/maat/governed-actions.js";
import { CodingAgent, MaatOrchestrator } from "../src/maat/orchestrator.js";
import { PrimeAgentSessionRunner } from "../src/maat/prime-agent.js";
import { createHarness } from "./suite/harness.js";

const SECRET = "***";
const allowOrchestrator = {
	async authorize() {
		return { allowed: true, reason: "orchestrator allowed" };
	},
};

async function startGuard(decision: "allow" | "deny") {
	let current: "allow" | "deny" = decision;
	const server = createServer(async (request, response) => {
		let raw = "";
		for await (const chunk of request) raw += String(chunk);
		const body = JSON.parse(raw) as { correlation_id?: string };
		response.writeHead(200, { "content-type": "application/json" });
		response.end(
			JSON.stringify({
				decision: current,
				correlation_id: body.correlation_id,
				policy_version: "test-policy",
				reason: current === "allow" ? "test allow" : "test deny",
				severity: "low",
				matched_rules: [],
				explanation_id: "test-explanation",
			}),
		);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Guard test server did not bind");
	return {
		endpoint: "http://127.0.0.1:" + address.port,
		setDecision(next: "allow" | "deny") {
			current = next;
		},
		async close() {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

function makeService(endpoint: string, root: string) {
	const target = join(root, "broker-session-output.txt");
	const policy = new MaatPolicyEngine([MAAT_DEFAULT_POLICY]);
	policy.registerAgent("outer-agent", "outer-ring");
	const evidence = new GitMaatEvidenceLog(join(root, "receipts.jsonl"));
	const runtime = new GovernedToolRuntime({
		policy,
		guard: new TehutiGuardHttpAdapter({ endpoint, token: "test-token", machineId: "test-machine", timeoutMs: 1000 }),
		evidence,
		tools: new Map(),
		security: { identitySecret: SECRET, maxTtlMs: 10_000, replayStore: new InMemoryReplayStore() },
	});
	const handler = vi.fn(async () => {
		writeFileSync(target, "executed");
		return { target };
	});
	const broker = new SideEffectBroker({
		identitySecret: SECRET,
		maxTtlMs: 10_000,
		replayStore: new InMemoryReplayStore(),
	});
	const client: BrokerClient = {
		async execute(request) {
			return await broker.execute(request, async () => handler());
		},
	};
	const service = new GovernedActionService(runtime, client, evidence);
	return { target, handler, evidence, runtime, service };
}

function signedBinding(target: string, invalidSignature = false): ActionBinding {
	const now = Date.now();
	const params = { path: target };
	const unsigned = {
		actionId: randomUUID(),
		correlationId: randomUUID(),
		nonce: randomUUID(),
		issuedAt: now,
		expiresAt: now + 5000,
		argumentHash: computeActionHash("fixture_write", target, params),
		actorId: "outer-agent",
	};
	return { ...unsigned, signature: invalidSignature ? "invalid" : signBinding(unsigned, SECRET) };
}

describe("complete real-session broker security path", () => {
	it("connects AgentSession through GovernedActionService and verifies all security branches", async () => {
		const root = mkdtempSync(join(tmpdir(), "maat-broker-session-"));
		const guard = await startGuard("allow");
		try {
			const { target, handler, evidence, runtime, service } = makeService(guard.endpoint, root);
			const tool = createBrokerAgentTool({
				service,
				actorId: "outer-agent",
				secret: SECRET,
				name: "fixture_write",
				label: "Brokered fixture write",
				description: "Writes through the mandatory broker",
				parameters: Type.Object({ path: Type.String() }),
				resource: target,
			});
			const harness = await createHarness({ tools: [tool] });
			try {
				harness.setResponses([
					fauxAssistantMessage(fauxToolCall("fixture_write", { path: target }), { stopReason: "toolUse" }),
					fauxAssistantMessage("broker session complete"),
				]);
				const orchestrator = new MaatOrchestrator({ guard: allowOrchestrator });
				orchestrator.registerAgent(new CodingAgent(new PrimeAgentSessionRunner(harness.session)));
				const result = await orchestrator.submit({ request: "write through broker", kind: "development" });
				expect(result.task.status).toBe("completed");
				expect(handler).toHaveBeenCalledTimes(1);
				expect((await evidence.verify()).valid).toBe(true);
			} finally {
				harness.cleanup();
			}

			const invalid = await service.execute({
				actorId: "outer-agent",
				toolName: "fixture_write",
				resource: target,
				params: { path: target },
				security: signedBinding(target, true),
			});
			expect(invalid.denied).toBe(true);
			expect(handler).toHaveBeenCalledTimes(1);

			const replayBinding = signedBinding(target);
			const first = await service.execute({
				actorId: "outer-agent",
				toolName: "fixture_write",
				resource: target,
				params: { path: target },
				security: replayBinding,
			});
			expect(first.ok).toBe(true);
			const replay = await service.execute({
				actorId: "outer-agent",
				toolName: "fixture_write",
				resource: target,
				params: { path: target },
				security: replayBinding,
			});
			expect(replay.denied).toBe(true);
			expect(replay.reason).toContain("replay");
			expect(handler).toHaveBeenCalledTimes(2);

			guard.setDecision("deny");
			await expect(tool.execute("guard-deny", { path: target })).rejects.toThrow();
			expect(handler).toHaveBeenCalledTimes(2);

			guard.setDecision("allow");

			const brokerOutage = new GovernedActionService(
				runtime,
				{
					async execute() {
						throw new Error("broker offline");
					},
				},
				evidence,
			);
			const outage = await brokerOutage.execute({
				actorId: "outer-agent",
				toolName: "fixture_write",
				resource: target,
				params: { path: target },
				security: signedBinding(target),
			});
			expect(outage.denied).toBe(true);
			expect(outage.reason).toContain("broker offline");
			expect(handler).toHaveBeenCalledTimes(2);

			const guardOutage = makeService("http://127.0.0.1:1", root);
			const closed = await guardOutage.service.execute({
				actorId: "outer-agent",
				toolName: "fixture_write",
				resource: target,
				params: { path: target },
				security: signedBinding(target),
			});
			expect(closed.denied).toBe(true);
			expect(guardOutage.handler).not.toHaveBeenCalled();
		} finally {
			await guard.close();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
