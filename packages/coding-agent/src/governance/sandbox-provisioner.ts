import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SandboxCapabilities {
	platform: NodeJS.Platform;
	bubblewrap: boolean;
	userNamespaces: boolean;
	backend: "bubblewrap" | null;
	reason?: string;
}

export interface SandboxRunResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface SandboxProvisionOptions {
	root?: string;
	allowedReadPaths?: string[];
}

export class SandboxProvisionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SandboxProvisionError";
	}
}

export function detectSandboxCapabilities(): SandboxCapabilities {
	const platform = process.platform;
	const bwrap = spawnSync("bwrap", ["--version"], { encoding: "utf8" });
	const unshare = spawnSync("unshare", ["--user", "--map-root-user", "true"], { encoding: "utf8" });
	const userNamespaces = unshare.status === 0;
	if (platform !== "linux") {
		return { platform, bubblewrap: bwrap.status === 0, userNamespaces, backend: null, reason: "Linux is required" };
	}
	if (bwrap.status !== 0) {
		return { platform, bubblewrap: false, userNamespaces, backend: null, reason: "bubblewrap is unavailable" };
	}
	if (!userNamespaces) {
		return {
			platform,
			bubblewrap: true,
			userNamespaces,
			backend: null,
			reason: "unprivileged user namespaces are unavailable",
		};
	}
	return { platform, bubblewrap: true, userNamespaces, backend: "bubblewrap" };
}

export class Sandbox {
	private closed = false;
	private constructor(
		readonly root: string,
		readonly workDir: string,
		readonly protectedDir: string,
		private readonly bwrapPath: string,
	) {}

	static async provision(options: SandboxProvisionOptions = {}): Promise<Sandbox> {
		const capabilities = detectSandboxCapabilities();
		if (capabilities.backend !== "bubblewrap") {
			throw new SandboxProvisionError(capabilities.reason ?? "no enforceable sandbox backend");
		}
		const root = options.root ?? (await mkdtemp(join(tmpdir(), "maat-sandbox-")));
		const workDir = join(root, "work");
		const protectedDir = join(root, "protected");
		await mkdir(workDir, { recursive: true, mode: 0o700 });
		await mkdir(protectedDir, { recursive: true, mode: 0o700 });
		await chmod(root, 0o700);
		await chmod(workDir, 0o700);
		await chmod(protectedDir, 0o700);
		return new Sandbox(root, workDir, protectedDir, "bwrap");
	}

	async writeProtectedFile(name: string, content: string): Promise<string> {
		if (name.includes("/") || name.includes("..")) throw new SandboxProvisionError("invalid protected filename");
		const path = join(this.protectedDir, name);
		await writeFile(path, content, { mode: 0o600 });
		return path;
	}

	async run(command: string[], env: Record<string, string> = {}): Promise<SandboxRunResult> {
		if (this.closed) throw new SandboxProvisionError("sandbox is closed");
		if (command.length === 0) throw new SandboxProvisionError("command is required");
		const args = [
			"--unshare-all",
			"--die-with-parent",
			"--ro-bind",
			"/usr",
			"/usr",
			"--ro-bind",
			"/bin",
			"/bin",
			"--ro-bind",
			"/lib",
			"/lib",
			"--ro-bind",
			"/lib64",
			"/lib64",
			"--proc",
			"/proc",
			"--dev",
			"/dev",
			"--tmpfs",
			"/tmp",
			"--bind",
			this.workDir,
			"/work",
			"--chdir",
			"/work",
			...command,
		];
		return await new Promise<SandboxRunResult>((resolve, reject) => {
			const child = spawn(this.bwrapPath, args, {
				cwd: this.workDir,
				env: { PATH: "/usr/bin:/bin", ...env },
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			child.on("error", reject);
			child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
		});
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await rm(this.root, { recursive: true, force: true });
	}
}
