import type { GraphIndex } from '../data/graphIndex';
import type { Gap } from './gaps';
import type { GapVerification } from './verification';

/** Items for the "Research discovery" panel. Each item links to something clickable in the graph. */
export interface InsightItem {
  text: string;
  refs: string; // short reference line (paper numbers, etc.)
  target: { kind: 'entity'; id: string } | { kind: 'gap'; id: string } | { kind: 'paper'; id: string };
}

export interface Insights {
  themes: InsightItem[];
  methods: InsightItem[];
  conflicts: InsightItem[];
  underexplored: InsightItem[];
  directions: InsightItem[];
}

/** Verdicts that mean "this gap is not real" — such gaps are kept out of underexplored areas & directions. */
const DISMISSED = new Set(['not-supported', 'closed-in-corpus', 'extraction-artifact']);

export function computeInsights(ix: GraphIndex, allGaps: Gap[], ver: Record<string, GapVerification> = {}): Insights {
  const gaps = allGaps.filter((g) => !DISMISSED.has(ver[g.id]?.verdict ?? ''));
  const pnum = (pid: string) => {
    const m = ix.paperById.get(pid);
    return m?.rank != null ? `P${String(m.rank).padStart(2, '0')}` : pid.slice(0, 10);
  };
  const refs = (pids: string[]) => pids.map(pnum).sort().slice(0, 6).join(' · ') + (pids.length > 6 ? ` +${pids.length - 6}` : '');
  const ents = [...ix.nodes.values()];

  const themes = ents
    .filter((n) => (n.type === 'Behavior' || n.type === 'Concept') && n.paperCount >= 3)
    .sort((a, b) => b.paperCount - a.paperCount || b.mentionCount - a.mentionCount)
    .slice(0, 6)
    .map<InsightItem>((n) => ({ text: n.label, refs: `${n.paperCount} papers · ${refs(n.papers)}`, target: { kind: 'entity', id: n.id } }));

  const methods = ents
    .filter((n) => (n.type === 'Method' || n.type === 'EvaluationMethod') && n.paperCount >= 2)
    .sort((a, b) => b.paperCount - a.paperCount || b.mentionCount - a.mentionCount)
    .slice(0, 6)
    .map<InsightItem>((n) => ({ text: n.label, refs: `${n.type === 'Method' ? 'method' : 'evaluation'} · ${refs(n.papers)}`, target: { kind: 'entity', id: n.id } }));

  const conflicts = allGaps
    .filter((g) => g.kind === 'conflict')
    .map<InsightItem>((g) => ({ text: g.title.replace('Conflicting claims: ', ''), refs: refs(g.papers), target: { kind: 'gap', id: g.id } }));

  const underexplored = gaps
    .filter((g) => g.kind !== 'conflict')
    .slice(0, 6)
    .map<InsightItem>((g) => ({ text: g.title, refs: refs(g.papers), target: { kind: 'gap', id: g.id } }));

  const directions: InsightItem[] = [];
  for (const g of gaps) {
    const r = g.resolutions.find((x) => x.nodeId && x.observed);
    if (!r || !r.nodeId) continue;
    const m = ix.nodes.get(r.nodeId)!;
    const focus = ix.nodes.get(g.focus[g.focus.length - 1])?.label ?? '';
    directions.push({
      text: `Hypothesis: apply “${m.label}” (${r.paperIds.map(pnum).join(', ')}) to “${focus}”`,
      refs: `${g.kind} · ${refs(r.paperIds)}`,
      target: { kind: 'gap', id: g.id },
    });
    if (directions.length >= 5) break;
  }
  return { themes, methods, conflicts, underexplored, directions };
}
