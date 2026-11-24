import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemKaStatusSource, renderKaStatus, runMaatStatus } from "../src/maat/status.js";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "maat-status-root-"));
	const home = await mkdtemp(join(tmpdir(), "maat-status-home-"));
	roots.push(root, home);
	await mkdir(join(root, "soul"), { recursive: true });
	await mkdir(join(root, "maat-core"), { recursive: true });
	await mkdir(join(root, "maat-apps", "operator"), { recursive: true });
	await mkdir(join(root, "maat-apps", "receptionist"), { recursive: true });
	await mkdir(join(root, "maat-packs", "policy-packs", "default"), { recursive: true });
	await mkdir(join(root, "maat-packs", "tool-packs", "filesystem"), { recursive: true });
	await writeFile(join(root, "MANIFEST.ka"), "manifest");
	await writeFile(join(root, "soul", "identity.yaml"), "name: maat");
	await writeFile(
		join(root, "maat-core", "config.yaml"),
		"adapters:\n  model: ollama\n  memory: postgres\n  tools: mcp\n",
	);
	await writeFile(join(root, "maat-apps", "operator", "manifest.json"), "{}");
	await writeFile(join(root, "maat-apps", "receptionist", "manifest.json"), "{}");
	await writeFile(
		join(home, "identities.json"),
		JSON.stringify({ "agent-1": { name: "A" }, "agent-2": { name: "B" } }),
	);
	await writeFile(join(home, "events.jsonl"), '{"type":"a"}\n{"type":"b"}\n');
	return { root, home };
}

describe("maat status adapter", () => {
	it("reads the established Ka filesystem contract without the Pi Mono runtime", async () => {
		const { root, home } = await fixture();
		const snapshot = await new FilesystemKaStatusSource({ root, home }).read();
		expect(snapshot.manifestPresent).toBe(true);
		expect(snapshot.identityPresent).toBe(true);
		expect(snapshot.agents).toEqual(["agent-1", "agent-2"]);
		expect(snapshot.events).toBe(2);
		expect(snapshot.model).toBe("ollama");
		expect(snapshot.memory).toBe("postgres");
		expect(snapshot.tools).toBe("mcp");
		expect(snapshot.apps).toEqual(["operator", "receptionist"]);
		expect(snapshot.packs["policy-packs"]).toEqual(["default"]);
		const output = renderKaStatus(snapshot);
		expect(output).toContain("MAAT Ecosystem Status");
		expect(output).toContain("Agents:     2 registered");
		expect(output).toContain("Events:     2 total");
		expect(output).toContain("operator");
	});

	it("runMaatStatus returns success and writes status independently of any original runtime", async () => {
		const { root, home } = await fixture();
		let stdout = "";
		let stderr = "";
		const code = await runMaatStatus(
			{ root, home },
			{
				stdout: (text) => {
					stdout += text;
				},
				stderr: (text) => {
					stderr += text;
				},
			},
		);
		expect(code).toBe(0);
		expect(stderr).toBe("");
		expect(stdout).toContain("MAAT Ecosystem Status");
		expect(stdout).toContain("Config:");
	});

	it("fails clearly when the Ka root is missing", async () => {
		const root = await mkdtemp(join(tmpdir(), "maat-status-missing-"));
		roots.push(root);
		let stderr = "";
		const code = await runMaatStatus(
			{ root, home: root },
			{
				stdout: () => {},
				stderr: (text) => {
					stderr += text;
				},
			},
		);
		expect(code).toBe(0);
		expect(stderr).toBe("");
	});
});
