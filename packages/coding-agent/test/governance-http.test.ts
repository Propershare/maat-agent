import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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
	type TehutiGuard,
} from "../src/governance/index.js";
import { TehutiGuardHttpAdapter } from "../src/governance/tehuti-guard-http.js";

const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function bodyOf(req: IncomingMessage): Promise<string> {
	let text = "";
	for await (const chunk of req) text += chunk;
	return text;
}

async function startGuard(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): Promise<string> {
	const server = createServer((req, res) => void handler(req, res));
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Mock Guard did not bind a TCP port");
	return "http://127.0.0.1:" + address.port;
}

function jsonResponse(res: ServerResponse, body: unknown, status = 200): void {
	const text = JSON.stringify(body);
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(text);
}

function allowResponse(correlationId: string) {
	return {
		decision: "allow",
		severity: "info",
		reason: "Operational posture; low-risk action allowed",
		tags: ["allow"],
		blocking_actions: [],
		matched_rules: ["operational_low_risk_allow"],
		explanation_id: "sha256:allow",
		policy_version: "1",
		correlation_id: correlationId,
		sentinel_url: "http://127.0.0.1:4242",
	};
}

function setup(guard: TehutiGuard) {
	const root = mkdtempSync(join(tmpdir(), "maat-http-guard-"));
	tempDirs.push(root);
	const policy = new MaatPolicyEngine([MAAT_DEFAULT_POLICY]);
	policy.registerAgent("outer-agent", "outer-ring");
	policy.registerAgent("inner-agent", "inner-ring");
	const evidence = new GitMaatEvidenceLog(join(root, "receipts.jsonl"));
	const tool = vi.fn(async (params: unknown) => {
		writeFileSync((params as { path: string }).path, "executed");
		return { ok: true };
	});
	const runtime = new GovernedToolRuntime({
		policy,
		guard,
		evidence,
		tools: new Map([["fixture_write", tool]]),
	});
	return { root, evidence, tool, runtime };
}

describe("Tehuti Guard HTTP adapter", () => {
	it("accepts a valid authenticated allow and correlates evidence", async () => {
		let seenAuth = "";
		let seenBody: Record<string, unknown> | undefined;
		const base = await startGuard(async (req, res) => {
			seenAuth = String(req.headers.authorization ?? "");
			seenBody = JSON.parse(await bodyOf(req)) as Record<string, unknown>;
			jsonResponse(res, allowResponse(String(seenBody.correlation_id)));
		});
		const config = {
			endpoint: base,
			token: "test-token",
			machineId: "test-machine",
			timeoutMs: 1000,
			expectedPolicyVersion: "1",
		};
		const adapter = new TehutiGuardHttpAdapter(config);
		const { root, evidence, tool, runtime } = setup(adapter);
		const target = join(root, "allowed.txt");
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params: { path: target },
			actionId: "action-1",
			correlationId: "corr-1",
			argumentHash: "sha256:args",
			policyVersion: "1",
		});

		expect(result.ok).toBe(true);
		expect(result.receipt).toMatchObject({
			actionId: "action-1",
			correlationId: "corr-1",
			argumentHash: "sha256:args",
			policyVersion: "1",
			guardExplanationId: "sha256:allow",
		});
		expect(seenAuth).toBe("Bearer test-token");
		expect(seenBody).toMatchObject({
			machine_id: "test-machine",
			actor: { id: "outer-agent", role: "outer-ring" },
			action: {
				kind: "execute",
				metadata: { action_id: "action-1", correlation_id: "corr-1", tool_name: "fixture_write" },
			},
		});
		expect(existsSync(target)).toBe(true);
		expect(tool).toHaveBeenCalledTimes(1);
		expect((await evidence.verify()).valid).toBe(true);
	});

	it.each(["deny", "review", "quarantine", "escalate"])("blocks %s decisions before execution", async (decision) => {
		const base = await startGuard(async (req, res) => {
			const body = JSON.parse(await bodyOf(req)) as { correlation_id: string };
			jsonResponse(res, { ...allowResponse(body.correlation_id), decision, reason: "blocked by guard" });
		});
		const adapter = new TehutiGuardHttpAdapter({ endpoint: base, token: "test-token", machineId: "test-machine" });
		const { root, evidence, tool, runtime } = setup(adapter);
		const target = join(root, "blocked.txt");
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params: { path: target },
		});

		expect(result.ok).toBe(false);
		expect(result.denied).toBe(true);
		expect(result.receipt.outcome).toBe("denied");
		expect(existsSync(target)).toBe(false);
		expect(tool).not.toHaveBeenCalled();
		expect((await evidence.verify()).valid).toBe(true);
	});

	it("treats Sentinel review/outage as non-allow and records denial", async () => {
		const base = await startGuard(async (req, res) => {
			const body = JSON.parse(await bodyOf(req)) as { correlation_id: string };
			jsonResponse(res, {
				...allowResponse(body.correlation_id),
				decision: "review",
				tags: ["sentinel_unreachable", "policy_rejection"],
				matched_rules: ["sentinel_unreachable_review"],
				reason: "Sentinel unified view unavailable",
			});
		});
		const adapter = new TehutiGuardHttpAdapter({ endpoint: base, token: "test-token", machineId: "test-machine" });
		const { root, tool, runtime } = setup(adapter);
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params: { path: join(root, "review.txt") },
		});
		expect(result.denied).toBe(true);
		expect(tool).not.toHaveBeenCalled();
	});

	it("blocks on invalid authentication", async () => {
		const base = await startGuard(async (_req, res) => jsonResponse(res, { error: "unauthorized" }, 401));
		const adapter = new TehutiGuardHttpAdapter({ endpoint: base, token: "wrong-token", machineId: "test-machine" });
		const { root, evidence, tool, runtime } = setup(adapter);
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params: { path: join(root, "auth.txt") },
		});
		expect(result.denied).toBe(true);
		expect(result.reason).toContain("HTTP status 401");
		expect(tool).not.toHaveBeenCalled();
		expect((await evidence.verify()).valid).toBe(true);
	});

	it("blocks on malformed response", async () => {
		const base = await startGuard(async (_req, res) => {
			res.writeHead(200);
			res.end("not-json");
		});
		const adapter = new TehutiGuardHttpAdapter({ endpoint: base, token: "test-token", machineId: "test-machine" });
		const { root, tool, runtime } = setup(adapter);
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params: { path: join(root, "malformed.txt") },
		});
		expect(result.denied).toBe(true);
		expect(tool).not.toHaveBeenCalled();
	});

	it("blocks on timeout without executing", async () => {
		const base = await startGuard(async (_req, res) => {
			await new Promise((resolve) => setTimeout(resolve, 100));
			jsonResponse(res, {});
		});
		const adapter = new TehutiGuardHttpAdapter({
			endpoint: base,
			token: "test-token",
			machineId: "test-machine",
			timeoutMs: 10,
		});
		const { root, tool, runtime } = setup(adapter);
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params: { path: join(root, "timeout.txt") },
		});
		expect(result.denied).toBe(true);
		expect(tool).not.toHaveBeenCalled();
	});

	it("blocks on refused connection", async () => {
		const adapter = new TehutiGuardHttpAdapter({
			endpoint: "http://127.0.0.1:1",
			token: "test-token",
			machineId: "test-machine",
			timeoutMs: 100,
		});
		const { root, tool, runtime } = setup(adapter);
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params: { path: join(root, "refused.txt") },
		});
		expect(result.denied).toBe(true);
		expect(tool).not.toHaveBeenCalled();
	});

	it("rejects correlation mismatch and missing configuration", async () => {
		const base = await startGuard(async (_req, res) => jsonResponse(res, allowResponse("different-correlation")));
		const adapter = new TehutiGuardHttpAdapter({ endpoint: base, token: "test-token", machineId: "test-machine" });
		const { root, tool, runtime } = setup(adapter);
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params: { path: join(root, "mismatch.txt") },
			correlationId: "expected-correlation",
		});
		expect(result.denied).toBe(true);
		expect(result.reason).toContain("correlation_id mismatch");
		expect(tool).not.toHaveBeenCalled();
		expect(() => new TehutiGuardHttpAdapter({ endpoint: "", token: "", machineId: "" })).toThrow("explicit endpoint");
	});

	it("executes through the real agentLoop with the HTTP adapter", async () => {
		const base = await startGuard(async (req, res) => {
			const body = JSON.parse(await bodyOf(req)) as { correlation_id: string };
			jsonResponse(res, allowResponse(body.correlation_id));
		});
		const adapter = new TehutiGuardHttpAdapter({ endpoint: base, token: "test-token", machineId: "test-machine" });
		const { root, evidence, runtime } = setup(adapter);
		const target = join(root, "loop-http-allowed.txt");
		const sideEffect = vi.fn(async () => {
			writeFileSync(target, "executed");
			return { content: [{ type: "text" as const, text: "executed" }], details: {} };
		});
		const tool = {
			name: "fixture_write",
			label: "Fixture write",
			description: "Writes a fixture file",
			parameters: Type.Object({ path: Type.String() }),
			execute: sideEffect,
		} satisfies AgentTool;
		const hooks = createGovernanceHooks(runtime, "outer-agent");
		const assistantMessage = createAssistantMessage(
			[{ type: "toolCall", id: "http-loop-1", name: "fixture_write", arguments: { path: target } }],
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

		expect(sideEffect).toHaveBeenCalledTimes(1);
		expect(existsSync(target)).toBe(true);
		const records = await evidence.all();
		expect(records.some((record) => record.decision === "allow" && record.outcome === "executed")).toBe(true);
		expect((await evidence.verify()).valid).toBe(true);
	});
});

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
