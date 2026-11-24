import { readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sandbox } from "../src/governance/sandbox-provisioner.js";
import {
	computeActionHash,
	InMemoryReplayStore,
	signBinding,
	type UnsignedActionBinding,
} from "../src/governance/security.js";
import { SecurityBrokerServer } from "../src/governance/security-broker-server.js";

const roots: string[] = [];
const sandboxes: Sandbox[] = [];
afterEach(async () => {
	for (const sandbox of sandboxes.splice(0)) await sandbox.close();
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const SECRET = "***";
const NOW = Date.now();

function signed(params: unknown, actionId = "boundary-action-1", nonce = "boundary-nonce-1") {
	const base: UnsignedActionBinding = {
		actionId,
		correlationId: "boundary-corr-1",
		nonce,
		issuedAt: NOW,
		expiresAt: NOW + 60_000,
		actorId: "outer-agent",
		argumentHash: computeActionHash("external_write", "", params),
	};
	return { ...base, signature: signBinding(base, SECRET) };
}

function request(params: unknown, overrides: Record<string, unknown> = {}) {
	return {
		actorId: "outer-agent",
		actorRing: "outer-ring" as const,
		toolName: "external_write",
		params,
		actionId: "boundary-action-1",
		correlationId: "boundary-corr-1",
		binding: signed(params),
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

describe("enforced sandbox + external broker boundary", () => {
	it("denies direct protected access inside the boundary and permits one signed broker action", async () => {
		const sandbox = await Sandbox.provision();
		sandboxes.push(sandbox);
		const target = await sandbox.writeProtectedFile("boundary-secret.txt", "protected-secret");
		const socketPath = join(sandbox.workDir, "broker.sock");
		const operation = vi.fn(async () => {
			const { writeFile } = await import("node:fs/promises");
			await writeFile(target, "authorized", { mode: 0o600 });
			return "done";
		});
		const server = new SecurityBrokerServer({
			socketPath,
			identitySecret: SECRET,
			maxTtlMs: 120_000,
			replayStore: new InMemoryReplayStore(),
			operations: new Map([["external_write", { run: operation }]]),
		});
		await server.start();

		const params = { path: target };
		const first = (await send(socketPath, { request: request(params), operation: "external_write" })) as {
			ok: boolean;
			executed: boolean;
		};
		expect(first.ok).toBe(true);
		expect(first.executed).toBe(true);
		expect(operation).toHaveBeenCalledTimes(1);
		expect(await readFile(target, "utf8")).toBe("authorized");

		const directRead = await sandbox.run(["/bin/sh", "-c", "cat '" + target + "' 2>&1; printf '\nexit=%s\n' $?"]);
		expect(directRead.stdout).toContain("exit=1");
		expect(directRead.stdout).not.toContain("authorized");

		const directWrite = await sandbox.run([
			"/bin/sh",
			"-c",
			"printf bypass > '" + target + "' 2>&1; printf '\nexit=%s\n' $?",
		]);
		expect(directWrite.stdout).not.toContain("exit=0");
		expect(directWrite.stdout).not.toContain("bypass");
		expect(await readFile(target, "utf8")).toBe("authorized");

		await writeFile(
			join(sandbox.workDir, "unsigned.json"),
			JSON.stringify({ request: {}, operation: "external_write" }) + String.fromCharCode(10),
		);
		const unsigned = await sandbox.run([
			"/usr/bin/curl",
			"-sS",
			"--http0.9",
			"--max-time",
			"2",
			"--unix-socket",
			"/work/broker.sock",
			"--data-binary",
			"@/work/unsigned.json",
			"http://localhost/",
		]);
		expect(unsigned.stdout + unsigned.stderr).toContain("denied");

		const replay = (await send(socketPath, { request: request(params), operation: "external_write" })) as {
			denied: boolean;
		};
		expect(replay.denied).toBe(true);
		expect(operation).toHaveBeenCalledTimes(1);
		await server.stop();
	});
});
