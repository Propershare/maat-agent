import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMaatCli } from "../src/maat/commands.js";
import type { MemorySearchSource } from "../src/maat/memory.js";

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
	const root = await mkdtemp(join(tmpdir(), "maat-memory-root-"));
	const home = await mkdtemp(join(tmpdir(), "maat-memory-home-"));
	roots.push(root, home);
	await mkdir(join(root, "maat-packs", "policy-packs", "default"), { recursive: true });
	await mkdir(join(root, "maat-packs", "tool-packs", "filesystem"), { recursive: true });
	await mkdir(join(root, "blood", "packs", "agent-packs", "tehuti"), { recursive: true });
	await mkdir(join(root, "seats"), { recursive: true });
	await writeFile(join(root, "maat-packs", "policy-packs", "default", "policy.json"), "{}");
	await writeFile(join(root, "maat-packs", "tool-packs", "filesystem", "manifest.json"), "{}");
	await writeFile(
		join(root, "seats", "REGISTRY.json"),
		JSON.stringify({ seats: ["coder_staydang_01", "lab_it_staydang_01"] }),
	);
	return { root, home };
}

describe("maat memory, packs, and seats", () => {
	it("searches through an injected existing-memory source without writing", async () => {
		const { root, home } = await fixture();
		const search = vi.fn(async () => [
			{ memoryClass: "episodic", content: "alpha memory", timestamp: "2026-11-23T18:00:00Z" },
		]);
		const memory: MemorySearchSource = { search };
		const output = makeIo();
		expect(await runMaatCli(["memory", "search", "alpha", "-n", "1"], { root, home }, output.io, { memory })).toBe(0);
		expect(search).toHaveBeenCalledWith("alpha", 1);
		expect(output.stdout).toContain("alpha memory");
		expect(output.stdout).toContain("[episodic]");
	});

	it("lists existing packs without creating a registry", async () => {
		const { root, home } = await fixture();
		const output = makeIo();
		expect(await runMaatCli(["packs", "list"], { root, home }, output.io)).toBe(0);
		expect(output.stdout).toContain("policy-packs: default");
		expect(output.stdout).toContain("tool-packs: filesystem");
		expect(output.stdout).toContain("agent-packs: tehuti");
	});

	it("lists existing seat registry entries read-only", async () => {
		const { root, home } = await fixture();
		const output = makeIo();
		expect(await runMaatCli(["seats", "list"], { root, home }, output.io)).toBe(0);
		expect(output.stdout).toContain("coder_staydang_01");
		expect(output.stdout).toContain("lab_it_staydang_01");
	});
});
