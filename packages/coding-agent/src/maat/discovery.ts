import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import type { MaatCliIo } from "./commands.js";
import type { KaStatusOptions } from "./status.js";

export type PortProbe = (port: number, timeoutMs?: number) => Promise<boolean>;

export interface KaOrgan {
	name: string;
	port: number | null;
	type: "files" | "mcp" | "http" | "planned";
	path?: string;
	server?: string;
}

export const KA_ORGANS: readonly KaOrgan[] = [
	{ name: "soul", port: null, type: "files", path: "soul/" },
	{ name: "brain", port: 8014, type: "mcp", server: "tehuti-core" },
	{ name: "memory", port: 8022, type: "mcp", server: "maat-memory" },
	{ name: "hands", port: 8016, type: "mcp", server: "filesystem" },
	{ name: "senses", port: 8015, type: "mcp", server: "n8n" },
	{ name: "voice", port: null, type: "planned" },
	{ name: "ka", port: 8010, type: "http", server: "ka-discovery" },
	{ name: "skeleton", port: 8017, type: "mcp", server: "postgres" },
	{ name: "blood", port: 8020, type: "mcp", server: "pipeline" },
];

export async function probePort(port: number, timeoutMs = 500): Promise<boolean> {
	return await new Promise((resolve) => {
		const socket = connect({ host: "127.0.0.1", port });
		let settled = false;
		const finish = (value: boolean) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(value);
		};
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => finish(true));
		socket.once("timeout", () => finish(false));
		socket.once("error", () => finish(false));
	});
}

function resolveRoot(options: KaStatusOptions): string {
	return options.root ?? process.env.MAAT_RUNTIME_ROOT ?? process.cwd();
}

export async function runOrgansCommand(
	options: KaStatusOptions,
	io: MaatCliIo,
	probe: PortProbe = probePort,
): Promise<number> {
	const root = resolveRoot(options);
	io.stdout("MAAT Ka Organs\n");
	for (const organ of KA_ORGANS) {
		let status: string;
		if (organ.port !== null) {
			status = (await probe(organ.port)) ? `online :${organ.port}` : `offline :${organ.port}`;
		} else if (organ.type === "files") {
			status = existsSync(join(root, organ.path ?? "")) ? "files present" : "files missing";
		} else {
			status = "planned";
		}
		io.stdout(`  ${organ.name.padEnd(10)} ${status.padEnd(18)} ${organ.server ?? ""}\n`);
	}
	return 0;
}

export async function runHealthCommand(
	_options: KaStatusOptions,
	io: MaatCliIo,
	probe: PortProbe = probePort,
): Promise<number> {
	const portOrgans = KA_ORGANS.filter((organ): organ is KaOrgan & { port: number } => organ.port !== null);
	let alive = 0;
	io.stdout("MAAT Ka Health\n");
	for (const organ of portOrgans) {
		const up = await probe(organ.port);
		if (up) alive += 1;
		io.stdout(`  ${up ? "OK" : "DEAD"} ${organ.name.padEnd(10)} :${organ.port}\n`);
	}
	const overall = alive === portOrgans.length ? "HEALTHY" : alive > portOrgans.length / 2 ? "DEGRADED" : "CRITICAL";
	io.stdout(`  Score: ${alive}/${portOrgans.length} - ${overall}\n`);
	return 0;
}
