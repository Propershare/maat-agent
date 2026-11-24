import { homedir } from "node:os";
import { join } from "node:path";
import type { MaatCliIo } from "./commands.js";
import type { KaStatusOptions } from "./status.js";

export interface MemoryHit {
	memoryClass: string;
	content: string;
	timestamp: string;
	agentId?: string;
}

export interface MemorySearchSource {
	search(query: string, limit: number): Promise<MemoryHit[]>;
}

export class SqliteMemorySearchSource implements MemorySearchSource {
	constructor(private readonly path: string) {}

	async search(query: string, limit: number): Promise<MemoryHit[]> {
		const sqlite = await import("node:sqlite");
		const db = new sqlite.DatabaseSync(this.path, { readOnly: true });
		try {
			const statement = db.prepare(
				"SELECT agent_id, memory_class, content, timestamp FROM maat_memories WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?",
			);
			const rows = statement.all("%" + query + "%", Math.max(1, limit)) as Array<{
				agent_id?: string;
				memory_class?: string;
				content?: string;
				timestamp?: string;
			}>;
			return rows.map((row) => ({
				memoryClass: row.memory_class ?? "?",
				content: row.content ?? "",
				timestamp: row.timestamp ?? "",
				agentId: row.agent_id,
			}));
		} finally {
			db.close();
		}
	}
}

export async function runMemoryCommand(
	args: string[],
	options: KaStatusOptions,
	io: MaatCliIo,
	source?: MemorySearchSource,
): Promise<number> {
	const [subcommand = "search", ...rest] = args;
	if (subcommand !== "search") {
		io.stderr("usage: maat memory search <query> [-n N]\n");
		return 1;
	}
	const query = rest.find((arg) => !arg.startsWith("-"));
	if (!query) {
		io.stderr("usage: maat memory search <query> [-n N]\n");
		return 1;
	}
	let limit = 5;
	const limitFlag = rest.findIndex((arg) => arg === "-n" || arg === "--limit");
	if (limitFlag >= 0) {
		const parsed = Number.parseInt(rest[limitFlag + 1] ?? "", 10);
		if (Number.isFinite(parsed) && parsed > 0) limit = parsed;
	}
	const home = options.home ?? process.env.MAAT_HOME ?? join(homedir(), ".maat");
	const memorySource = source ?? new SqliteMemorySearchSource(join(home, "memory.db"));
	try {
		const results = await memorySource.search(query, limit);
		if (results.length === 0) {
			io.stdout("No memories found.\n");
			return 0;
		}
		for (const result of results) {
			io.stdout(`  [${result.memoryClass}] ${result.content.slice(0, 120)}\n`);
			io.stdout(`    @ ${result.timestamp}\n`);
		}
		return 0;
	} catch (error) {
		io.stderr(`memory search failed: ${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
}
