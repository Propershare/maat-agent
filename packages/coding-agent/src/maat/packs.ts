import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { MaatCliIo } from "./commands.js";
import type { KaStatusOptions } from "./status.js";

const PACK_TYPES = ["policy-packs", "tool-packs", "agent-packs", "learning-packs"] as const;

async function listDirectories(path: string): Promise<string[]> {
	try {
		const entries = await readdir(path, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

export async function runPacksCommand(args: string[], options: KaStatusOptions, io: MaatCliIo): Promise<number> {
	const [subcommand = "list"] = args;
	if (subcommand !== "list") {
		io.stderr("usage: maat packs list\n");
		return 1;
	}
	const root = options.root ?? process.env.MAAT_RUNTIME_ROOT ?? process.cwd();
	const bases = [join(root, "maat-packs"), join(root, "blood", "packs")];
	let printed = false;
	for (const base of bases) {
		for (const type of PACK_TYPES) {
			const entries = await listDirectories(join(base, type));
			if (entries.length === 0) continue;
			printed = true;
			io.stdout(`  ${type}: ${entries.join(", ")}\n`);
		}
	}
	if (!printed) io.stdout("No packs installed.\n");
	return 0;
}
