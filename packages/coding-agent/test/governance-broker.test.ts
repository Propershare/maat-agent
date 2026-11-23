import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SideEffectBroker } from "../src/governance/broker.js";
import {
	computeActionHash,
	InMemoryReplayStore,
	signBinding,
	type UnsignedActionBinding,
} from "../src/governance/security.js";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SECRET = "***";
const NOW = Date.now();

function setup() {
	const root = mkdtempSync(join(tmpdir(), "maat-broker-"));
	tempDirs.push(root);
	const broker = new SideEffectBroker({
		identitySecret: SECRET,
		maxTtlMs: 120_000,
		replayStore: new InMemoryReplayStore(),
	});
	return { root, broker };
}

function binding(params: unknown, overrides: Partial<UnsignedActionBinding> = {}) {
	const base: UnsignedActionBinding = {
		actionId: "action-1",
		correlationId: "corr-1",
		nonce: "nonce-1",
		issuedAt: NOW - 1_000,
		expiresAt: NOW + 60_000,
		actorId: "outer-agent",
		argumentHash: computeActionHash("fixture_write", "", params),
		...overrides,
	};
	return { ...base, signature: signBinding(base, SECRET) };
}

function request(params: unknown, overrides: Record<string, unknown> = {}) {
	const signed = binding(params);
	return {
		actorId: "outer-agent",
		actorRing: "outer-ring" as const,
		toolName: "fixture_write",
		params,
		actionId: "action-1",
		correlationId: "corr-1",
		binding: signed,
		guardDecision: "allow" as const,
		...overrides,
	};
}

describe("side-effect broker prototype", () => {
	it("executes a valid signed, Guard-allowed action exactly once", async () => {
		const { root, broker } = setup();
		const target = join(root, "allowed.txt");
		const operation = vi.fn(() => writeFileSync(target, "executed"));
		const result = await broker.execute(request({ path: target }), operation);
		expect(result.ok).toBe(true);
		expect(result.executed).toBe(true);
		expect(operation).toHaveBeenCalledTimes(1);
		expect(existsSync(target)).toBe(true);
	});

	it.each(["deny", "review", "quarantine", "escalate"] as const)("blocks %s decisions", async (decision) => {
		const { root, broker } = setup();
		const target = join(root, "blocked.txt");
		const operation = vi.fn(() => writeFileSync(target, "blocked"));
		const result = await broker.execute(request({ path: target }, { guardDecision: decision }), operation);
		expect(result.denied).toBe(true);
		expect(operation).not.toHaveBeenCalled();
		expect(existsSync(target)).toBe(false);
	});

	it("rejects replay and tampered signatures without side effects", async () => {
		const { root, broker } = setup();
		const target = join(root, "replay.txt");
		const operation = vi.fn(() => writeFileSync(target, "once"));
		const req = request({ path: target });
		const first = await broker.execute(req, operation);
		const second = await broker.execute(req, operation);
		expect(first.ok).toBe(true);
		expect(second.denied).toBe(true);
		expect(operation).toHaveBeenCalledTimes(1);

		const tampered = request({ path: join(root, "tampered.txt") });
		tampered.binding = { ...tampered.binding, signature: "tampered" };
		const third = await broker.execute(tampered, operation);
		expect(third.denied).toBe(true);
		expect(operation).toHaveBeenCalledTimes(1);
	});

	it("rejects expired authorization and action hash mismatch", async () => {
		const { root, broker } = setup();
		const expired = request(
			{ path: join(root, "expired.txt") },
			{ binding: binding({ path: join(root, "expired.txt") }, { issuedAt: NOW - 200_000, expiresAt: NOW - 1_000 }) },
		);
		const operation = vi.fn();
		expect((await broker.execute(expired, operation)).denied).toBe(true);
		expect(operation).not.toHaveBeenCalled();

		const target = join(root, "hash.txt");
		const mismatch = request({ path: target }, { binding: binding({ path: "other" }) });
		expect((await broker.execute(mismatch, operation)).denied).toBe(true);
		expect(operation).not.toHaveBeenCalled();
	});

	it("documents the direct same-user bypass boundary", async () => {
		const { root, broker } = setup();
		const direct = join(root, "direct.txt");
		writeFileSync(direct, "direct");
		expect(existsSync(direct)).toBe(true);

		const target = join(root, "broker.txt");
		const result = await broker.execute(request({ path: target }, { guardDecision: "deny" }), () =>
			writeFileSync(target, "broker"),
		);
		expect(result.denied).toBe(true);
		expect(existsSync(target)).toBe(false);
	});
});
