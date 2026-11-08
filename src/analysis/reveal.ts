import type { GraphIndex } from '../data/graphIndex';
import { paperShortLabel } from '../data/graphIndex';
import type { Comparison, RelPath } from './compare';
import { ROLE_LABEL, validatePath } from './compare';

/**
 * Research Connection Reveal: an ordered, deterministic presentation of an EXISTING comparison.
 *
 * Nothing here finds new relationships. Every step is either
 *   - one of the two papers,
 *   - a citation from cmp.citation (present only when grounding data passed the SHA-256 integrity check), or
 *   - one of cmp.paths (already validated by compare.ts against real nodes, edges and provenance).
 * `elements` lists the Cytoscape ids (nodes and edges of the compare view) revealed by the step, in order.
 */

export const MAX_REVEAL_PATHS = 5;

export type RevealKind = 'paper' | 'citation' | 'shared' | 'linked' | 'co-studied' | 'empty';

/** Same shape as the dashboard's Selection, so evidence opens in the existing inspector. */
export interface RevealEvidence { label: string; selection: { kind: 'node' | 'edge'; id: string } }

export interface RevealStep {
  key: string;
  kind: RevealKind;
  /** short label, e.g. "Shared method · deliberative alignment" */
  title: string;
  /** one or two neutral sentences; never claims agreement, contradiction or causation */
  detail: string;
  /** Cytoscape element ids in reveal order */
  elements: string[];
  /** where "evidence" opens in the existing inspector */
  evidence: RevealEvidence[];
  /** for citation steps: matched automatically, not scientific evidence */
  provenance?: 'reference-list-match' | 'graph-evidence';
}

export interface RevealSequence {
  pairKey: string;
  a: string;
  b: string;
  steps: RevealStep[];
  /** true when there is no citation and no evidence-backed path */
  empty: boolean;
}

export const REVEAL_CAVEAT = 'Each connection comes from extracted evidence. Being close in the graph does not mean the papers agree, disagree, or that one causes the other.';

const usesId = (pid: string, nodeId: string) => `uses:${pid}:${nodeId}`;

function pathStep(ix: GraphIndex, cmp: Comparison, p: RelPath, i: number): RevealStep {
  const A = cmp.a.paperId;
  const B = cmp.b.paperId;
  const sa = short(ix, A);
  const sb = short(ix, B);
  const label = (id: string) => ix.nodes.get(id)?.label ?? id;
  const ents = p.nodes.slice(1, -1).filter((id) => !['Finding', 'Hypothesis'].includes(ix.nodes.get(id)!.type));
  const x = ents[0];
  const y = ents[ents.length - 1];
  const elements: string[] = [];
  const evidence: RevealEvidence[] = [{ label: `${sa}’s quotes`, selection: { kind: 'edge', id: usesId(A, x) } }];
  if (p.kind === 'shared') {
    elements.push(x, usesId(A, x), usesId(B, x));
    const shared = [...cmp.concepts.specific, ...cmp.methods.methodology, ...cmp.methods.terminology].find((s) => s.node.id === x);
    const t = ix.nodes.get(x)!.type;
    const what = t === 'Method' || t === 'EvaluationMethod' ? 'method' : t === 'AIModel' ? 'model' : t === 'ExperimentalCondition' ? 'condition' : 'concept';
    evidence.push({ label: `${sb}’s quotes`, selection: { kind: 'edge', id: usesId(B, x) } });
    return {
      key: `path:${p.nodes.join('>')}`, kind: 'shared', provenance: 'graph-evidence', elements, evidence,
      title: `Shared ${what} · ${label(x)}`,
      detail: shared
        ? `Both papers include “${label(x)}”: ${ROLE_LABEL[shared.a.role]} in ${sa}, ${ROLE_LABEL[shared.b.role]} in ${sb}.`
        : `Both papers include “${label(x)}”.`,
    };
  }
  elements.push(x, usesId(A, x));
  const mid = p.hops.find((h) => h.kind !== 'mention')!;
  if (mid.kind === 'edge') {
    elements.push(mid.edge.id, y, usesId(B, y));
    evidence.push({ label: 'The linking claim', selection: { kind: 'edge', id: mid.edge.id } });
  } else if (mid.kind === 'finding') {
    elements.push(mid.involves[0].id, mid.finding.id, mid.involves[1].id, y, usesId(B, y));
    evidence.push({ label: `The ${mid.finding.type === 'Finding' ? 'finding' : 'hypothesis'}`, selection: { kind: 'node', id: mid.finding.id } });
  }
  evidence.push({ label: `${sb}’s quotes`, selection: { kind: 'edge', id: usesId(B, y) } });
  const claim = mid.kind === 'edge' ? ` (${mid.edge.claimType ?? 'unclassified'} claim${mid.edge.negated ? ', reported as not holding' : ''})` : '';
  return {
    key: `path:${p.nodes.join('>')}:${i}`, kind: p.kind, provenance: 'graph-evidence', elements, evidence,
    // the arrow follows the claim edge's own source → target, which may run from B's side to A's side
    title: mid.kind === 'edge' ? `Linked by a claim · ${label(mid.edge.source)} → ${label(mid.edge.target)}` : `Studied together · ${label(x)} and ${label(y)}`,
    detail: `${p.text.replace(/\.$/, '')}${claim}.`,
  };
}

function short(ix: GraphIndex, pid: string) {
  const m = ix.paperById.get(pid);
  return m ? paperShortLabel(m).split(' · ')[0] : pid;
}

/** Deterministic: same comparison in, same sequence out. */
export function buildRevealSequence(ix: GraphIndex, cmp: Comparison): RevealSequence {
  const A = cmp.a.paperId;
  const B = cmp.b.paperId;
  const steps: RevealStep[] = [];
  for (const pid of [A, B]) {
    const m = ix.paperById.get(pid)!;
    steps.push({
      key: `paper:${pid}`, kind: 'paper', elements: [m.nodeId],
      title: paperShortLabel(m), detail: m.title,
      evidence: [{ label: 'Paper details', selection: { kind: 'node', id: m.nodeId } }],
    });
  }
  // citations: only records that reached the comparison (verified + integrity-checked); never ambiguous ones
  for (const [from, to, list] of [[A, B, cmp.citation.aCitesB], [B, A, cmp.citation.bCitesA]] as const) {
    const c = list[0];
    if (!c) continue;
    const id = `refcite:${from}:${to}`;
    steps.push({
      key: `cite:${from}>${to}`, kind: 'citation', provenance: 'reference-list-match', elements: [id],
      title: `${short(ix, from)} cites ${short(ix, to)}`,
      detail: `Matched automatically in ${short(ix, from)}’s reference list (p. ${c.page}); not reviewed by a person. A citation shows the papers are connected, not that they agree.`,
      evidence: [{ label: 'Reference-list match', selection: { kind: 'edge', id } }],
    });
  }
  cmp.paths.slice(0, MAX_REVEAL_PATHS).forEach((p, i) => steps.push(pathStep(ix, cmp, p, i)));
  const empty = steps.length === 2;
  if (empty)
    steps.push({
      key: 'empty', kind: 'empty', elements: [], evidence: [],
      title: 'No supported connection in the graph',
      detail: 'No citation was matched and no evidence-backed path links these papers within two steps. This reflects what was extracted, not proof that the research is unrelated.',
    });
  return { pairKey: `${A}|${B}`, a: A, b: B, steps, empty };
}

/**
 * Checks that a sequence only uses real, correctly attributed graph objects and the comparison's own
 * citation records. Returns a list of problems (empty = valid). Used by tests; cheap enough for dev checks.
 */
export function validateReveal(ix: GraphIndex, cmp: Comparison, seq: RevealSequence, viewElementIds?: Set<string>): string[] {
  const problems: string[] = [];
  const A = cmp.a.paperId;
  const B = cmp.b.paperId;
  if (seq.a !== A || seq.b !== B) problems.push('pair ids differ from the comparison');
  if (seq.steps[0]?.elements[0] !== `paper:${A}` || seq.steps[1]?.elements[0] !== `paper:${B}`) problems.push('sequence must start with paper A, then paper B');
  const edgeIds = new Set(ix.edges.map((e) => e.id));
  const cited = new Set([...cmp.citation.aCitesB, ...cmp.citation.bCitesA].map((c) => `refcite:${c.source}:${c.target}`));
  for (const s of seq.steps) {
    for (const id of s.elements) {
      if (viewElementIds && !viewElementIds.has(id)) problems.push(`${s.key}: element ${id} is not drawn in the compare view`);
      if (ix.nodes.has(id) || edgeIds.has(id)) continue;
      if (id.startsWith('uses:')) {
        const rest = id.slice(5);
        const k = rest.indexOf(':');
        const pid = rest.slice(0, k);
        const n = ix.nodes.get(rest.slice(k + 1));
        if (!n || ![A, B].includes(pid) || !n.papers.includes(pid) || !n.evidence.some((e) => e.paperId === pid)) problems.push(`${s.key}: ${id} has no quote from ${pid}`);
      } else if (id.startsWith('refcite:')) {
        if (!cited.has(id)) problems.push(`${s.key}: ${id} is not a citation record of this comparison`);
      } else problems.push(`${s.key}: unknown element ${id}`);
    }
    if (s.kind === 'citation' && s.provenance !== 'reference-list-match') problems.push(`${s.key}: citation must be labelled as a reference-list match`);
    if (/\b(agree|agrees|confirm|confirms|prove|proves|causes|caused by|contradict)/i.test(s.detail.replace(/not that they agree|does not mean the papers agree/gi, '')))
      problems.push(`${s.key}: explanation makes an interpretive claim`);
  }
  for (const p of cmp.paths.slice(0, MAX_REVEAL_PATHS)) {
    const v = validatePath(ix, p, A, B);
    if (!v.ok) problems.push(`path ${p.nodes.join('>')}: ${v.why}`);
  }
  return problems;
}
