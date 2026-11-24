import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SideEffectBroker } from "../src/governance/broker.js";
import {
	GitMaatEvidenceLog,
	GovernedToolRuntime,
	MAAT_DEFAULT_POLICY,
	MaatPolicyEngine,
	PolicyGuard,
} from "../src/governance/index.js";
import { type ActionBinding, computeActionHash, InMemoryReplayStore, signBinding } from "../src/governance/security.js";
import type { BrokerClient } from "../src/maat/governed-actions.js";
import { GovernedActionService } from "../src/maat/governed-actions.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
	const root = mkdtempSync(join(tmpdir(), "maat-broker-"));
	roots.push(root);
	const secret = "test-identity-secret";
	const target = join(root, "broker-output.txt");
	const policy = new MaatPolicyEngine([MAAT_DEFAULT_POLICY]);
	policy.registerAgent("outer-agent", "outer-ring");
	const evidence = new GitMaatEvidenceLog(join(root, "receipts.jsonl"));
	const runtimeReplay = new InMemoryReplayStore();
	const brokerReplay = new InMemoryReplayStore();
	const runtime = new GovernedToolRuntime({
		policy,
		guard: new PolicyGuard(policy),
		evidence,
		tools: new Map(),
		security: { identitySecret: secret, maxTtlMs: 10_000, replayStore: runtimeReplay },
	});
	const handler = vi.fn(async () => {
		writeFileSync(target, "executed");
		return { target };
	});
	const broker = new SideEffectBroker({
		identitySecret: secret,
		maxTtlMs: 10_000,
		replayStore: brokerReplay,
	});
	const client: BrokerClient = {
		async execute(request) {
			return await broker.execute(request, async () => handler());
		},
	};
	const service = new GovernedActionService(runtime, client, evidence);
	return { root, target, secret, handler, evidence, service };
}

function bindingFor(
	secret: string,
	params: { path: string },
	target: string,
	options: { signature?: string } = {},
): ActionBinding {
	const now = Date.now();
	const unsigned = {
		actionId: randomUUID(),
		correlationId: randomUUID(),
		nonce: randomUUID(),
		issuedAt: now,
		expiresAt: now + 5000,
		argumentHash: computeActionHash("fixture_write", target, params),
		actorId: "outer-agent",
	};
	return { ...unsigned, signature: options.signature ?? signBinding(unsigned, secret) };
}

describe("mandatory GovernedActionService broker path", () => {
	it("accepts a signed binding, executes once, and records evidence", async () => {
		const { target, secret, handler, evidence, service } = setup();
		const params = { path: target };
		const result = await service.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			resource: target,
			params,
			security: bindingFor(secret, params, target),
		});
		expect(result.ok).toBe(true);
		expect(result.denied).toBe(false);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(existsSync(target)).toBe(true);
		expect((await evidence.verify()).valid).toBe(true);
	});

	it("rejects replay of a previously accepted binding", async () => {
		const { target, secret, handler, service } = setup();
		const params = { path: target };
		const binding = bindingFor(secret, params, target);
		const first = await service.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			resource: target,
			params,
			security: binding,
		});
		expect(first.ok).toBe(true);
		const second = await service.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			resource: target,
			params,
			security: binding,
		});
		expect(second.ok).toBe(false);
		expect(second.denied).toBe(true);
		expect(second.reason).toContain("replay");
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("rejects an invalid signature before the broker or handler", async () => {
		const { target, secret, handler, service } = setup();
		const params = { path: target };
		const result = await service.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			resource: target,
			params,
			security: bindingFor(secret, params, target, { signature: "invalid-signature" }),
		});
		expect(result.ok).toBe(false);
		expect(result.denied).toBe(true);
		expect(result.reason).toContain("signature");
		expect(handler).not.toHaveBeenCalled();
		expect(existsSync(target)).toBe(false);
	});

	it("fails closed when the broker is unavailable", async () => {
		const { target, secret, handler, evidence, service } = setup();
		const params = { path: target };
		const unavailable = new GovernedActionService(
			(service as unknown as { runtime: GovernedToolRuntime }).runtime,
			{
				async execute() {
					throw new Error("broker offline");
				},
			},
			evidence,
		);
		const result = await unavailable.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			resource: target,
			params,
			security: bindingFor(secret, params, target),
		});
		expect(result.ok).toBe(false);
		expect(result.denied).toBe(true);
		expect(result.reason).toContain("broker offline");
		expect(handler).not.toHaveBeenCalled();
		expect(existsSync(target)).toBe(false);
		unavailable satisfies unknown;
	});
});
