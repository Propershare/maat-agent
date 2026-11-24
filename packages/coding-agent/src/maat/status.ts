import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface KaStatusOptions {
	root?: string;
	home?: string;
}

export interface KaStatusSnapshot {
	root: string;
	manifestPath: string;
	identityPath: string;
	configPath: string;
	manifestPresent: boolean;
	identityPresent: boolean;
	configPresent: boolean;
	agents: string[];
	events: number;
	model?: string;
	memory?: string;
	tools?: string;
	apps: string[];
	packs: Record<string, string[]>;
}

export interface KaStatusSource {
	read(): Promise<KaStatusSnapshot>;
}

async function readOptional(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function parseConfig(text: string | undefined): { model?: string; memory?: string; tools?: string } {
	if (!text) return {};
	const values: { model?: string; memory?: string; tools?: string } = {};
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(/^\s*(model|memory|tools):\s*(.+?)\s*$/);
		if (match && !values[match[1] as keyof typeof values]) {
			values[match[1] as keyof typeof values] = match[2];
		}
	}
	return values;
}

function parseAgents(text: string | undefined): string[] {
	if (!text) return [];
	try {
		const parsed = JSON.parse(text) as unknown;
		if (Array.isArray(parsed)) return parsed.map((value) => (typeof value === "string" ? value : String(value)));
		if (parsed && typeof parsed === "object") return Object.keys(parsed as Record<string, unknown>);
	} catch {
		return [];
	}
	return [];
}

async function listDirectories(path: string): Promise<string[]> {
	try {
		const entries = await readdir(path, { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function readPacks(root: string): Promise<Record<string, string[]>> {
	const packsRoot = join(root, "maat-packs");
	const result: Record<string, string[]> = {};
	for (const name of ["policy-packs", "tool-packs", "agent-packs", "learning-packs"]) {
		const entries = await listDirectories(join(packsRoot, name));
		if (entries.length > 0) result[name] = entries;
	}
	return result;
}

export class FilesystemKaStatusSource implements KaStatusSource {
	constructor(private readonly options: KaStatusOptions = {}) {}

	async read(): Promise<KaStatusSnapshot> {
		const root = this.options.root ?? process.env.MAAT_RUNTIME_ROOT ?? process.cwd();
		const home = this.options.home ?? process.env.MAAT_HOME ?? join(homedir(), ".maat");
		const manifestPath = join(root, "MANIFEST.ka");
		const identityPath = join(root, "soul", "identity.yaml");
		const configPath = join(root, "maat-core", "config.yaml");
		const config = parseConfig(await readOptional(configPath));
		const identities = parseAgents(await readOptional(join(home, "identities.json")));
		const eventsText = await readOptional(join(home, "events.jsonl"));
		const events = eventsText ? eventsText.split(/\r?\n/).filter((line) => line.trim().length > 0).length : 0;
		const apps = (await listDirectories(join(root, "maat-apps"))).filter((name) =>
			existsSync(join(root, "maat-apps", name, "manifest.json")),
		);
		return {
			root,
			manifestPath,
			identityPath,
			configPath,
			manifestPresent: existsSync(manifestPath),
			identityPresent: existsSync(identityPath),
			configPresent: existsSync(configPath),
			agents: identities,
			events,
			...config,
			apps,
			packs: await readPacks(root),
		};
	}
}

export function renderKaStatus(snapshot: KaStatusSnapshot): string {
	const lines = [
		"MAAT Ecosystem Status",
		"",
		`  Root:       ${snapshot.root}`,
		`  Config:     ${snapshot.configPresent ? snapshot.configPath : "not found"}`,
		`  Manifest:   ${snapshot.manifestPresent ? "loaded" : "missing"}`,
		`  Identity:   ${snapshot.identityPresent ? "loaded" : "missing"}`,
		`  Agents:     ${snapshot.agents.length} registered`,
		`  Events:     ${snapshot.events} total`,
	];
	if (snapshot.model) lines.push(`  Model:      ${snapshot.model}`);
	if (snapshot.memory) lines.push(`  Memory:     ${snapshot.memory}`);
	if (snapshot.tools) lines.push(`  Tools:      ${snapshot.tools}`);
	lines.push(`  Apps:       ${snapshot.apps.length} installed`);
	for (const app of snapshot.apps) lines.push(`              - ${app}`);
	for (const [name, entries] of Object.entries(snapshot.packs)) {
		lines.push(`  ${name}: ${entries.join(", ")}`);
	}
	return lines.join("\n") + "\n";
}

export interface MaatStatusIo {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

export async function runMaatStatus(
	options: KaStatusOptions = {},
	io: MaatStatusIo = { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
): Promise<number> {
	try {
		const snapshot = await new FilesystemKaStatusSource(options).read();
		io.stdout(renderKaStatus(snapshot));
		return 0;
	} catch (error) {
		io.stderr(`maat status failed: ${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
}
