import { randomUUID } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { computeActionHash, signBinding } from "../governance/security.js";
import type { GovernedActionService } from "./governed-actions.js";

export interface BrokerAgentToolOptions {
	service: GovernedActionService;
	actorId: string;
	secret: string;
	name: string;
	label: string;
	description: string;
	parameters: AgentTool["parameters"];
	resource?: string;
}

/** AgentTool that enters the mandatory GovernedActionService broker path. */
export function createBrokerAgentTool(options: BrokerAgentToolOptions): AgentTool {
	const tool = {
		name: options.name,
		label: options.label,
		description: options.description,
		parameters: options.parameters,
		async execute(_toolCallId: string, params: unknown) {
			const resource = options.resource ?? "";
			const now = Date.now();
			const unsigned = {
				actionId: randomUUID(),
				correlationId: randomUUID(),
				nonce: randomUUID(),
				issuedAt: now,
				expiresAt: now + 5000,
				argumentHash: computeActionHash(options.name, resource, params),
				actorId: options.actorId,
			};
			const security = { ...unsigned, signature: signBinding(unsigned, options.secret) };
			const result = await options.service.execute({
				actorId: options.actorId,
				toolName: options.name,
				resource,
				params,
				security,
			});
			if (!result.ok) throw new Error(result.reason);
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result.result) }],
				details: { receipt: result.receipt },
			};
		},
	} satisfies AgentTool;
	return tool;
}
