import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SideEffectBroker } from "../src/governance/broker.js";
import {
	GitMaatEvidenceLog,
	GovernedToolRuntime,
	MaatPolicyEngine,
	type TehutiGuard,
} from "../src/governance/index.js";
import { detectSandboxCapabilities, Sandbox, SandboxProvisionError } from "../src/governance/sandbox-provisioner.js";
import {
	computeActionHash,
	InMemoryReplayStore,
	signBinding,
	type UnsignedActionBinding,
} from "../src/governance/security.js";

const sandboxes: Sandbox[] = [];
afterEach(async () => {
	for (const sandbox of sandboxes.splice(0)) await sandbox.close();
});

const SECRET = "***";
const NOW = Date.now();

function signed(params: unknown, actionId = "sandbox-action-1", nonce = "sandbox-nonce-1") {
	const base: UnsignedActionBinding = {
		actionId,
		correlationId: "sandbox-corr-1",
		nonce,
		issuedAt: NOW,
		expiresAt: NOW + 60_000,
		actorId: "outer-agent",
		argumentHash: computeActionHash("protected_write", "", params),
	};
	return { ...base, signature: signBinding(base, SECRET) };
}

describe("automatic sandbox provisioner", () => {
	it("detects an enforceable bubblewrap backend or fails closed", () => {
		const capabilities = detectSandboxCapabilities();
		expect(capabilities.platform).toBe("linux");
		expect(capabilities.bubblewrap).toBe(true);
		expect(capabilities.userNamespaces).toBe(true);
		expect(capabilities.backend).toBe("bubblewrap");
	});

	it("creates a sandbox, runs a synthetic agent, and tears it down", async () => {
		const sandbox = await Sandbox.provision();
		sandboxes.push(sandbox);
		const run = await sandbox.run(["/bin/sh", "-c", "printf sandbox-ok > agent-output.txt && cat agent-output.txt"]);
		expect(run.exitCode).toBe(0);
		expect(run.stdout.trim()).toBe("sandbox-ok");
		expect(readFileSync(join(sandbox.workDir, "agent-output.txt"), "utf8")).toBe("sandbox-ok");

		const root = sandbox.root;
		await sandbox.close();
		sandboxes.splice(sandboxes.indexOf(sandbox), 1);
		expect(existsSync(root)).toBe(false);
	});

	it("denies protected host files and direct loopback network access inside the sandbox", async () => {
		const sandbox = await Sandbox.provision();
		sandboxes.push(sandbox);
		await sandbox.writeProtectedFile("secret.txt", "protected-secret");
		const read = await sandbox.run([
			"/bin/sh",
			"-c",
			"cat '" + sandbox.protectedDir + "/secret.txt' 2>&1; printf '\nexit=%s\n' $?",
		]);
		expect(read.stdout).toContain("exit=1");
		expect(read.stdout).not.toContain("protected-secret");
		const network = await sandbox.run(["/usr/bin/curl", "-sS", "--max-time", "1", "http://127.0.0.1:8013/health"]);
		expect(network.exitCode).not.toBe(0);
		expect(network.stderr).toMatch(/Failed to connect|Connection refused|Could not connect/);
	});

	it("allows authorized broker execution and rejects denied or replayed authorization", async () => {
		const sandbox = await Sandbox.provision();
		sandboxes.push(sandbox);
		const target = await sandbox.writeProtectedFile("broker-result.txt", "initial");
		const replayStore = new InMemoryReplayStore();
		const broker = new SideEffectBroker({ identitySecret: SECRET, maxTtlMs: 120_000, replayStore });
		const params = { name: "broker-result.txt" };
		const binding = signed(params);
		const operation = vi.fn(async () => {
			const { writeFile } = await import("node:fs/promises");
			await writeFile(target, "authorized", { mode: 0o600 });
		});
		const allowed = await broker.execute(
			{
				actorId: "outer-agent",
				actorRing: "outer-ring",
				toolName: "protected_write",
				params,
				actionId: binding.actionId,
				correlationId: binding.correlationId,
				binding,
				guardDecision: "allow",
			},
			operation,
		);
		expect(allowed.ok).toBe(true);
		expect(operation).toHaveBeenCalledTimes(1);
		expect(readFileSync(target, "utf8")).toBe("authorized");

		const replay = await broker.execute(
			{
				actorId: "outer-agent",
				actorRing: "outer-ring",
				toolName: "protected_write",
				params,
				actionId: binding.actionId,
				correlationId: binding.correlationId,
				binding,
				guardDecision: "allow",
			},
			operation,
		);
		expect(replay.denied).toBe(true);
		expect(operation).toHaveBeenCalledTimes(1);
	});

	it("runs the actual governed runtime with a broker-mediated handler", async () => {
		const sandbox = await Sandbox.provision();
		sandboxes.push(sandbox);
		const target = await sandbox.writeProtectedFile("runtime-result.txt", "initial");
		const broker = new SideEffectBroker({
			identitySecret: SECRET,
			maxTtlMs: 120_000,
			replayStore: new InMemoryReplayStore(),
		});
		const policy = new MaatPolicyEngine();
		policy.registerAgent("outer-agent", "outer-ring", "Synthetic Agent");
		const guard: TehutiGuard = { decide: async () => ({ decision: "allow", reason: "synthetic allow" }) };
		const evidence = new GitMaatEvidenceLog(join(sandbox.root, "evidence.jsonl"));
		const params = { name: "runtime-result.txt" };
		const binding = signed(params, "runtime-action-1", "runtime-nonce-1");
		const runtime = new GovernedToolRuntime({
			policy,
			guard,
			evidence,
			security: { identitySecret: SECRET, maxTtlMs: 120_000, replayStore: new InMemoryReplayStore() },
			tools: new Map([
				[
					"protected_write",
					async (toolParams: unknown) => {
						const result = await broker.execute(
							{
								actorId: "outer-agent",
								actorRing: "outer-ring",
								toolName: "protected_write",
								params: toolParams,
								actionId: binding.actionId,
								correlationId: binding.correlationId,
								binding,
								guardDecision: "allow",
							},
							async () => {
								const { writeFile } = await import("node:fs/promises");
								await writeFile(target, "runtime-authorized", { mode: 0o600 });
							},
						);
						if (!result.ok) throw new Error(result.reason);
						return result.result;
					},
				],
			]),
		});
		const result = await runtime.execute({
			actorId: "outer-agent",
			toolName: "protected_write",
			params,
			resource: "",
			security: binding,
		});
		expect(result.ok).toBe(true);
		expect(readFileSync(target, "utf8")).toBe("runtime-authorized");
		expect((await evidence.verify()).valid).toBe(true);
	});

	it("fails closed when no enforceable sandbox backend is available", async () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
		try {
			await expect(Sandbox.provision()).rejects.toBeInstanceOf(SandboxProvisionError);
		} finally {
			Object.defineProperty(process, "platform", { value: original, configurable: true });
		}
	});
});
