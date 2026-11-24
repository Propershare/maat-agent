import { randomUUID } from "node:crypto";
import type { K2Researcher, ResearchResult } from "./researcher.js";

export type MaatTaskKind = "research" | "development" | "research-and-development";
export type MaatTaskStatus = "queued" | "running" | "completed" | "denied" | "failed";

export interface MaatTask {
	id: string;
	request: string;
	kind: MaatTaskKind;
	status: MaatTaskStatus;
	assignedAgentId?: string;
	methods?: readonly string[];
	sourceChannels?: readonly string[];
	context: Record<string, unknown>;
	output?: unknown;
	error?: string;
	createdAt: string;
	updatedAt: string;
}

export type MaatCapability = "research" | "development";

export interface MaatAgent {
	readonly id: string;
	readonly capabilities: readonly MaatCapability[];
	execute(task: MaatTask): Promise<unknown>;
}

export interface OrchestratorGuard {
	authorize(input: {
		actorId: string;
		action: string;
		resource: string;
		taskId: string;
	}): Promise<{ allowed: boolean; reason: string }>;
}

export interface OrchestratorRequest {
	request: string;
	kind?: MaatTaskKind;
	agentId?: string;
	methods?: readonly string[];
	sourceChannels?: readonly string[];
	context?: Record<string, unknown>;
}

export interface OrchestratorResult {
	task: MaatTask;
	output?: unknown;
}

export interface OrchestratorOptions {
	guard?: OrchestratorGuard;
}

export class OrchestrationDeniedError extends Error {}
export class UnknownAgentError extends Error {}

const RESEARCH_AGENT_ID = "k2-master-researcher";
const CODING_AGENT_ID = "maat-coding-agent";

function now(): string {
	return new Date().toISOString();
}

function requiresDevelopment(kind: MaatTaskKind): boolean {
	return kind === "development" || kind === "research-and-development";
}

function inferKind(text: string): MaatTaskKind {
	const lower = text.toLowerCase();
	const development = /\b(build|implement|fix|code|refactor|test|patch|repository|repo|software)\b/.test(lower);
	const research = /\b(research|study|evidence|source|analy[sz]e|investigate|literature)\b/.test(lower);
	if (development && research) return "research-and-development";
	if (development) return "development";
	if (research) return "research";
	return "research-and-development";
}

export class K2Agent implements MaatAgent {
	readonly id = RESEARCH_AGENT_ID;
	readonly capabilities: readonly MaatCapability[] = ["research"];

	constructor(private readonly researcher: K2Researcher) {}

	async execute(task: MaatTask): Promise<ResearchResult> {
		return await this.researcher.research({
			question: task.request,
			methods: task.methods,
			sourceChannels: task.sourceChannels,
		});
	}
}

export interface CodingSessionRunner {
	run(input: { request: string; taskId: string; context: Record<string, unknown> }): Promise<unknown>;
}

export class CodingAgent implements MaatAgent {
	readonly id = CODING_AGENT_ID;
	readonly capabilities: readonly MaatCapability[] = ["development"];

	constructor(private readonly runner: CodingSessionRunner) {}

	async execute(task: MaatTask): Promise<unknown> {
		return await this.runner.run({
			request: task.request,
			taskId: task.id,
			context: task.context,
		});
	}
}

export class MaatOrchestrator {
	private readonly agents = new Map<string, MaatAgent>();
	private readonly tasks = new Map<string, MaatTask>();

	constructor(private readonly options: OrchestratorOptions = {}) {}

	registerAgent(agent: MaatAgent): void {
		this.agents.set(agent.id, agent);
	}

	listAgents(): Array<{ id: string; capabilities: readonly MaatCapability[] }> {
		return [...this.agents.values()].map((agent) => ({
			id: agent.id,
			capabilities: agent.capabilities,
		}));
	}

	getTask(taskId: string): MaatTask | undefined {
		return this.tasks.get(taskId);
	}

	listTasks(): MaatTask[] {
		return [...this.tasks.values()];
	}

	async submit(input: OrchestratorRequest): Promise<OrchestratorResult> {
		const request = input.request?.trim();
		if (!request) throw new Error("orchestrator request is required");
		const kind = input.kind ?? inferKind(request);
		const task: MaatTask = {
			id: randomUUID(),
			request,
			kind,
			status: "queued",
			methods: input.methods,
			sourceChannels: input.sourceChannels,
			context: { ...(input.context ?? {}) },
			createdAt: now(),
			updatedAt: now(),
		};

		this.tasks.set(task.id, task);
		try {
			const assigned = this.resolveAgents(input, kind);
			let output: unknown;
			if (kind === "research-and-development") {
				const researchAgent = assigned.find((agent) => agent.capabilities.includes("research"));
				const codingAgent = assigned.find((agent) => agent.capabilities.includes("development"));
				if (!researchAgent || !codingAgent) {
					throw new UnknownAgentError("research-and-development requires research and development agents");
				}
				const research = await this.runAgent(task, researchAgent, "research");
				task.context.research = research;
				output = await this.runAgent(task, codingAgent, "development");
			} else {
				const agent = assigned[0];
				if (!agent) throw new UnknownAgentError("no suitable agent is registered");
				output = await this.runAgent(task, agent, kind);
			}
			task.status = "completed";
			task.output = output;
			task.updatedAt = now();
			return { task, output };
		} catch (error) {
			task.status = error instanceof OrchestrationDeniedError ? "denied" : "failed";
			task.error = error instanceof Error ? error.message : String(error);
			task.updatedAt = now();
			return { task };
		}
	}

	private resolveAgents(input: OrchestratorRequest, kind: MaatTaskKind): MaatAgent[] {
		if (input.agentId) {
			const agent = this.agents.get(input.agentId);
			if (!agent) throw new UnknownAgentError("unknown agent: " + input.agentId);
			return [agent];
		}
		const required: MaatCapability = kind === "research" ? "research" : "development";
		const matches = [...this.agents.values()].filter((agent) => agent.capabilities.includes(required));
		if (kind === "research-and-development") {
			return [...this.agents.values()].filter(
				(agent) => agent.capabilities.includes("research") || agent.capabilities.includes("development"),
			);
		}
		return matches;
	}

	private async runAgent(task: MaatTask, agent: MaatAgent, kind: MaatTaskKind): Promise<unknown> {
		task.status = "running";
		task.assignedAgentId = agent.id;
		task.updatedAt = now();
		const decision = await this.authorize(agent, task, kind);
		if (!decision.allowed) throw new OrchestrationDeniedError(decision.reason);
		return await agent.execute({ ...task, kind });
	}

	private async authorize(
		agent: MaatAgent,
		task: MaatTask,
		kind: MaatTaskKind,
	): Promise<{ allowed: boolean; reason: string }> {
		if (!this.options.guard) {
			if (requiresDevelopment(kind) || agent.capabilities.includes("development")) {
				return { allowed: false, reason: "Tehuti Guard authorization is required for development actions" };
			}
			return { allowed: true, reason: "read-only research" };
		}
		return await this.options.guard.authorize({
			actorId: "maat-orchestrator",
			action: "agent.execute",
			resource: agent.id,
			taskId: task.id,
		});
	}
}
