import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	computeActionHash,
	InMemoryReplayStore,
	signBinding,
	type UnsignedActionBinding,
} from "../src/governance/security.js";
import { SecurityBrokerServer } from "../src/governance/security-broker-server.js";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const SECRET = "***";
const NOW = Date.now();

function binding(params: unknown, actionId = "external-action-1", nonce = "external-nonce-1") {
	const base: UnsignedActionBinding = {
		actionId,
		correlationId: "external-corr-1",
		nonce,
		issuedAt: NOW,
		expiresAt: NOW + 60_000,
		actorId: "outer-agent",
		argumentHash: computeActionHash("external_write", "", params),
	};
	return { ...base, signature: signBinding(base, SECRET) };
}

function request(params: unknown, overrides: Record<string, unknown> = {}) {
	const signed = binding(params);
	return {
		actorId: "outer-agent",
		actorRing: "outer-ring" as const,
		toolName: "external_write",
		params,
		actionId: "external-action-1",
		correlationId: "external-corr-1",
		binding: signed,
		guardDecision: "allow" as const,
		...overrides,
	};
}

function send(socketPath: string, payload: unknown): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		let data = "";
		socket.setEncoding("utf8");
		socket.on("connect", () => socket.write(JSON.stringify(payload) + "\n"));
		socket.on("data", (chunk: string) => {
			data += chunk;
		});
		socket.on("end", () => {
			try {
				resolve(JSON.parse(data));
			} catch (error) {
				reject(error);
			}
		});
		socket.on("error", reject);
	});
}

describe("external security broker", () => {
	it("executes an allowlisted signed operation exactly once over a Unix socket", async () => {
		const root = await mkdtemp(join(tmpdir(), "maat-broker-server-"));
		roots.push(root);
		const target = join(root, "result.txt");
		const operation = vi.fn(async (params: unknown) => {
			const { path } = params as { path: string };
			await writeFile(path, "authorized", { mode: 0o600 });
			return "done";
		});
		const server = new SecurityBrokerServer({
			socketPath: join(root, "broker.sock"),
			identitySecret: SECRET,
			maxTtlMs: 120_000,
			replayStore: new InMemoryReplayStore(),
			operations: new Map([["external_write", { run: operation }]]),
		});
		await server.start();
		expect(existsSync(join(root, "broker.sock"))).toBe(true);
		const params = { path: target };
		const first = (await send(join(root, "broker.sock"), {
			request: request(params),
			operation: "external_write",
		})) as { ok: boolean; executed: boolean };
		expect(first.ok).toBe(true);
		expect(first.executed).toBe(true);
		expect(operation).toHaveBeenCalledTimes(1);
		expect(await readFile(target, "utf8")).toBe("authorized");

		const second = (await send(join(root, "broker.sock"), {
			request: request(params),
			operation: "external_write",
		})) as { denied: boolean };
		expect(second.denied).toBe(true);
		expect(operation).toHaveBeenCalledTimes(1);
		await server.stop();
	});

	it("does not invoke operation for denied Guard decisions or non-allowlisted operations", async () => {
		const root = await mkdtemp(join(tmpdir(), "maat-broker-server-"));
		roots.push(root);
		const operation = vi.fn();
		const server = new SecurityBrokerServer({
			socketPath: join(root, "broker.sock"),
			identitySecret: SECRET,
			maxTtlMs: 120_000,
			replayStore: new InMemoryReplayStore(),
			operations: new Map([["external_write", { run: operation }]]),
		});
		await server.start();
		const denied = (await send(join(root, "broker.sock"), {
			request: request({}, { guardDecision: "deny" }),
			operation: "external_write",
		})) as { denied: boolean };
		expect(denied.denied).toBe(true);
		const notAllowlisted = (await send(join(root, "broker.sock"), {
			request: request({}),
			operation: "raw_shell",
		})) as { denied: boolean };
		expect(notAllowlisted.denied).toBe(true);
		expect(operation).not.toHaveBeenCalled();
		await server.stop();
	});
});
