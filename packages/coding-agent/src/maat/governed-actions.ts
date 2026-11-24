import type { BrokerRequest, BrokerResult } from "../governance/broker.js";
import type {
	AuthorizedAction,
	EvidenceReceipt,
	GitMaatEvidenceLog,
	GovernedToolRequest,
	GovernedToolRuntime,
} from "../governance/index.js";
import type { ActionBinding } from "../governance/security.js";

export interface BrokerClient {
	execute(request: BrokerRequest): Promise<BrokerResult>;
}

export interface GovernedActionRequest {
	actorId: string;
	toolName: string;
	resource?: string;
	params: unknown;
	security: ActionBinding;
}

export interface GovernedActionOutcome {
	ok: boolean;
	denied: boolean;
	reason: string;
	receipt?: EvidenceReceipt;
	result?: unknown;
}

/**
 * Thin service over the existing GovernedToolRuntime.
 * The broker is a required constructor dependency: there is no direct operation path.
 */
export class GovernedActionService {
	constructor(
		private readonly runtime: GovernedToolRuntime,
		private readonly broker: BrokerClient,
		private readonly evidence?: GitMaatEvidenceLog,
	) {}

	async execute(request: GovernedActionRequest): Promise<GovernedActionOutcome> {
		const authorized: AuthorizedAction = await this.runtime.authorize(this.toGovernedRequest(request));
		if (!authorized.allowed) {
			return {
				ok: false,
				denied: true,
				reason: authorized.reason,
				receipt: authorized.receipt,
			};
		}

		const brokerRequest: BrokerRequest = {
			actorId: request.actorId,
			actorRing: authorized.policy.ring,
			toolName: request.toolName,
			resource: request.resource,
			params: request.params,
			actionId: request.security.actionId,
			correlationId: request.security.correlationId,
			binding: request.security,
			guardDecision: authorized.guard.decision,
		};

		let brokerResult: BrokerResult;
		try {
			brokerResult = await this.broker.execute(brokerRequest);
		} catch (error) {
			const reason = "Security broker unavailable: " + (error instanceof Error ? error.message : String(error));
			const receipt = await this.recordBrokerDenial(request, authorized, reason);
			return { ok: false, denied: true, reason, receipt };
		}

		if (!brokerResult.ok) {
			const receipt = await this.recordBrokerDenial(request, authorized, brokerResult.reason);
			return { ok: false, denied: brokerResult.denied, reason: brokerResult.reason, receipt };
		}

		const receipt = await this.runtime.complete(authorized, brokerResult.result, false);
		return { ok: true, denied: false, reason: brokerResult.reason, receipt, result: brokerResult.result };
	}

	private toGovernedRequest(request: GovernedActionRequest): GovernedToolRequest {
		return {
			actorId: request.actorId,
			toolName: request.toolName,
			resource: request.resource,
			params: request.params,
			security: request.security,
			actionId: request.security.actionId,
			correlationId: request.security.correlationId,
			argumentHash: request.security.argumentHash,
		};
	}

	private async recordBrokerDenial(
		request: GovernedActionRequest,
		authorized: AuthorizedAction,
		reason: string,
	): Promise<EvidenceReceipt | undefined> {
		if (!this.evidence) return undefined;
		return await this.evidence.append({
			actorId: request.actorId,
			actorRing: authorized.policy.ring,
			action: "tool." + request.toolName,
			resource: request.resource ?? "",
			toolName: request.toolName,
			decision: "deny",
			outcome: "denied",
			reason,
			actionId: request.security.actionId,
			correlationId: request.security.correlationId,
			argumentHash: request.security.argumentHash,
			nonce: request.security.nonce,
			expiresAt: request.security.expiresAt,
		});
	}
}
