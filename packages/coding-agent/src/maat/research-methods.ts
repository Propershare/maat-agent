// Generated from the original UKMT Art of Research registry.
// Source: research-evidence/methods/art-of-research.methods.v1.json
export interface ResearchMethod {
	id: string;
	name?: string;
	description?: string;
	[key: string]: unknown;
}

export const ART_OF_RESEARCH_METHODS = [
	{
		id: "ka2",
		title: "K2 / KA2 Methodology",
		source: "25_Research_Template.txt",
		family: "art-of-research",
		process_file: "art-of-research/K2_analysis.txt",
	},
	{
		id: "ka-process",
		title: "KA Process Methodology",
		source: "25_Research_Template.txt",
		family: "art-of-research",
	},
	{
		id: "action-research",
		title: "Action Research",
		source: "25_Research_Template.txt",
		family: "art-of-research",
	},
	{
		id: "case-study",
		title: "Case Study Research",
		source: "25_Research_Template.txt",
		family: "art-of-research",
		process_file: "art-of-research/casestudy_analysis.txt",
	},
	{
		id: "content-analysis",
		title: "Content Analysis Research Process",
		source: "Art_of_Research process pack",
		process_file: "art-of-research/CONTENT ANALYSIS RESEARCH PROCESS.txt",
		family: "art-of-research",
	},
	{
		id: "critical-discourse-analysis",
		title: "Critical Discourse Analysis",
		source: "Art_of_Research process pack",
		process_file: "art-of-research/CRITICAL DISCOURSE ANALYSIS RESEARCH PROCESS.txt",
		family: "art-of-research",
	},
	{
		id: "discourse-analysis",
		title: "Discourse Analysis",
		source: "Art_of_Research process pack",
		process_file: "art-of-research/DISCOURSE ANALYSIS RESEARCH.txt",
		family: "art-of-research",
	},
	{
		id: "ethnographic",
		title: "Ethnographic Research Process",
		source: "Art_of_Research process pack",
		process_file: "art-of-research/ETHNOGRAPHIC RESEARCH PROCESS.txt",
		family: "art-of-research",
	},
	{
		id: "experimental",
		title: "Experimental Research",
		source: "25_Research_Template.txt",
		family: "art-of-research",
		process_file: "art-of-research/EXPERIMENTAL RESEARCH PROCESS.txt",
	},
	{
		id: "feminist",
		title: "Feminist Research Process",
		source: "25_Research_Template.txt",
		family: "art-of-research",
		process_file: "art-of-research/FEMINIST RESEARCH PROCESS.txt",
	},
	{
		id: "focus-group",
		title: "Focus Group Research",
		source: "25_Research_Template.txt",
		family: "art-of-research",
	},
	{
		id: "fundamentals-101",
		title: "Fundamentals of Research 101",
		source: "25_Research_Template.txt",
		family: "art-of-research",
	},
	{
		id: "grounded-theory",
		title: "Grounded Theory Research Process",
		source: "Art_of_Research process pack",
		process_file: "art-of-research/GROUNDED THEORY RESEARCH PROCESS.txt",
		family: "art-of-research",
	},
	{
		id: "longitudinal",
		title: "Longitudinal Research Process",
		source: "Art_of_Research process pack",
		process_file: "art-of-research/LONGITUDINAL RESEARCH PROCESS.txt",
		family: "art-of-research",
	},
	{
		id: "mixed-methods",
		title: "Mixed Methods Research Process",
		source: "Art_of_Research process pack",
		process_file: "art-of-research/MIXED METHODS RESEARCH PROCESS.txt",
		family: "art-of-research",
	},
	{
		id: "narrative",
		title: "Narrative Research Process",
		source: "Art_of_Research process pack",
		process_file: "art-of-research/NARRATIVE RESEARCH PROCESS.txt",
		family: "art-of-research",
	},
	{
		id: "participant-observation",
		title: "Participant Observation Research",
		source: "25_Research_Template.txt",
		family: "art-of-research",
	},
	{
		id: "participatory-action-research",
		title: "Participatory Action Research",
		source: "Art_of_Research process pack",
		process_file: "art-of-research/ARTICIPATORY ACTION RESEARCH.txt",
		family: "art-of-research",
	},
	{
		id: "phenomenological",
		title: "Phenomenological Research Process",
		source: "Art_of_Research process pack",
		process_file: "art-of-research/PHENOMENOLOGICAL RESEARCH PROCESS.txt",
		family: "art-of-research",
	},
	{
		id: "process-fundamentals",
		title: "Process Fundamentals of Basic Research",
		source: "25_Research_Template.txt",
		family: "art-of-research",
	},
	{
		id: "research-methods-statistics",
		title: "Research Methods and Statistics",
		source: "25_Research_Template.txt",
		family: "art-of-research",
	},
	{
		id: "research-process-templates",
		title: "Research Process Templates",
		source: "25_Research_Template.txt",
		family: "art-of-research",
	},
	{
		id: "research-process-whole",
		title: "Research Process as a Whole",
		source: "25_Research_Template.txt",
		family: "art-of-research",
	},
	{
		id: "statistical-decision-template",
		title: "Statistical Procedure Decision Template",
		source: "25_Research_Template.txt",
		family: "art-of-research",
	},
	{
		id: "statistics",
		title: "Statistics",
		source: "25_Research_Template.txt",
		family: "art-of-research",
	},
	{
		id: "survey",
		title: "Survey Research",
		source: "25_Research_Template.txt",
		family: "art-of-research",
		process_file: "art-of-research/SURVEY RESEARCH PROCESS.txt",
	},
	{
		id: "systematic-review",
		title: "Systematic Review Research Process",
		source: "Art_of_Research process pack",
		process_file: "art-of-research/SYSTEMATIC REVIEW RESEARCH PROCESS.txt",
		family: "art-of-research",
	},
] as const;

export type ResearchMethodId = (typeof ART_OF_RESEARCH_METHODS)[number]["id"];

const METHOD_IDS = new Set<string>(ART_OF_RESEARCH_METHODS.map((method) => method.id));

export function isResearchMethodId(value: string): value is ResearchMethodId {
	return METHOD_IDS.has(value);
}

export function getResearchMethod(value: string): (typeof ART_OF_RESEARCH_METHODS)[number] | undefined {
	return ART_OF_RESEARCH_METHODS.find((method) => method.id === value);
}
