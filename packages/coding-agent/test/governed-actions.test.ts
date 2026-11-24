import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrokerRequest, BrokerResult } from "../src/governance/broker.js";
import {
	type AgentRing,
	GitMaatEvidenceLog,
	GovernedToolRuntime,
	MAAT_DEFAULT_POLICY,
	MaatPolicyEngine,
	PolicyGuard,
	type TehutiGuard,
	type ToolHandler,
} from "../src/governance/index.js";
import {
	type ActionBinding,
	computeActionHash,
	InMemoryReplayStore,
	signBinding,
	type UnsignedActionBinding,
} from "../src/governance/security.js";
import { SecurityBrokerServer } from "../src/governance/security-broker-server.js";
import { type BrokerClient, GovernedActionService } from "../src/maat/governed-actions.js";
import { createSyntheticOperations } from "../src/maat/synthetic-operations.js";

const SECRET = "synthetic-governed-actions-secret";
const roots: string[] = [];
const servers: SecurityBrokerServer[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) await server.stop();
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

class SocketBrokerClient implements BrokerClient {
	constructor(private readonly socketPath: string) {}

	execute(request: BrokerRequest): Promise<BrokerResult> {
		return new Promise((resolve, reject) => {
			const socket = createConnection(this.socketPath);
			let data = "";
			socket.setEncoding("utf8");
			socket.on("connect", () => socket.write(JSON.stringify({ request, operation: request.toolName }) + "\n"));
			socket.on("data", (chunk: string) => {
				data += chunk;
			});
			socket.on("end", () => {
				try {
					resolve(JSON.parse(data) as BrokerResult);
				} catch (error) {
					reject(error);
				}
			});
			socket.on("error", reject);
		});
	}
}

function bindingFor(actorId: string, toolName: string, resource: string, params: unknown): ActionBinding {
	const now = Date.now();
	const unsigned: UnsignedActionBinding = {
		actionId: "action-" + Math.random().toString(36).slice(2),
		correlationId: "corr-" + Math.random().toString(36).slice(2),
		nonce: "nonce-" + Math.random().toString(36).slice(2),
		issuedAt: now,
		expiresAt: now + 20_000,
		argumentHash: computeActionHash(toolName, resource, params),
		actorId,
	};
	return { ...unsigned, signature: signBinding(unsigned, SECRET) };
}

async function setup(ring: AgentRing = "outer-ring", guardOverride?: TehutiGuard) {
	const root = await mkdtemp(join(tmpdir(), "maat-governed-actions-"));
	roots.push(root);
	const operations = createSyntheticOperations(root);
	const tools = new Map<string, ToolHandler>(
		[...operations].map(([name, operation]) => [name, async (params) => operation.run(params)]),
	);
	const policy = new MaatPolicyEngine([MAAT_DEFAULT_POLICY]);
	policy.registerAgent("agent-1", ring);
	const guard = guardOverride ?? new PolicyGuard(policy);
	const evidence = new GitMaatEvidenceLog(join(root, "evidence.jsonl"));
	const runtime = new GovernedToolRuntime({
		policy,
		guard,
		evidence,
		tools,
		security: {
			identitySecret: SECRET,
			maxTtlMs: 60_000,
			replayStore: new InMemoryReplayStore(),
		},
	});
	const socketPath = join(root, "broker.sock");
	const server = new SecurityBrokerServer({
		socketPath,
		identitySecret: SECRET,
		maxTtlMs: 60_000,
		replayStore: new InMemoryReplayStore(),
		operations,
	});
	await server.start();
	servers.push(server);
	const service = new GovernedActionService(runtime, new SocketBrokerClient(socketPath), evidence);
	return { root, service, evidence, operations };
}

function action(
	actorId: string,
	toolName: string,
	params: unknown,
	resource = "",
): { actorId: string; toolName: string; resource: string; params: unknown; security: ActionBinding } {
	return { actorId, toolName, resource, params, security: bindingFor(actorId, toolName, resource, params) };
}

describe("governed synthetic operations", () => {
	it("executes authorized boot, memory write, and pack installation through the broker", async () => {
		const { root, service, evidence } = await setup();
		const boot = await service.execute(
			action("agent-1", "synthetic_boot", { seat: "synthetic-seat", agentId: "agent-1" }),
		);
		expect(boot.ok).toBe(true);
		expect(JSON.parse(await readFile(join(root, "boot", "session.json"), "utf8"))).toMatchObject({
			seat: "synthetic-seat",
		});

		const memory = await service.execute(
			action("agent-1", "synthetic_memory_write", { content: "synthetic memory", memoryClass: "episodic" }),
		);
		expect(memory.ok).toBe(true);
		expect(await readFile(join(root, "memory", "memory.jsonl"), "utf8")).toContain("synthetic memory");

		const source = join(root, "pack-source");
		const target = join(root, "pack-target");
		await mkdir(source, { recursive: true });
		await writeFile(join(source, "manifest.json"), "{}");
		const pack = await service.execute(action("agent-1", "synthetic_pack_install", { source, target }));
		expect(pack.ok).toBe(true);
		expect(await readFile(join(target, "manifest.json"), "utf8")).toBe("{}");

		const verification = await evidence.verify();
		expect(verification.valid).toBe(true);
		expect(verification.records).toBe(3);
	});

	it("denies an unauthorized ring without executing the operation", async () => {
		const { root, service } = await setup("inner-ring");
		const outcome = await service.execute(action("agent-1", "synthetic_boot", { seat: "synthetic-seat" }));
		expect(outcome.ok).toBe(false);
		expect(outcome.denied).toBe(true);
		await expect(readFile(join(root, "boot", "session.json"), "utf8")).rejects.toThrow();
	});

	it("rejects replay of an otherwise authorized binding", async () => {
		const { service } = await setup();
		const request = action("agent-1", "synthetic_memory_write", { content: "once" });
		const first = await service.execute(request);
		const second = await service.execute(request);
		expect(first.ok).toBe(true);
		expect(second.ok).toBe(false);
		expect(second.denied).toBe(true);
	});

	it("rejects argument tampering after the binding is signed", async () => {
		const { root, service } = await setup();
		const request = action("agent-1", "synthetic_memory_write", { content: "original" });
		request.params = { content: "tampered" };
		const outcome = await service.execute(request);
		expect(outcome.ok).toBe(false);
		expect(outcome.denied).toBe(true);
		await expect(readFile(join(root, "memory", "memory.jsonl"), "utf8")).rejects.toThrow();
	});

	it("fails closed when the Guard is unavailable", async () => {
		const unavailable: TehutiGuard = {
			decide: vi.fn(async () => {
				throw new Error("guard down");
			}),
		};
		const { root, service } = await setup("outer-ring", unavailable);
		const outcome = await service.execute(action("agent-1", "synthetic_boot", { seat: "synthetic-seat" }));
		expect(outcome.ok).toBe(false);
		expect(outcome.denied).toBe(true);
		expect(outcome.reason).toContain("guard down");
		await expect(readFile(join(root, "boot", "session.json"), "utf8")).rejects.toThrow();
	});
});
