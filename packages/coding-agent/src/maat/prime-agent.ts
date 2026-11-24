import type { CodingSessionRunner, OrchestratorGuard } from "./orchestrator.js";

export interface PrimeAgentSessionLike {
	promptAndWait(text: string): Promise<void>;
	getLastAssistantText(): string | undefined;
}

export interface PrimeAgentDaemonLike {
	promptAndWait(message: string): Promise<void>;
	getMessages(): Promise<readonly unknown[]>;
}

function promptFor(input: { request: string; taskId: string; context: Record<string, unknown> }): string {
	const research = input.context.research;
	if (research === undefined) return input.request;
	return input.request + "\n\nResearch findings:\n" + JSON.stringify(research, null, 2);
}

function extractText(message: unknown): string {
	if (typeof message === "string") return message;
	if (!message || typeof message !== "object") return "";
	const record = message as { role?: unknown; content?: unknown };
	if (record.role !== "assistant") return "";
	if (typeof record.content === "string") return record.content;
	if (!Array.isArray(record.content)) return "";
	return record.content
		.map((part) =>
			part && typeof part === "object" && (part as { type?: unknown }).type === "text"
				? String((part as { text?: unknown }).text ?? "")
				: "",
		)
		.join("");
}

function lastAssistantText(messages: readonly unknown[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const text = extractText(messages[index]);
		if (text.trim()) return text.trim();
	}
	return "";
}

export class PrimeAgentSessionRunner implements CodingSessionRunner {
	constructor(private readonly session: PrimeAgentSessionLike) {}

	async run(input: { request: string; taskId: string; context: Record<string, unknown> }): Promise<unknown> {
		await this.session.promptAndWait(promptFor(input));
		return {
			taskId: input.taskId,
			source: "prime-agent-session",
			text: this.session.getLastAssistantText() ?? "",
		};
	}
}

export class PrimeAgentDaemonRunner implements CodingSessionRunner {
	constructor(private readonly connection: PrimeAgentDaemonLike) {}

	async run(input: { request: string; taskId: string; context: Record<string, unknown> }): Promise<unknown> {
		await this.connection.promptAndWait(promptFor(input));
		const messages = await this.connection.getMessages();
		return {
			taskId: input.taskId,
			source: "prime-agent-daemon",
			text: lastAssistantText(messages),
		};
	}
}

export class GovernedCodingRunner implements CodingSessionRunner {
	constructor(
		private readonly runner: CodingSessionRunner,
		private readonly guard: OrchestratorGuard,
	) {}

	async run(input: { request: string; taskId: string; context: Record<string, unknown> }): Promise<unknown> {
		const decision = await this.guard.authorize({
			actorId: "maat-orchestrator",
			action: "agent.execute",
			resource: "maat-coding-agent",
			taskId: input.taskId,
		});
		if (!decision.allowed) throw new Error("coding execution denied: " + decision.reason);
		return await this.runner.run(input);
	}
}
