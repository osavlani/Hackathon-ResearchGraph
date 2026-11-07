import type { PaperMeta } from '../types';

/**
 * Optional full titles for the 35-paper scheming / alignment-faking / sandbagging corpus,
 * keyed by the two-digit rank prefix of paper_id. Anything not listed falls back to a title
 * parsed from the paper_id (e.g. "01-Greenblatt2024-AlignmentFaking" -> "Alignment Faking").
 * Safe to delete or replace for another corpus.
 */
export const KNOWN_TITLES: Record<number, string> = {
  1: 'Alignment Faking in Large Language Models',
  2: 'Frontier Models are Capable of In-context Scheming',
  3: 'Sleeper Agents: Training Deceptive LLMs that Persist Through Safety Training',
  4: 'Risks from Learned Optimization in Advanced Machine Learning Systems',
  5: 'Scheming AIs: Will AIs Fake Alignment During Training in Order to Get Power?',
  6: 'AI Control: Improving Safety Despite Intentional Subversion',
  7: 'Stress Testing Deliberative Alignment for Anti-Scheming Training',
  8: 'AI Sandbagging: Language Models can Strategically Underperform on Evaluations',
  9: 'Large Language Models can Strategically Deceive their Users when Put Under Pressure',
  10: 'AI Deception: A Survey of Examples, Risks, and Potential Solutions',
  11: 'Why Do Some Language Models Fake Alignment While Others Don’t?',
  12: 'Me, Myself, and AI: The Situational Awareness Dataset (SAD) for LLMs',
  13: 'Agentic Misalignment: How LLMs Could Be Insider Threats',
  14: 'Sabotage Evaluations for Frontier Models',
  15: 'Sycophancy to Subterfuge: Investigating Reward-Tampering in LLMs',
  16: 'Natural Emergent Misalignment from Reward Hacking in Production RL',
  17: 'Stress-Testing Capability Elicitation With Password-Locked Models',
  18: 'Taken out of context: On measuring situational awareness in LLMs',
  19: 'Auditing Language Models for Hidden Objectives',
  20: 'Chain of Thought Monitorability: A New and Fragile Opportunity for AI Safety',
  21: 'Evaluating Frontier Models for Stealth and Situational Awareness',
  22: 'Large Language Models Often Know When They Are Being Evaluated',
  23: 'Noise Injection Reveals Hidden Capabilities of Sandbagging Language Models',
  24: 'Auditing Games for Sandbagging',
  25: 'Simple probes can catch sleeper agents',
  26: 'Towards Evaluations-Based Safety Cases for AI Scheming',
  27: 'Evaluation Faking: Unveiling Observer Effects in Safety Evaluation of Frontier AI Systems',
  28: 'Realistic Honeypot Evaluations for Scheming Propensity',
  29: 'Value-Conflict Diagnostics Reveal Widespread Alignment Faking',
  30: 'Behavioural Analysis of Alignment Faking',
  31: 'Building Comparative Motivation Profiles with Instrumental Interventions',
  32: 'Do Models Fake Alignment Without Clear Consequences?',
  33: 'Deliberative Alignment: Reasoning Enables Safer Language Models',
  34: 'The Alignment Problem from a Deep Learning Perspective',
  35: 'Deception Abilities Emerged in Large Language Models',
};

/** Paper ids that don't follow the "NN-..." pattern but map to a known rank. */
const ALIASES: Record<string, number> = {
  'Simple-probes-can-catch-sleeper-agents-Anthropic': 25,
};

function splitCamel(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/-/g, ' ')
    .trim();
}

export function parsePaperMeta(paperId: string, sourcePdf: string): PaperMeta {
  // Pattern A: 01-Greenblatt2024-AlignmentFaking ; Pattern B: 29-2026-ValueConflictAlignmentFaking
  const a = paperId.match(/^(\d+)-([A-Za-z]+)(\d{4})-(.+)$/);
  const b = paperId.match(/^(\d+)-(\d{4})-(.+)$/);
  let rank: number | null = null;
  let firstAuthor: string | null = null;
  let year: number | null = null;
  let shortTitle = splitCamel(paperId);
  if (a) {
    rank = Number(a[1]);
    firstAuthor = a[2];
    year = Number(a[3]);
    shortTitle = splitCamel(a[4]);
  } else if (b) {
    rank = Number(b[1]);
    year = Number(b[2]);
    shortTitle = splitCamel(b[3]);
  } else if (ALIASES[paperId] != null) {
    rank = ALIASES[paperId];
    year = 2024;
    firstAuthor = 'MacDiarmid';
    shortTitle = 'Simple probes catch sleeper agents';
  }
  const title = (rank != null && KNOWN_TITLES[rank]) || shortTitle;
  return { paperId, nodeId: `paper:${paperId}`, rank, firstAuthor, year, shortTitle, title, sourcePdf };
}

/** Ranks of the curated corpus that have no Paper node in the loaded graph. */
export function missingCorpusRanks(present: PaperMeta[]): { rank: number; title: string }[] {
  const have = new Set(present.map((p) => p.rank));
  return Object.entries(KNOWN_TITLES)
    .map(([r, t]) => ({ rank: Number(r), title: t }))
    .filter((x) => !have.has(x.rank));
}
