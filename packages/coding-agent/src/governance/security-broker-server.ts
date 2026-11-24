import { chmod, mkdir, unlink } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { dirname } from "node:path";
import { type BrokerRequest, type BrokerResult, SideEffectBroker } from "./broker.js";

export interface BrokerOperation {
	run(params: unknown): Promise<unknown> | unknown;
}

export interface SecurityBrokerServerOptions {
	socketPath: string;
	identitySecret: string;
	maxTtlMs: number;
	replayStore: ConstructorParameters<typeof SideEffectBroker>[0]["replayStore"];
	operations: Map<string, BrokerOperation>;
}

interface WireRequest {
	request: BrokerRequest;
	operation: string;
}

export class SecurityBrokerServer {
	private server: Server | undefined;
	private readonly broker: SideEffectBroker;

	constructor(private readonly options: SecurityBrokerServerOptions) {
		this.broker = new SideEffectBroker({
			identitySecret: options.identitySecret,
			maxTtlMs: options.maxTtlMs,
			replayStore: options.replayStore,
		});
	}

	async start(): Promise<void> {
		if (this.server) throw new Error("security broker already started");
		await mkdir(dirname(this.options.socketPath), { recursive: true, mode: 0o700 });
		try {
			await unlink(this.options.socketPath);
		} catch {
			// Socket path may not exist; cleanup is best effort.
		}
		this.server = createServer((socket) => {
			let buffer = "";
			socket.setEncoding("utf8");
			socket.on("data", (chunk: string) => {
				buffer += chunk;
				const newline = buffer.indexOf("\n");
				if (newline < 0) return;
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				void this.handle(line, socket);
			});
		});
		await new Promise<void>((resolve, reject) => {
			this.server?.once("error", reject);
			this.server?.listen(this.options.socketPath, () => resolve());
		});
		await chmod(this.options.socketPath, 0o600);
	}

	private async handle(line: string, socket: import("node:net").Socket): Promise<void> {
		let response: BrokerResult | { ok: false; denied: true; executed: false; reason: string };
		try {
			const message = JSON.parse(line) as WireRequest;
			const operation = this.options.operations.get(message.operation);
			if (!operation || message.operation !== message.request.toolName) {
				response = { ok: false, denied: true, executed: false, reason: "operation not allowlisted" };
			} else {
				response = await this.broker.execute(message.request, () => operation.run(message.request.params));
			}
		} catch (error) {
			response = {
				ok: false,
				denied: true,
				executed: false,
				reason: error instanceof Error ? error.message : String(error),
			};
		}
		socket.end(JSON.stringify(response) + "\n");
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		if (!server) return;
		await new Promise<void>((resolve) => server.close(() => resolve()));
		try {
			await unlink(this.options.socketPath);
		} catch {
			// Socket path may not exist; cleanup is best effort.
		}
	}
}
