import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MaatCliIo } from "./commands.js";
import type { KaStatusOptions } from "./status.js";

interface SeatRegistry {
	seats?: unknown;
}

export async function runSeatsCommand(args: string[], options: KaStatusOptions, io: MaatCliIo): Promise<number> {
	const [subcommand = "list"] = args;
	if (subcommand !== "list") {
		io.stderr("usage: maat seats list\n");
		return 1;
	}
	const root = options.root ?? process.env.MAAT_RUNTIME_ROOT ?? process.cwd();
	const path = process.env.MAAT_SEAT_REGISTRY ?? join(root, "seats", "REGISTRY.json");
	let registry: SeatRegistry;
	try {
		registry = JSON.parse(await readFile(path, "utf8")) as SeatRegistry;
	} catch (error) {
		io.stderr(`seat registry unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
	const seats = Array.isArray(registry.seats)
		? registry.seats.filter((seat): seat is string => typeof seat === "string")
		: [];
	if (seats.length === 0) {
		io.stdout("No seats registered.\n");
		return 0;
	}
	for (const seat of seats) io.stdout(`  ${seat}\n`);
	return 0;
}
