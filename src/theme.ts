import type { NodeType } from './types';

// Node encoding (colour + shape). Colour is never the only cue: shapes differ per type and a
// legend + type chips are always shown.
export const NODE_STYLE: Record<NodeType, { color: string; shape: string; label: string }> = {
  Paper: { color: '#5b8cff', shape: 'round-rectangle', label: 'Papers' },
  Behavior: { color: '#f472b6', shape: 'ellipse', label: 'Behaviors' },
  Concept: { color: '#a78bfa', shape: 'ellipse', label: 'Concepts' },
  Method: { color: '#f59e0b', shape: 'hexagon', label: 'Methods' },
  EvaluationMethod: { color: '#22d3ee', shape: 'diamond', label: 'Evaluations' },
  AIModel: { color: '#94a3b8', shape: 'round-tag', label: 'Models' },
  Mechanism: { color: '#c084fc', shape: 'vee', label: 'Mechanisms' },
  ExperimentalCondition: { color: '#facc15', shape: 'rhomboid', label: 'Conditions' },
  Finding: { color: '#34d399', shape: 'ellipse', label: 'Findings' },
  Hypothesis: { color: '#fbbf24', shape: 'ellipse', label: 'Hypotheses' },
  Gap: { color: '#f43f5e', shape: 'octagon', label: 'Gaps' },
};

export const TYPE_ORDER: NodeType[] = [
  'Paper', 'Behavior', 'Concept', 'Method', 'EvaluationMethod', 'AIModel', 'Mechanism', 'ExperimentalCondition', 'Finding', 'Hypothesis', 'Gap',
];

export const EDGE_COLORS = {
  semantic: '#64748b',
  hypothesized: '#a3a3a3',
  negated: '#ef4444',
  uses: '#334155',
  aligned: '#5b8cff',
  cites: '#a78bfa',
  gap: '#f43f5e',
  resolve: '#34d399',
  provenance: '#1f9d6b',
};
