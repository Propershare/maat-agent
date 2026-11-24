import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { GovernedToolRuntime } from "../governance/index.js";

export interface GovernedAgentToolOptions {
	runtime: GovernedToolRuntime;
	actorId: string;
	name: string;
	label: string;
	description: string;
	parameters: AgentTool["parameters"];
}

/**
 * Wraps a privileged AgentTool so every invocation goes through the existing
 * GovernedToolRuntime. There is deliberately no direct handler path here.
 */
export function createGovernedAgentTool(options: GovernedAgentToolOptions): AgentTool {
	const tool = {
		name: options.name,
		label: options.label,
		description: options.description,
		parameters: options.parameters,
		async execute(_toolCallId: string, params: unknown) {
			const result = await options.runtime.execute({
				actorId: options.actorId,
				toolName: options.name,
				params,
			});
			if (!result.ok) {
				throw new Error(result.reason);
			}
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result.result) }],
				details: { receipt: result.receipt },
			};
		},
	} satisfies AgentTool;
	return tool;
}
