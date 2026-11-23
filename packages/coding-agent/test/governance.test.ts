import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentContext, AgentLoopConfig, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { agentLoop } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	type UserMessage,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createGovernanceHooks,
	GitMaatEvidenceLog,
	GovernedToolRuntime,
	MAAT_DEFAULT_POLICY,
	MaatPolicyEngine,
	PolicyGuard,
	type TehutiGuard,
} from "../src/governance/index.js";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: createUsage(),
		stopReason,
		timestamp: Date.now(),
	};
}

function createUserMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
	) as Message[];
}

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(guard?: TehutiGuard) {
	const root = mkdtempSync(join(tmpdir(), "maat-governance-"));
	tempDirs.push(root);
	const policy = new MaatPolicyEngine([MAAT_DEFAULT_POLICY]);
	policy.registerAgent("outer-agent", "outer-ring");
	policy.registerAgent("inner-agent", "inner-ring");
	const evidence = new GitMaatEvidenceLog(join(root, "receipts.jsonl"));
	const tool = vi.fn(async (params: unknown) => {
		const path = (params as { path: string }).path;
		writeFileSync(path, "allowed");
		return { path };
	});
	const runtime = new GovernedToolRuntime({
		policy,
		guard: guard ?? new PolicyGuard(policy),
		evidence,
		tools: new Map([["fixture_write", tool]]),
	});
	return { root, policy, evidence, tool, runtime };
}

describe("Ma'at governed action acceptance", () => {
	it("authorizes an outer-ring write and records a GitMaat receipt", async () => {
		const { root, evidence, tool, runtime } = setup();
		const target = join(root, "allowed.txt");
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params: { path: target },
		});

		expect(result.ok).toBe(true);
		expect(result.denied).toBe(false);
		expect(result.receipt).toMatchObject({ decision: "allow", outcome: "executed", toolName: "fixture_write" });
		expect(existsSync(target)).toBe(true);
		expect(tool).toHaveBeenCalledTimes(1);
		expect((await evidence.verify()).valid).toBe(true);
	});

	it("denies an inner-ring write without executing the tool or creating the file", async () => {
		const { root, evidence, tool, runtime } = setup();
		const target = join(root, "denied.txt");
		const result = await runtime.execute({
			actorId: "inner-agent",
			toolName: "fixture_write",
			params: { path: target },
		});

		expect(result.ok).toBe(false);
		expect(result.denied).toBe(true);
		expect(result.receipt).toMatchObject({ decision: "deny", outcome: "denied", toolName: "fixture_write" });
		expect(existsSync(target)).toBe(false);
		expect(tool).not.toHaveBeenCalled();
		expect((await evidence.verify()).valid).toBe(true);
	});

	it("detects tampering in a copied receipt chain", async () => {
		const { root, evidence, runtime } = setup();
		await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params: { path: join(root, "one.txt") },
		});
		await runtime.execute({
			actorId: "inner-agent",
			toolName: "fixture_write",
			params: { path: join(root, "two.txt") },
		});
		expect((await evidence.verify()).valid).toBe(true);

		const source = join(root, "receipts.jsonl");
		const copy = join(root, "tampered.jsonl");
		copyFileSync(source, copy);
		const lines = readFileSync(copy, "utf8").trim().split("\n");
		const first = JSON.parse(lines[0]);
		first.reason = "tampered";
		lines[0] = JSON.stringify(first);
		writeFileSync(copy, lines.join("\n") + "\n");
		const verification = await new GitMaatEvidenceLog(copy).verify();
		expect(verification.valid).toBe(false);
		expect(verification.brokenAt).toBe(1);
	});

	it("fails closed when the guard is unavailable", async () => {
		const unavailableGuard: TehutiGuard = {
			decide: async () => {
				throw new Error("Sentinel unavailable");
			},
		};
		const { root, evidence, tool, runtime } = setup(unavailableGuard);
		const target = join(root, "guard-unavailable.txt");
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params: { path: target },
		});

		expect(result.ok).toBe(false);
		expect(result.denied).toBe(true);
		expect(result.receipt.outcome).toBe("denied");
		expect(result.reason).toContain("Governance guard unavailable");
		expect(existsSync(target)).toBe(false);
		expect(tool).not.toHaveBeenCalled();
		expect((await evidence.verify()).valid).toBe(true);
	});

	it("blocks an unauthorized tool through the real agentLoop beforeToolCall hook", async () => {
		const { root, evidence, runtime } = setup();
		const target = join(root, "hook-bypass.txt");
		const sideEffect = vi.fn(async () => ({ content: [{ type: "text" as const, text: "executed" }], details: {} }));
		const tool = {
			name: "fixture_write",
			label: "Fixture write",
			description: "Writes a fixture file",
			parameters: Type.Object({ path: Type.String() }),
			execute: sideEffect,
		} satisfies AgentTool;
		const hooks = createGovernanceHooks(runtime, "inner-agent");
		const assistantMessage = createAssistantMessage(
			[{ type: "toolCall", id: "call-1", name: "fixture_write", arguments: { path: target } }],
			"toolUse",
		);
		let call = 0;
		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				if (call++ === 0) {
					stream.push({ type: "done", reason: "toolUse", message: assistantMessage });
				} else {
					stream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
			});
			return stream;
		};
		const context: AgentContext = { systemPrompt: "test", messages: [], tools: [tool] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			beforeToolCall: async ({ toolCall, args }) => hooks.beforeToolCall({ toolCall, args }),
			afterToolCall: async ({ toolCall, result, isError }) => {
				await hooks.afterToolCall({ toolCall, result, isError });
				return undefined;
			},
		};
		const stream = agentLoop([createUserMessage("write it")], context, config, undefined, streamFn);
		for await (const _event of stream) {
			// drain
		}
		await stream.result();

		expect(sideEffect).not.toHaveBeenCalled();
		expect(existsSync(target)).toBe(false);
		const records = await evidence.all();
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ decision: "deny", outcome: "denied" });
		expect((await evidence.verify()).valid).toBe(true);
	});
});
