import type { GraphIndex } from '../data/graphIndex';
import type { GEdge, GNode, NodeType } from '../types';

/** Entity types that represent what a paper "uses / studies". Findings & hypotheses are paper-local. */
export const SHARED_TYPES: NodeType[] = ['Behavior', 'Concept', 'Method', 'EvaluationMethod', 'AIModel', 'Mechanism', 'ExperimentalCondition'];

export const USES_LABEL: Partial<Record<NodeType, string>> = {
  Method: 'uses method',
  EvaluationMethod: 'evaluates with',
  AIModel: 'tests model',
  Behavior: 'studies behavior',
  Concept: 'discusses',
  Mechanism: 'proposes mechanism',
  ExperimentalCondition: 'varies condition',
  Finding: 'reports finding',
  Hypothesis: 'hypothesizes',
};

/** Inverse document frequency over papers; rare shared entities count more. */
export function idf(ix: GraphIndex, n: GNode): number {
  return Math.log(1 + ix.papers.length / Math.max(1, n.paperCount));
}

export interface AlignedPaper {
  paperId: string;
  score: number;
  shared: GNode[]; // shared entities, most informative first
  citesIt: number; // passages in A that mention B
  citedBy: number;
}

/**
 * "Aligned papers": IDF-weighted cosine over shared entities + a bonus for detected
 * in-corpus mentions (see citations()). Explainable: every score comes with its shared entities.
 */
export function alignedPapers(ix: GraphIndex, paperId: string, cites: CitationIndex, k = 6): AlignedPaper[] {
  const mine = ix.paperEntities.get(paperId) ?? new Set<string>();
  const norm = (pid: string) => {
    let s = 0;
    for (const id of ix.paperEntities.get(pid) ?? []) {
      const n = ix.nodes.get(id)!;
      if (SHARED_TYPES.includes(n.type)) s += idf(ix, n) ** 2;
    }
    return Math.sqrt(s) || 1;
  };
  const myNorm = norm(paperId);
  const res: AlignedPaper[] = [];
  for (const p of ix.papers) {
    if (p.paperId === paperId) continue;
    const theirs = ix.paperEntities.get(p.paperId) ?? new Set<string>();
    const shared: GNode[] = [];
    let dot = 0;
    for (const id of mine) {
      if (!theirs.has(id)) continue;
      const n = ix.nodes.get(id)!;
      if (!SHARED_TYPES.includes(n.type)) continue;
      shared.push(n);
      dot += idf(ix, n) ** 2;
    }
    const citesIt = cites.count(paperId, p.paperId);
    const citedBy = cites.count(p.paperId, paperId);
    const score = dot / (myNorm * norm(p.paperId)) + (citesIt || citedBy ? 0.15 : 0);
    if (score > 0) {
      shared.sort((a, b) => idf(ix, b) - idf(ix, a) || b.mentionCount - a.mentionCount);
      res.push({ paperId: p.paperId, score, shared, citesIt, citedBy });
    }
  }
  return res.sort((a, b) => b.score - a.score).slice(0, k);
}

// ---------------- In-corpus citation detection ----------------

export interface CitationIndex {
  /** number of extracted passages in `from` that mention the author+year of `to` */
  count(from: string, to: string): number;
  outgoing(from: string): { to: string; n: number; ambiguous: boolean; sample: string }[];
  incoming(to: string): { from: string; n: number; ambiguous: boolean; sample: string }[];
}

/**
 * The backend graph has no paper->paper citation edges. We approximate "what it cites" by scanning
 * every extracted evidence passage of paper A for "<Surname> ... <Year>" of another corpus paper B.
 * Limits: only sees passages the extractor kept (not the reference list); papers without an author
 * in their id (2026 preprints, web notes) can't be detected as targets; same surname+year is
 * ambiguous (e.g. Greenblatt 2024 x3) and is flagged as such.
 */
export function buildCitations(ix: GraphIndex): CitationIndex {
  const targets = ix.papers.filter((p) => p.firstAuthor && p.year);
  const keyCount = new Map<string, number>();
  for (const t of targets) {
    const k = `${t.firstAuthor}|${t.year}`;
    keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }
  const re = new Map(
    targets.map((t) => [
      t.paperId,
      // "Hubinger et al. (2019)", "Hubinger et al., 2019", "(Hubinger, 2019)", "van der Weij"
      new RegExp(`\\b${t.firstAuthor!.replace(/^vander/i, 'van der ?')}\\b[^.;)]{0,40}?\\b${t.year}\\b`, 'i'),
    ]),
  );
  const counts = new Map<string, { n: number; sample: string }>();
  const seen = new Set<string>();
  const scan = (pid: string, rawText: string, chunk: string | undefined) => {
    const text = rawText.replace(/et al\./g, 'et al');
    for (const t of targets) {
      if (t.paperId === pid) continue;
      if (!re.get(t.paperId)!.test(text)) continue;
      const dedupe = `${pid}>${t.paperId}>${chunk ?? text.slice(0, 60)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const k = `${pid}>${t.paperId}`;
      const c = counts.get(k) ?? { n: 0, sample: text };
      c.n++;
      counts.set(k, c);
    }
  };
  const all = [...ix.nodes.values()].flatMap((n) => n.evidence).concat(ix.edges.flatMap((e) => e.evidence));
  for (const ev of all) scan(ev.paperId, `${ev.passage} ${ev.context ?? ''}`, ev.chunkId);

  const ambiguous = (to: string) => {
    const t = ix.paperById.get(to)!;
    return (keyCount.get(`${t.firstAuthor}|${t.year}`) ?? 0) > 1;
  };
  return {
    count: (f, t) => counts.get(`${f}>${t}`)?.n ?? 0,
    outgoing: (f) =>
      [...counts.entries()]
        .filter(([k]) => k.startsWith(`${f}>`))
        .map(([k, v]) => ({ to: k.split('>')[1], n: v.n, ambiguous: ambiguous(k.split('>')[1]), sample: v.sample }))
        .sort((a, b) => b.n - a.n),
    incoming: (t) =>
      [...counts.entries()]
        .filter(([k]) => k.endsWith(`>${t}`))
        .map(([k, v]) => ({ from: k.split('>')[0], n: v.n, ambiguous: ambiguous(t), sample: v.sample }))
        .sort((a, b) => b.n - a.n),
  };
}

/** Derived paper -> entity edge ("uses method", "tests model", ...). Evidence = that paper's quotes. */
export function usesEdge(paperNodeId: string, paperId: string, n: GNode): GEdge {
  return {
    id: `uses:${paperId}:${n.id}`, source: paperNodeId, target: n.id, predicate: 'USES',
    label: USES_LABEL[n.type] ?? 'mentions', kind: 'derived-uses', negated: false, claimType: null,
    papers: [paperId], evidenceCount: n.perPaper.get(paperId) ?? 0, validation: [], grounding: null,
    contexts: '', evidence: n.evidence.filter((e) => e.paperId === paperId),
    note: 'Derived: the entity was extracted from this paper (node.papers). Not a backend edge.',
  };
}
