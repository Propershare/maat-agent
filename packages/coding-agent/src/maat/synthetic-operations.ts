import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrokerOperation } from "../governance/security-broker-server.js";

export function createSyntheticOperations(root: string): Map<string, BrokerOperation> {
	const operations = new Map<string, BrokerOperation>();
	operations.set("synthetic_boot", {
		run: async (params) => {
			const payload = params as { seat?: string; agentId?: string };
			const dir = join(root, "boot");
			await mkdir(dir, { recursive: true });
			const record = { seat: payload.seat ?? "synthetic-seat", agentId: payload.agentId ?? "synthetic-agent" };
			await writeFile(join(dir, "session.json"), JSON.stringify(record) + "\n");
			return record;
		},
	});
	operations.set("synthetic_memory_write", {
		run: async (params) => {
			const payload = params as { content?: string; memoryClass?: string };
			const dir = join(root, "memory");
			await mkdir(dir, { recursive: true });
			const record = { content: payload.content ?? "", memoryClass: payload.memoryClass ?? "episodic" };
			await writeFile(join(dir, "memory.jsonl"), JSON.stringify(record) + "\n", { flag: "a" });
			return record;
		},
	});
	operations.set("synthetic_pack_install", {
		run: async (params) => {
			const payload = params as { source?: string; target?: string };
			if (!payload.source || !payload.target) throw new Error("source and target are required");
			await cp(payload.source, payload.target, { recursive: true });
			return { installed: payload.target };
		},
	});
	return operations;
}
