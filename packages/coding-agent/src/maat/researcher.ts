import {
	ART_OF_RESEARCH_METHODS,
	getResearchMethod,
	isResearchMethodId,
	type ResearchMethodId,
} from "./research-methods.js";

export interface EvidenceCandidate {
	id: string;
	claim: string;
	source: string;
	quote?: string;
	method?: string;
	confidence?: number;
	metadata?: Record<string, unknown>;
}

export interface ResearchSource {
	readonly id: string;
	search(input: {
		question: string;
		methodsUsed: readonly ResearchMethodId[];
		sourceChannels?: readonly string[];
		limit: number;
	}): Promise<readonly EvidenceCandidate[]>;
}

export interface ResearchAssignment {
	question: string;
	methods?: readonly string[];
	sourceChannels?: readonly string[];
	maxEvidence?: number;
}

export interface ResearchFinding {
	claim: string;
	source: string;
	quote?: string;
	method: ResearchMethodId;
	confidence: number;
	verified: boolean;
}

export interface ResearchContradiction {
	claim: string;
	sourceA: string;
	sourceB: string;
	reason: string;
}

export interface ResearchResult {
	question: string;
	methodsUsed: readonly ResearchMethodId[];
	findings: readonly ResearchFinding[];
	sources: readonly string[];
	contradictions: readonly ResearchContradiction[];
	uncertainty: {
		level: "low" | "medium" | "high";
		reasons: readonly string[];
	};
	gaps: readonly string[];
	provenance: {
		registry: "art-of-research.methods.v1";
		sourceIds: readonly string[];
		retrievedAt: string;
	};
}

export interface ResearchGuard {
	authorize(input: {
		actorId: string;
		action: string;
		resource: string;
		question: string;
	}): Promise<{ allowed: boolean; reason: string }>;
}

export interface ResearchMemory {
	record(result: ResearchResult): Promise<void> | void;
}

export class ResearchMethodError extends Error {}
export class ResearchDeniedError extends Error {}

const DEFAULT_EVIDENCE_LIMIT = 25;

function selectMethods(question: string, requested?: readonly string[]): ResearchMethodId[] {
	const candidates = requested?.length ? requested : inferMethods(question);
	const selected: ResearchMethodId[] = [];
	for (const candidate of candidates) {
		if (!isResearchMethodId(candidate)) {
			throw new ResearchMethodError("unknown Art of Research method: " + candidate);
		}
		if (!selected.includes(candidate)) selected.push(candidate);
	}
	if (selected.length === 0) selected.push("ka-process");
	return selected;
}

function inferMethods(question: string): string[] {
	const text = question.toLowerCase();
	if (/\bsurvey|questionnaire|poll\b/.test(text)) return ["survey"];
	if (/\bcase study|case-study|single case\b/.test(text)) return ["case-study"];
	if (/\blived experience|phenomen|meaning of\b/.test(text)) return ["phenomenological"];
	if (/\bcompare|comparison|mixed|quantitative|qualitative|triangulat/.test(text)) return ["mixed-methods"];
	if (/\bsystematic review|meta-analysis|literature review\b/.test(text)) return ["systematic-review"];
	if (/\bethnograph|participant observation|fieldwork\b/.test(text)) return ["ethnographic"];
	return ["ka-process"];
}

function clampConfidence(value: number | undefined): number {
	if (value === undefined || Number.isNaN(value)) return 0.5;
	return Math.max(0, Math.min(1, value));
}

function findingFromEvidence(
	candidate: EvidenceCandidate,
	fallbackMethod: ResearchMethodId,
): ResearchFinding | undefined {
	const claim = candidate.claim?.trim();
	const source = candidate.source?.trim();
	if (!claim || !source) return undefined;
	const method = candidate.method && isResearchMethodId(candidate.method) ? candidate.method : fallbackMethod;
	return {
		claim,
		source,
		quote: candidate.quote?.trim() || undefined,
		method,
		confidence: clampConfidence(candidate.confidence),
		verified: Boolean(candidate.quote?.trim()),
	};
}

function findContradictions(findings: readonly ResearchFinding[]): ResearchContradiction[] {
	const contradictions: ResearchContradiction[] = [];
	for (let index = 0; index < findings.length; index++) {
		for (let other = index + 1; other < findings.length; other++) {
			const left = findings[index]!;
			const right = findings[other]!;
			if (left.claim.toLowerCase() !== right.claim.toLowerCase()) continue;
			if ((left.quote ?? "") === (right.quote ?? "")) continue;
			contradictions.push({
				claim: left.claim,
				sourceA: left.source,
				sourceB: right.source,
				reason: "same claim, different evidence text",
			});
		}
	}
	return contradictions;
}

export class K2Researcher {
	constructor(
		private readonly source: ResearchSource,
		private readonly options: {
			guard?: ResearchGuard;
			memory?: ResearchMemory;
			actorId?: string;
		} = {},
	) {}

	async research(assignment: ResearchAssignment): Promise<ResearchResult> {
		const question = assignment.question?.trim();
		if (!question) throw new Error("research question is required");
		const methodsUsed = selectMethods(question, assignment.methods);
		const actorId = this.options.actorId ?? "k2-master-researcher";

		if (this.options.guard) {
			const decision = await this.options.guard.authorize({
				actorId,
				action: "research.execute",
				resource: this.source.id,
				question,
			});
			if (!decision.allowed) throw new ResearchDeniedError(decision.reason);
		}

		const candidates = await this.source.search({
			question,
			methodsUsed,
			sourceChannels: assignment.sourceChannels,
			limit: assignment.maxEvidence ?? DEFAULT_EVIDENCE_LIMIT,
		});

		const findings = candidates
			.map((candidate) => findingFromEvidence(candidate, methodsUsed[0]!))
			.filter((finding): finding is ResearchFinding => finding !== undefined);
		const sources = [...new Set(findings.map((finding) => finding.source))];
		const contradictions = findContradictions(findings);
		const verifiedCount = findings.filter((finding) => finding.verified).length;
		const reasons: string[] = [];
		let level: "low" | "medium" | "high" = "low";

		if (findings.length === 0) {
			level = "high";
			reasons.push("no usable evidence was returned");
		} else if (verifiedCount === 0) {
			level = "high";
			reasons.push("no evidence item has a source quote");
		} else if (verifiedCount < findings.length) {
			level = "medium";
			reasons.push("some evidence items are unverified");
		}
		if (contradictions.length > 0) {
			level = "high";
			reasons.push("contradictory evidence was found");
		}
		if (sources.length < 2) {
			if (level === "low") level = "medium";
			reasons.push("fewer than two independent sources");
		}

		const gaps: string[] = [];
		if (findings.length === 0) gaps.push("collect evidence");
		if (verifiedCount < findings.length) gaps.push("verify unquoted evidence");
		if (contradictions.length > 0) gaps.push("resolve conflicting evidence");
		if (sources.length < 2) gaps.push("add an independent source");

		const result: ResearchResult = {
			question,
			methodsUsed,
			findings,
			sources,
			contradictions,
			uncertainty: { level, reasons },
			gaps,
			provenance: {
				registry: "art-of-research.methods.v1",
				sourceIds: sources,
				retrievedAt: new Date().toISOString(),
			},
		};

		await this.options.memory?.record(result);
		return result;
	}
}

export function getRegisteredMethodCount(): number {
	return ART_OF_RESEARCH_METHODS.length;
}

export function getMethodDescription(id: string): string | undefined {
	const method = getResearchMethod(id);
	if (!method) return undefined;
	const described = method as { description?: string; title?: string };
	return described.description ?? described.title;
}
