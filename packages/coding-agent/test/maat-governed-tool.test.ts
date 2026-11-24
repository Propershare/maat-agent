import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GitMaatEvidenceLog,
	GovernedToolRuntime,
	MAAT_DEFAULT_POLICY,
	MaatPolicyEngine,
	PolicyGuard,
	type TehutiGuard,
} from "../src/governance/index.js";
import { createGovernedAgentTool } from "../src/maat/governed-tool.js";
import { CodingAgent, MaatOrchestrator } from "../src/maat/orchestrator.js";
import { PrimeAgentSessionRunner } from "../src/maat/prime-agent.js";
import { createHarness } from "./suite/harness.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const allowGuard = {
	async authorize() {
		return { allowed: true, reason: "orchestrator test approval" };
	},
};

function setup(guard?: TehutiGuard) {
	const root = mkdtempSync(join(tmpdir(), "maat-governed-tool-"));
	roots.push(root);
	const policy = new MaatPolicyEngine([MAAT_DEFAULT_POLICY]);
	policy.registerAgent("outer-agent", "outer-ring");
	policy.registerAgent("inner-agent", "inner-ring");
	const evidence = new GitMaatEvidenceLog(join(root, "receipts.jsonl"));
	const target = join(root, "tool-output.txt");
	const handler = vi.fn(async () => {
		writeFileSync(target, "executed");
		return { path: target };
	});
	const runtime = new GovernedToolRuntime({
		policy,
		guard: guard ?? new PolicyGuard(policy),
		evidence,
		tools: new Map([["fixture_write", handler]]),
	});
	return { root, target, handler, runtime, evidence };
}

function createTool(runtime: GovernedToolRuntime, actorId = "outer-agent") {
	return createGovernedAgentTool({
		runtime,
		actorId,
		name: "fixture_write",
		label: "Fixture write",
		description: "Writes a test fixture",
		parameters: Type.Object({ path: Type.String() }),
	});
}

describe("governed AgentTool inside a real AgentSession", () => {
	it("executes through GovernedToolRuntime and verifies GitMaat evidence", async () => {
		const { target, handler, runtime, evidence } = setup();
		const harness = await createHarness({ tools: [createTool(runtime)] });
		try {
			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("fixture_write", { path: target }), { stopReason: "toolUse" }),
				fauxAssistantMessage("tool completed"),
			]);
			const orchestrator = new MaatOrchestrator({ guard: allowGuard });
			orchestrator.registerAgent(new CodingAgent(new PrimeAgentSessionRunner(harness.session)));
			const result = await orchestrator.submit({ request: "write the fixture", kind: "development" });
			expect(result.task.status).toBe("completed");
			expect(handler).toHaveBeenCalledTimes(1);
			expect(existsSync(target)).toBe(true);
			const verification = await evidence.verify();
			expect(verification.valid).toBe(true);
		} finally {
			harness.cleanup();
		}
	});

	it("blocks a denied tool before its privileged handler", async () => {
		const { target, handler, runtime } = setup();
		const tool = createTool(runtime, "inner-agent");
		await expect(tool.execute("direct-denied", { path: target })).rejects.toThrow();
		expect(handler).not.toHaveBeenCalled();
		expect(existsSync(target)).toBe(false);
	});

	it("fails closed when Guard is unavailable", async () => {
		const unavailableGuard: TehutiGuard = {
			async decide() {
				throw new Error("guard offline");
			},
		};
		const { target, handler, runtime } = setup(unavailableGuard);
		const tool = createTool(runtime);
		await expect(tool.execute("direct-unavailable", { path: target })).rejects.toThrow();
		expect(handler).not.toHaveBeenCalled();
		expect(existsSync(target)).toBe(false);
	});
});
