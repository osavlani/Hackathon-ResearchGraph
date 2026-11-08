import type { GapKind } from '../analysis/gaps';
import type { Verdict } from '../analysis/verification';

/**
 * Plain-language explanations shown in the UI. They paraphrase the rules in src/analysis/gaps.ts
 * and the verdict definitions in src/analysis/verification.ts. They don't change any logic.
 */
// Gap types describe what the rule found in the GRAPH. A graph gap can be a real scientific gap
// or a relationship the extraction missed; the review verdict says which.
export const GAP_KIND_HELP: Record<GapKind, string> = {
  'untested-claim': 'In the graph, causal claims about this are mostly marked as hypothesized, with few observed counterparts.',
  'no-detection': 'No claim in the graph says that a method or evaluation detects or measures this.',
  'no-mitigation': 'No claim in the graph reports an observed result of a method reducing or mitigating this behavior.',
  conflict: 'The graph contains claims in opposite directions about the same pair of entities. Check each claim’s context, because a different setting or model often explains it.',
  'single-source': 'At least three papers mention this, but observed claims about it in the graph come from one paper at most.',
  'narrow-models': 'In the graph, observed claims of this behavior involve models from only one family.',
};

export const VERDICT_HELP: Record<Verdict, string> = {
  confirmed: 'The reviewer judged the gap real within this collection.',
  'partly-addressed': 'The reviewer found partial coverage in a paper that the graph missed or under-weighted.',
  'closed-in-corpus': 'The reviewer found a paper in the collection that addresses it; the extraction missed the link.',
  'extraction-artifact': 'The reviewer traced it to one idea being split across differently-named entities.',
  'not-supported': 'The rule fired, but the reviewer judged that its premise does not hold.',
};

export const EXAMPLE_QUERIES = ['alignment faking', 'sandbagging detection', 'evaluation awareness', 'chain-of-thought monitoring', 'sleeper agents'];
