import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentRing, GuardRequest, GuardVerdict, TehutiGuard } from "../governance/index.js";
import { type PortProbe, runHealthCommand, runOrgansCommand } from "./discovery.js";
import { type MemorySearchSource, runMemoryCommand } from "./memory.js";
import { runPacksCommand } from "./packs.js";
import { runSeatsCommand } from "./seats.js";
import type { KaStatusOptions } from "./status.js";

export interface MaatCliIo {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

export interface MaatCliDependencies {
	guard?: TehutiGuard;
	probe?: PortProbe;
	memory?: MemorySearchSource;
}

interface IdentityEntry {
	id: string;
	value: unknown;
	name?: string;
	ring?: string;
}

function resolvePaths(options: KaStatusOptions): { root: string; home: string } {
	return {
		root: options.root ?? process.env.MAAT_RUNTIME_ROOT ?? process.cwd(),
		home: options.home ?? process.env.MAAT_HOME ?? join(homedir(), ".maat"),
	};
}

async function readOptional(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

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

function parseIdentities(text: string | undefined): IdentityEntry[] {
	if (!text) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return [];
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
	return Object.entries(parsed as Record<string, unknown>).map(([id, value]) => {
		const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
		return {
			id,
			value,
			name: typeof record.name === "string" ? record.name : undefined,
			ring: typeof record.ring === "string" ? record.ring : undefined,
		};
	});
}

function parseEvents(text: string | undefined, limit: number): Array<Record<string, unknown>> {
	if (!text) return [];
	const events: Array<Record<string, unknown>> = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
				events.push(parsed as Record<string, unknown>);
		} catch {
			// Keep the CLI read-only and tolerant of a partially written event log.
		}
	}
	return events.slice(-Math.max(1, limit));
}

async function readApps(root: string): Promise<Array<{ id: string; name: string; description: string }>> {
	const appsRoot = join(root, "maat-apps");
	const ids = await listDirectories(appsRoot);
	const apps: Array<{ id: string; name: string; description: string }> = [];
	for (const id of ids) {
		const manifestPath = join(appsRoot, id, "manifest.json");
		if (!existsSync(manifestPath)) continue;
		const text = await readOptional(manifestPath);
		let manifest: Record<string, unknown> = {};
		try {
			if (text) manifest = JSON.parse(text) as Record<string, unknown>;
		} catch {
			manifest = {};
		}
		apps.push({
			id,
			name: typeof manifest.name === "string" ? manifest.name : id,
			description: typeof manifest.description === "string" ? manifest.description : "",
		});
	}
	return apps;
}

async function readPolicyPacks(root: string): Promise<Array<{ id: string; name?: string; version?: string }>> {
	const packsRoot = join(root, "maat-packs", "policy-packs");
	const ids = await listDirectories(packsRoot);
	const packs: Array<{ id: string; name?: string; version?: string }> = [];
	for (const id of ids) {
		const path = join(packsRoot, id, "policy.json");
		const text = await readOptional(path);
		if (!text) {
			packs.push({ id });
			continue;
		}
		try {
			const parsed = JSON.parse(text) as Record<string, unknown>;
			packs.push({
				id,
				name: typeof parsed.name === "string" ? parsed.name : undefined,
				version: typeof parsed.version === "string" ? parsed.version : undefined,
			});
		} catch {
			packs.push({ id });
		}
	}
	return packs;
}

export async function runIdentityCommand(args: string[], options: KaStatusOptions, io: MaatCliIo): Promise<number> {
	const [subcommand = "list", id] = args;
	const { home } = resolvePaths(options);
	const identities = parseIdentities(await readOptional(join(home, "identities.json")));
	if (subcommand === "list") {
		if (identities.length === 0) {
			io.stdout("No identities registered.\n");
			return 0;
		}
		for (const identity of identities) {
			const details = [identity.name, identity.ring].filter(Boolean).join(", ");
			io.stdout(`  ${identity.id}${details ? ` (${details})` : ""}\n`);
		}
		return 0;
	}
	if (subcommand === "show") {
		if (!id) {
			io.stderr("usage: maat identity show <id>\n");
			return 1;
		}
		const identity = identities.find((entry) => entry.id === id);
		if (!identity) {
			io.stderr(`identity not found: ${id}\n`);
			return 1;
		}
		io.stdout(JSON.stringify(identity.value, null, 2) + "\n");
		return 0;
	}
	io.stderr("usage: maat identity [list|show <id>]\n");
	return 1;
}

export async function runEventsCommand(args: string[], options: KaStatusOptions, io: MaatCliIo): Promise<number> {
	const [subcommand = "tail", ...rest] = args;
	if (subcommand !== "tail") {
		io.stderr("usage: maat events tail [-n N]\n");
		return 1;
	}
	let limit = 20;
	const nIndex = rest.findIndex((arg) => arg === "-n" || arg === "--lines");
	const value = nIndex >= 0 ? rest[nIndex + 1] : undefined;
	if (value) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed) && parsed > 0) limit = parsed;
	}
	const { home } = resolvePaths(options);
	const events = parseEvents(await readOptional(join(home, "events.jsonl")), limit);
	if (events.length === 0) {
		io.stdout("No events yet.\n");
		return 0;
	}
	for (const event of events) {
		const severity = typeof event.severity === "string" ? event.severity : "info";
		const type = typeof event.type === "string" ? event.type : "?";
		const timestamp = typeof event.timestamp === "string" ? event.timestamp : "";
		io.stdout(`  [${severity}] ${type}  ${timestamp}\n`);
	}
	return 0;
}

export async function runAppsCommand(args: string[], options: KaStatusOptions, io: MaatCliIo): Promise<number> {
	const [subcommand = "list"] = args;
	if (subcommand !== "list") {
		io.stderr("usage: maat apps list\n");
		return 1;
	}
	const { root } = resolvePaths(options);
	const apps = await readApps(root);
	if (apps.length === 0) {
		io.stdout("No apps installed.\n");
		return 0;
	}
	for (const app of apps) {
		io.stdout(`  ${app.name.padEnd(20)} ${app.description}\n`);
	}
	return 0;
}

export async function runPolicyCommand(
	args: string[],
	options: KaStatusOptions,
	io: MaatCliIo,
	deps: MaatCliDependencies,
): Promise<number> {
	const [subcommand = "list"] = args;
	const { root } = resolvePaths(options);
	if (subcommand === "list") {
		const packs = await readPolicyPacks(root);
		if (packs.length === 0) {
			io.stdout("No policy packs installed.\n");
			return 0;
		}
		for (const pack of packs) {
			const details = [pack.name, pack.version ? `v${pack.version}` : undefined].filter(Boolean).join(" ");
			io.stdout(`  ${pack.id}${details ? ` (${details})` : ""}\n`);
		}
		return 0;
	}
	if (subcommand !== "check") {
		io.stderr("usage: maat policy [list|check <agent> <action> --ring <ring> --resource <resource>]\n");
		return 1;
	}
	const [agent, action, ...rest] = args.slice(1);
	if (!agent || !action) {
		io.stderr("usage: maat policy check <agent> <action> --ring <ring> --resource <resource>\n");
		return 1;
	}
	if (!deps.guard) {
		io.stderr("policy decision requires a configured Tehuti Guard interface\n");
		return 1;
	}
	const ringValue =
		rest.find((arg) => arg.startsWith("--ring="))?.slice(7) ??
		(rest.includes("--ring") ? rest[rest.indexOf("--ring") + 1] : undefined);
	const resource =
		rest.find((arg) => arg.startsWith("--resource="))?.slice(11) ??
		(rest.includes("--resource") ? rest[rest.indexOf("--resource") + 1] : undefined) ??
		"";
	if (ringValue && !["inner-ring", "middle-ring", "outer-ring"].includes(ringValue)) {
		io.stderr(`invalid ring: ${ringValue}\n`);
		return 1;
	}
	const request: GuardRequest = {
		actor: { agentId: agent, ring: (ringValue as AgentRing | undefined) ?? "inner-ring" },
		action,
		resource,
		params: {},
		metadata: { source: "maat-cli" },
	};
	let verdict: GuardVerdict;
	try {
		verdict = await deps.guard.decide(request);
	} catch (error) {
		io.stderr(`Guard decision failed: ${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
	const marker = verdict.decision === "allow" ? "ALLOW" : verdict.decision.toUpperCase();
	io.stdout(`${marker}: ${verdict.reason}\n`);
	return verdict.decision === "allow" ? 0 : 1;
}

export async function runAgentsCommand(args: string[], options: KaStatusOptions, io: MaatCliIo): Promise<number> {
	const [subcommand = "list"] = args;
	if (subcommand !== "list") {
		io.stderr("usage: maat agents list\n");
		return 1;
	}
	return await runIdentityCommand(["list"], options, io);
}

export async function runMaatCli(
	argv: string[],
	options: KaStatusOptions,
	io: MaatCliIo,
	deps: MaatCliDependencies = {},
): Promise<number> {
	const [command = "status", ...args] = argv;
	switch (command) {
		case "status":
			return await (await import("./status.js")).runMaatStatus(options, io);
		case "identity":
			return await runIdentityCommand(args, options, io);
		case "events":
			return await runEventsCommand(args, options, io);
		case "apps":
			return await runAppsCommand(args, options, io);
		case "organs":
			return await runOrgansCommand(options, io, deps.probe);
		case "health":
			return await runHealthCommand(options, io, deps.probe);
		case "agents":
			return await runAgentsCommand(args, options, io);
		case "memory":
			return await runMemoryCommand(args, options, io, deps.memory);
		case "packs":
			return await runPacksCommand(args, options, io);
		case "seats":
			return await runSeatsCommand(args, options, io);
		case "policy":
			return await runPolicyCommand(args, options, io, deps);
		default:
			io.stderr("usage: maat [status|identity|policy|events|apps]\n");
			return 1;
	}
}
