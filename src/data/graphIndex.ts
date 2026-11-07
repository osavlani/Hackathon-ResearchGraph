import type {
  ClaimType, Evidence, GEdge, GNode, NodeType, PaperMeta, RawEntityNode, RawGraph, RawPaperNode,
  RawProvenanceLink, RawSemanticLink,
} from '../types';
import { parsePaperMeta } from './paperMeta';

/** In-memory index built once from the raw backend graph. Pure data, no React. */
export interface GraphIndex {
  nodes: Map<string, GNode>;
  edges: GEdge[]; // backend edges only (semantic + provenance)
  out: Map<string, GEdge[]>;
  inc: Map<string, GEdge[]>;
  papers: PaperMeta[]; // sorted by rank
  paperById: Map<string, PaperMeta>; // key: paper_id
  /** paper_id -> entity node ids mentioned by that paper (excludes Paper nodes) */
  paperEntities: Map<string, Set<string>>;
  typeCounts: Map<NodeType, number>;
}

const splitList = (s: string | undefined | null): string[] =>
  (s ?? '').split(';').map((x) => x.trim()).filter(Boolean);

function parseEvidence(json: string | undefined | null): Evidence[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as Record<string, unknown>[];
    return arr.map((e) => ({
      paperId: String(e.paper_id ?? ''),
      sourcePdf: String(e.source_pdf ?? ''),
      page: e.page == null || e.page === '' ? null : Number(e.page),
      passage: String(e.passage ?? ''),
      chunkId: e.chunk_id as string | undefined,
      validationStatus: e.validation_status as string | undefined,
      context: e.context as string | undefined,
      claimType: e.claim_type as string | undefined,
      endpointGrounding: e.endpoint_grounding as string | undefined,
    }));
  } catch {
    return [];
  }
}

const isPaperNode = (n: RawGraph['nodes'][number]): n is RawPaperNode => n.node_type === 'Paper';
const isProvenance = (l: RawGraph['links'][number]): l is RawProvenanceLink =>
  (l as RawProvenanceLink).edge_kind === 'provenance';

export const PREDICATE_LABEL: Record<string, string> = {
  INVOLVES: 'involves',
  DOCUMENTS: 'reports',
  EXHIBITS: 'exhibits',
  INCREASES: 'increases',
  REDUCES: 'reduces',
  MITIGATES: 'mitigates',
  DETECTS: 'detects',
  MEASURES: 'measures',
  ENABLES: 'enables',
  CORRELATES_WITH: 'correlates with',
  IS_A: 'is a',
  OBSERVED_UNDER: 'observed under',
};

export function buildIndex(raw: RawGraph): GraphIndex {
  const nodes = new Map<string, GNode>();
  const papers: PaperMeta[] = [];
  const typeCounts = new Map<NodeType, number>();

  for (const n of raw.nodes) {
    const evidence = parseEvidence(n.evidence_json);
    const perPaper = new Map<string, number>();
    for (const e of evidence) perPaper.set(e.paperId, (perPaper.get(e.paperId) ?? 0) + 1);
    let g: GNode;
    if (isPaperNode(n)) {
      const meta = parsePaperMeta(n.paper_id, n.source_pdf);
      papers.push(meta);
      g = {
        id: n.id, label: meta.title, type: 'Paper', papers: [n.paper_id], paperCount: 1,
        mentionCount: Number(n.pages_with_evidence) || 0, sourcePages: '', firstPassage: '',
        aliases: [], evidence, perPaper, paperId: n.paper_id, sourcePdf: n.source_pdf,
      };
    } else {
      const e = n as RawEntityNode;
      g = {
        id: e.id, label: e.label, type: e.node_type as NodeType, papers: splitList(e.papers),
        paperCount: e.paper_count, mentionCount: e.mention_count, sourcePages: e.source_pages,
        firstPassage: e.first_passage, aliases: splitList(e.aliases), evidence, perPaper,
      };
    }
    nodes.set(g.id, g);
    typeCounts.set(g.type, (typeCounts.get(g.type) ?? 0) + 1);
  }

  const edges: GEdge[] = [];
  raw.links.forEach((l, i) => {
    if (!nodes.has(l.source) || !nodes.has(l.target)) return;
    if (isProvenance(l)) {
      edges.push({
        id: `prov:${i}`, source: l.source, target: l.target, predicate: 'DOCUMENTS',
        label: 'reports', kind: 'provenance', negated: false, claimType: null, papers: [l.paper_id],
        evidenceCount: l.evidence_count, validation: [], grounding: null, contexts: '',
        evidence: parseEvidence(l.evidence_json),
      });
    } else {
      const s = l as RawSemanticLink;
      edges.push({
        id: s.id || `sem:${i}`, source: s.source, target: s.target, predicate: s.predicate,
        label: (s.negated ? 'not ' : '') + (PREDICATE_LABEL[s.predicate] ?? s.predicate.toLowerCase()),
        kind: 'semantic', negated: !!s.negated, claimType: (s.claim_type || null) as ClaimType,
        papers: splitList(s.papers), evidenceCount: s.evidence_count,
        validation: splitList(s.validation_statuses), grounding: s.grounding_review || null,
        contexts: s.contexts ?? '', evidence: parseEvidence(s.evidence_json),
      });
    }
  });

  const out = new Map<string, GEdge[]>();
  const inc = new Map<string, GEdge[]>();
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    if (!inc.has(e.target)) inc.set(e.target, []);
    out.get(e.source)!.push(e);
    inc.get(e.target)!.push(e);
  }

  papers.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const paperById = new Map(papers.map((p) => [p.paperId, p]));

  const paperEntities = new Map<string, Set<string>>();
  for (const p of papers) paperEntities.set(p.paperId, new Set());
  for (const n of nodes.values()) {
    if (n.type === 'Paper') continue;
    for (const pid of n.papers) paperEntities.get(pid)?.add(n.id);
  }

  return { nodes, edges, out, inc, papers, paperById, paperEntities, typeCounts };
}

export function paperShortLabel(m: PaperMeta): string {
  const num = m.rank != null ? String(m.rank).padStart(2, '0') : '--';
  return `P${num} · ${m.firstAuthor ? m.firstAuthor + ' ' : ''}${m.year ?? ''}`.trim();
}
