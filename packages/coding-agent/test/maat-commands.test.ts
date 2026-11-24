import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GuardRequest, GuardVerdict, TehutiGuard } from "../src/governance/index.js";
import { runMaatCli } from "../src/maat/commands.js";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function makeIo() {
	let stdout = "";
	let stderr = "";
	const io = {
		stdout: (text: string) => {
			stdout += text;
		},
		stderr: (text: string) => {
			stderr += text;
		},
	};
	return {
		io,
		get stdout() {
			return stdout;
		},
		get stderr() {
			return stderr;
		},
	};
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "maat-commands-root-"));
	const home = await mkdtemp(join(tmpdir(), "maat-commands-home-"));
	roots.push(root, home);
	await mkdir(join(root, "soul"), { recursive: true });
	await mkdir(join(root, "maat-core"), { recursive: true });
	await mkdir(join(root, "maat-apps", "operator"), { recursive: true });
	await mkdir(join(root, "maat-packs", "policy-packs", "default"), { recursive: true });
	await writeFile(join(root, "MANIFEST.ka"), "manifest");
	await writeFile(join(root, "soul", "identity.yaml"), "name: maat");
	await writeFile(join(root, "maat-core", "config.yaml"), "adapters:\n  model: ollama\n");
	await writeFile(
		join(join(root, "maat-apps", "operator"), "manifest.json"),
		JSON.stringify({ name: "Operator", description: "Ops app" }),
	);
	await writeFile(
		join(join(root, "maat-packs", "policy-packs", "default"), "policy.json"),
		JSON.stringify({ name: "Default Policy", version: "1" }),
	);
	await writeFile(join(home, "identities.json"), JSON.stringify({ "agent-1": { name: "Alpha", ring: "inner-ring" } }));
	await writeFile(
		join(home, "events.jsonl"),
		'{"type":"policy.denied","severity":"warning","timestamp":"2026-11-23T18:00:00Z"}\n',
	);
	return { root, home };
}

describe("maat read-only commands", () => {
	it("lists and shows identities from the shared identity store", async () => {
		const { root, home } = await fixture();
		const list = makeIo();
		expect(await runMaatCli(["identity", "list"], { root, home }, list.io)).toBe(0);
		expect(list.stdout).toContain("agent-1");
		expect(list.stdout).toContain("Alpha");
		const show = makeIo();
		expect(await runMaatCli(["identity", "show", "agent-1"], { root, home }, show.io)).toBe(0);
		expect(show.stdout).toContain("Alpha");
		const missing = makeIo();
		expect(await runMaatCli(["identity", "show", "missing"], { root, home }, missing.io)).toBe(1);
		expect(missing.stderr).toContain("identity not found");
	});

	it("tails the existing event log without creating another database", async () => {
		const { root, home } = await fixture();
		const out = makeIo();
		expect(await runMaatCli(["events", "tail", "-n", "1"], { root, home }, out.io)).toBe(0);
		expect(out.stdout).toContain("policy.denied");
		expect(out.stdout).toContain("warning");
	});

	it("lists the existing app registry manifests", async () => {
		const { root, home } = await fixture();
		const out = makeIo();
		expect(await runMaatCli(["apps", "list"], { root, home }, out.io)).toBe(0);
		expect(out.stdout).toContain("Operator");
		expect(out.stdout).toContain("Ops app");
	});

	it("lists policy definitions and delegates decisions to the Guard interface", async () => {
		const { root, home } = await fixture();
		const list = makeIo();
		expect(await runMaatCli(["policy", "list"], { root, home }, list.io)).toBe(0);
		expect(list.stdout).toContain("Default Policy");

		const decide = vi.fn(
			async (_request: GuardRequest): Promise<GuardVerdict> => ({
				decision: "deny",
				reason: "guard denied",
			}),
		);
		const guard: TehutiGuard = { decide };
		const check = makeIo();
		expect(
			await runMaatCli(
				["policy", "check", "agent-1", "tool.execute", "--ring", "inner-ring", "--resource", "resource-x"],
				{ root, home },
				check.io,
				{ guard },
			),
		).toBe(1);
		expect(check.stdout).toContain("DENY");
		expect(decide).toHaveBeenCalledTimes(1);
		expect(decide.mock.calls[0][0].actor.agentId).toBe("agent-1");
		expect(decide.mock.calls[0][0].action).toBe("tool.execute");
	});

	it("fails closed when no Guard interface is configured", async () => {
		const { root, home } = await fixture();
		const out = makeIo();
		expect(await runMaatCli(["policy", "check", "agent-1", "tool.execute"], { root, home }, out.io)).toBe(1);
		expect(out.stderr).toContain("requires a configured Tehuti Guard");
	});
});
