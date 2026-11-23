import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GitMaatEvidenceLog,
	GovernedToolRuntime,
	MAAT_DEFAULT_POLICY,
	MaatPolicyEngine,
	PolicyGuard,
} from "../src/governance/index.js";
import {
	computeActionHash,
	InMemoryReplayStore,
	type SecurityConfig,
	signBinding,
	type UnsignedActionBinding,
} from "../src/governance/security.js";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SECRET = "security-test-secret";
const NOW = Date.now();

function setup() {
	const root = mkdtempSync(join(tmpdir(), "maat-security-"));
	tempDirs.push(root);
	const policy = new MaatPolicyEngine([MAAT_DEFAULT_POLICY]);
	policy.registerAgent("outer-agent", "outer-ring");
	policy.registerAgent("middle-agent", "middle-ring");
	const evidence = new GitMaatEvidenceLog(join(root, "receipts.jsonl"));
	const tool = vi.fn(async (params: unknown) => {
		writeFileSync((params as { path: string }).path, "executed");
		return { ok: true };
	});
	const security: SecurityConfig = {
		identitySecret: SECRET,
		maxTtlMs: 120_000,
		replayStore: new InMemoryReplayStore(),
	};
	const runtime = new GovernedToolRuntime({
		policy,
		guard: new PolicyGuard(policy),
		evidence,
		tools: new Map([["fixture_write", tool]]),
		security,
	});
	return { root, runtime, evidence, tool };
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

describe("governance security hardening", () => {
	it("allows a validly bound action and records correlation", async () => {
		const { root, runtime, evidence, tool } = setup();
		const target = join(root, "allowed.txt");
		const params = { path: target };
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params,
			security: binding(params),
		});

		expect(result.ok).toBe(true);
		expect(existsSync(target)).toBe(true);
		expect(tool).toHaveBeenCalledTimes(1);
		expect(result.receipt).toMatchObject({ actionId: "action-1", correlationId: "corr-1", nonce: "nonce-1" });
		expect((await evidence.verify()).valid).toBe(true);
	});

	it("rejects replay of the same nonce/action", async () => {
		const { root, runtime, tool } = setup();
		const target = join(root, "replay.txt");
		const params = { path: target };
		const signed = binding(params);
		const first = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params,
			security: signed,
		});
		const second = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params,
			security: signed,
		});

		expect(first.ok).toBe(true);
		expect(second.denied).toBe(true);
		expect(second.reason).toContain("replay");
		expect(tool).toHaveBeenCalledTimes(1);
	});

	it("rejects expired authorization", async () => {
		const { root, runtime, tool } = setup();
		const target = join(root, "expired.txt");
		const params = { path: target };
		const signed = binding(params, { issuedAt: NOW - 120_000, expiresAt: NOW - 1_000 });
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params,
			security: signed,
		});
		expect(result.denied).toBe(true);
		expect(result.reason).toContain("expired");
		expect(existsSync(target)).toBe(false);
		expect(tool).not.toHaveBeenCalled();
	});

	it("rejects exact action/argument hash mismatch", async () => {
		const { root, runtime, tool } = setup();
		const target = join(root, "mismatch.txt");
		const params = { path: target };
		const signed = binding(params, { argumentHash: computeActionHash("fixture_write", "", { path: "other" }) });
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params,
			security: signed,
		});
		expect(result.denied).toBe(true);
		expect(result.reason).toContain("hash mismatch");
		expect(tool).not.toHaveBeenCalled();
	});

	it("rejects tampered identity signature", async () => {
		const { root, runtime, tool } = setup();
		const params = { path: join(root, "tampered.txt") };
		const signed = binding(params);
		signed.signature = "tampered";
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params,
			security: signed,
		});
		expect(result.denied).toBe(true);
		expect(result.reason).toContain("signature");
		expect(tool).not.toHaveBeenCalled();
	});

	it("rejects delegation that escalates ring authority", async () => {
		const { root, runtime, tool } = setup();
		const params = { path: join(root, "delegation.txt") };
		const signed = binding(params, {
			actorId: "middle-agent",
			delegation: [{ actorId: "outer-agent", ring: "outer-ring", expiresAt: NOW + 60_000 }],
		});
		const result = await runtime.execute({
			actorId: "middle-agent",
			toolName: "fixture_write",
			params,
			security: signed,
		});
		expect(result.denied).toBe(true);
		expect(result.reason).toContain("delegation escalates");
		expect(tool).not.toHaveBeenCalled();
	});

	it("fails closed when security configuration is missing", async () => {
		const { root, tool } = setup();
		// Replace runtime with one lacking the security config.
		const policy = new MaatPolicyEngine([MAAT_DEFAULT_POLICY]);
		policy.registerAgent("outer-agent", "outer-ring");
		const evidence = new GitMaatEvidenceLog(join(root, "no-security.jsonl"));
		const noSecurity = new GovernedToolRuntime({
			policy,
			guard: new PolicyGuard(policy),
			evidence,
			tools: new Map([["fixture_write", tool]]),
		});
		const params = { path: join(root, "no-security.txt") };
		const result = await noSecurity.execute({
			actorId: "outer-agent",
			toolName: "fixture_write",
			params,
			security: binding(params),
		});
		expect(result.denied).toBe(true);
		expect(result.reason).toContain("identity binding secret");
		expect(tool).not.toHaveBeenCalled();
	});
});
