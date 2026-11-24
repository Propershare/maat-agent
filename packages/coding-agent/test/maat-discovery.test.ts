import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMaatCli } from "../src/maat/commands.js";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function makeIo() {
	let stdout = "";
	let stderr = "";
	return {
		io: {
			stdout: (text: string) => {
				stdout += text;
			},
			stderr: (text: string) => {
				stderr += text;
			},
		},
		get stdout() {
			return stdout;
		},
		get stderr() {
			return stderr;
		},
	};
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "maat-discovery-root-"));
	const home = await mkdtemp(join(tmpdir(), "maat-discovery-home-"));
	roots.push(root, home);
	await mkdir(join(root, "soul"), { recursive: true });
	await writeFile(join(root, "MANIFEST.ka"), "manifest");
	await writeFile(join(root, "soul", "identity.yaml"), "name: maat");
	await writeFile(join(home, "identities.json"), JSON.stringify({ "agent-1": { name: "Alpha", ring: "inner-ring" } }));
	return { root, home };
}

describe("maat Ka discovery commands", () => {
	it("lists all nine existing Ka organs and preserves the contract", async () => {
		const { root, home } = await fixture();
		const probe = vi.fn(async (port: number) => port === 8010);
		const output = makeIo();
		expect(await runMaatCli(["organs"], { root, home }, output.io, { probe })).toBe(0);
		for (const name of ["soul", "brain", "memory", "hands", "senses", "voice", "ka", "skeleton", "blood"]) {
			expect(output.stdout).toContain(name);
		}
		expect(output.stdout).toContain("online :8010");
		expect(output.stdout).toContain("offline :8014");
		expect(probe).toHaveBeenCalledTimes(7);
	});

	it("reports health using an injected probe without opening real ports", async () => {
		const { root, home } = await fixture();
		const probe = vi.fn(async () => true);
		const output = makeIo();
		expect(await runMaatCli(["health"], { root, home }, output.io, { probe })).toBe(0);
		expect(output.stdout).toContain("Score: 7/7 - HEALTHY");
	});

	it("lists agents from the existing identity store", async () => {
		const { root, home } = await fixture();
		const output = makeIo();
		expect(await runMaatCli(["agents", "list"], { root, home }, output.io)).toBe(0);
		expect(output.stdout).toContain("agent-1");
		expect(output.stdout).toContain("Alpha");
	});
});
