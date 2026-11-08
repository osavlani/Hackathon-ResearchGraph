import type { GraphIndex } from '../data/graphIndex';
import type { Evidence, GEdge, GNode, NodeType, PaperMeta } from '../types';
import type { Gap } from './gaps';
import type { Citation, PairCitations } from './grounding';
import { SHARED_TYPES } from './related';
import { jaccard, tokens } from './text';

/**
 * Paper Relationship Explorer: a grounded comparison of two papers.
 *
 * Everything here is read from the existing graph and never written back:
 *  - an entity "belongs" to a paper only if the node lists the paper AND carries a quote from it;
 *  - a path hop is either such a paper→entity mention, a backend semantic edge, or a backend
 *    Finding/Hypothesis node (with its DOCUMENTS provenance) that INVOLVES both entities;
 *  - nothing is called agreement or contradiction from concept overlap alone;
 *  - a direct citation is reported only from a paper→paper CITES edge in the graph or a *verified*
 *    reference-list match from the local grounding pipeline; ambiguous matches are listed separately.
 *    A citation is never read as agreement. (Original note:) the graph itself has no CITES edge
 *    has none, since the extractor keeps no reference lists). Author–year mentions are reported separately.
 */

// ---------------- vocabulary ----------------

/** How a paper uses an entity, strongest first. */
export type Role = 'results' | 'discussed' | 'mentioned';
export const ROLE_LABEL: Record<Role, string> = {
  results: 'in reported results',
  discussed: 'hypothesized or cited only',
  mentioned: 'named only',
};
const ROLE_RANK: Record<Role, number> = { results: 0, discussed: 1, mentioned: 2 };

/** Pipeline validation of a quote. ResearchGraph itself never re-reads the PDFs. */
export type QuoteStatus = 'validated' | 'approximate' | 'unvalidated';
export function quoteStatus(e: Evidence): QuoteStatus {
  if (e.validationStatus === 'verified') return 'validated';
  if (e.validationStatus === 'fuzzy_verified') return 'approximate';
  return 'unvalidated';
}
const QUOTE_WEIGHT: Record<QuoteStatus, number> = { validated: 1, approximate: 0.85, unvalidated: 0.5 };

const METHOD_TYPES: NodeType[] = ['Method', 'EvaluationMethod', 'AIModel', 'ExperimentalCondition'];
const CONCEPT_TYPES: NodeType[] = ['Behavior', 'Concept', 'Mechanism'];
const UP = new Set(['INCREASES', 'ENABLES']);
/** Measurements (rates, scores, AUC…) are not phenomena or interventions; never pair them as "untested". */
const METRIC_RE = /\b(rates?|scores?|auc|roc|area under|errors?|accuracy|gaps?|curves?|metrics?|calibration|percentage|frequency)\b/i;
const DOWN = new Set(['REDUCES', 'MITIGATES']);

/** Labels too vague to explain why two papers are related. */
const GENERIC_RE = /^(the |a |an )?(current |frontier |large |small |modern |advanced |ai |language |)*(models?|llms?|systems?|agents?|assistants?|ai|training|fine-?tuning|evaluations?|experiments?|prompting|prompts?|reasoning|behaviou?rs?|safety|alignment|capabilit(y|ies)|tasks?|data|datasets?|methods?|results?)$/i;
export function isGeneric(n: GNode): boolean {
  return tokens(n.label).length === 0 || GENERIC_RE.test(n.label.trim());
}

// ---------------- per-index cache ----------------

interface Prep {
  N: number;
  /** paper_id -> (entity id -> role, with the edge / finding ids that justify it) */
  roles: Map<string, Map<string, { role: Role; basis: string[] }>>;
  /** paper_id -> Finding/Hypothesis nodes it DOCUMENTS */
  documents: Map<string, GNode[]>;
  /** finding id -> paper_id via its DOCUMENTS edge */
  findingPaper: Map<string, string>;
  edgeById: Map<string, GEdge>;
}
const cache = new WeakMap<GraphIndex, Prep>();

function prep(ix: GraphIndex): Prep {
  const hit = cache.get(ix);
  if (hit) return hit;
  const roles = new Map<string, Map<string, { role: Role; basis: string[] }>>();
  const documents = new Map<string, GNode[]>();
  const findingPaper = new Map<string, string>();
  const edgeById = new Map(ix.edges.map((e) => [e.id, e]));
  const setRole = (pid: string, id: string, role: Role, basis: string) => {
    if (!roles.has(pid)) roles.set(pid, new Map());
    const m = roles.get(pid)!;
    const cur = m.get(id);
    if (!cur || ROLE_RANK[role] < ROLE_RANK[cur.role]) m.set(id, { role, basis: [basis] });
    else if (cur.role === role && cur.basis.length < 4) cur.basis.push(basis);
  };
  // every listed entity is at least "named" (it has a quote from that paper)
  for (const n of ix.nodes.values()) {
    if (n.type === 'Paper') continue;
    for (const pid of n.papers) if (n.evidence.some((e) => e.paperId === pid)) setRole(pid, n.id, 'mentioned', n.id);
  }
  for (const e of ix.edges) {
    if (e.kind === 'provenance') {
      const pid = e.papers[0];
      const f = ix.nodes.get(e.target)!;
      if (!documents.has(pid)) documents.set(pid, []);
      documents.get(pid)!.push(f);
      findingPaper.set(f.id, pid);
      for (const inv of ix.out.get(f.id) ?? []) {
        if (inv.predicate !== 'INVOLVES') continue;
        setRole(pid, inv.target, f.type === 'Finding' ? 'results' : 'discussed', f.id);
      }
    } else if (e.kind === 'semantic' && e.predicate !== 'INVOLVES') {
      for (const pid of e.papers) {
        const role: Role = e.claimType === 'observed' ? 'results' : 'discussed';
        setRole(pid, e.source, role, e.id);
        setRole(pid, e.target, role, e.id);
      }
    }
  }
  const p: Prep = { N: ix.papers.length, roles, documents, findingPaper, edgeById };
  cache.set(ix, p);
  return p;
}

/** 0..1, higher = more specific. Inverse paper frequency, heavily discounted for vague labels. */
export function specificity(ix: GraphIndex, n: GNode): number {
  const N = Math.max(2, ix.papers.length);
  const s = Math.log(1 + N / Math.max(1, n.paperCount)) / Math.log(1 + N);
  return isGeneric(n) ? s * 0.1 : s;
}

/** Quotes from `pid` only, best-validated first. */
export function evidenceFor(n: GNode, pid: string): Evidence[] {
  return n.evidence
    .filter((e) => e.paperId === pid)
    .sort((a, b) => QUOTE_WEIGHT[quoteStatus(b)] - QUOTE_WEIGHT[quoteStatus(a)] || (a.page ?? 1e9) - (b.page ?? 1e9));
}

// ---------------- result types ----------------

export interface PaperUse { paperId: string; role: Role; basis: string[]; evidence: Evidence[] }
export interface SharedItem { node: GNode; a: PaperUse; b: PaperUse; specificity: number; generic: boolean }
export interface UniqueItem { node: GNode; use: PaperUse }

export type Hop =
  | { kind: 'mention'; paperId: string; nodeId: string; evidence: Evidence[] }
  | { kind: 'edge'; edge: GEdge }
  | { kind: 'finding'; finding: GNode; paperId: string; involves: [GEdge, GEdge] };

export interface RelPath {
  kind: 'shared' | 'linked' | 'co-studied';
  /** node ids in order, starting at paper:A and ending at paper:B */
  nodes: string[];
  hops: Hop[];
  score: number;
  text: string;
}

export interface FindingPair { a: GNode; b: GNode; via: GNode[]; score: number }
export interface SameRelation { a: GEdge; b: GEdge; relation: 'same-direction' | 'opposite-direction' | 'different-relationship' }
export interface MentionHit { from: string; to: string; ambiguous: boolean; evidence: Evidence }
export interface Combination { kind: 'method-behavior'; left: GNode; leftPaper: string; right: GNode; rightPaper: string; score: number }
export interface CoverageNote { kind: 'no-reference-data' | 'sparse' | 'naming-split' | 'mention-without-overlap' | 'cited-without-overlap'; text: string; nodes?: [string, string] }

export interface Comparison {
  a: PaperMeta;
  b: PaperMeta;
  citation: {
    /** established: a CITES edge or a verified reference-list match; not-found: both reference lists were
     *  searched and neither cites the other; not-established: no reference data for at least one paper,
     *  or only an unconfirmed (ambiguous) reference match exists */
    status: 'established' | 'not-found' | 'not-established';
    reason: string;
    edges: GEdge[];
    aCitesB: Citation[];
    bCitesA: Citation[];
    ambiguous: Citation[];
    mentions: MentionHit[];
  };
  concepts: { specific: SharedItem[]; generic: SharedItem[] };
  methods: { methodology: SharedItem[]; terminology: SharedItem[]; generic: SharedItem[] };
  findings: { a: GNode[]; b: GNode[]; related: FindingPair[]; sameRelations: SameRelation[] };
  differences: { methodsA: UniqueItem[]; methodsB: UniqueItem[]; conceptsA: UniqueItem[]; conceptsB: UniqueItem[] };
  paths: RelPath[];
  gaps: { engine: Gap[]; combinations: Combination[]; coverage: CoverageNote[] };
  entityCount: { a: number; b: number };
}

// ---------------- helpers ----------------

function paperUse(p: Prep, n: GNode, pid: string): PaperUse | null {
  const r = p.roles.get(pid)?.get(n.id);
  const ev = evidenceFor(n, pid);
  if (!r || !ev.length) return null;
  return { paperId: pid, role: r.role, basis: r.basis, evidence: ev };
}

const bestQuote = (ev: Evidence[]) => (ev.length ? QUOTE_WEIGHT[quoteStatus(ev[0])] : 0);
const claimWeight = (e: GEdge) =>
  (e.claimType === 'observed' ? 1 : e.claimType === 'cited' ? 0.6 : 0.5) * (e.grounding === 'review' ? 0.7 : 1) * bestQuote(e.evidence);

function polarity(e: GEdge): { fam: string; sign: number } {
  const fam = UP.has(e.predicate) || DOWN.has(e.predicate) ? 'EFFECT' : e.predicate;
  const base = DOWN.has(e.predicate) ? -1 : 1;
  return { fam, sign: e.negated ? -base : base };
}

/** "<Surname> … <Year>" mentions of paper `to` inside quotes extracted from paper `from`. */
function mentions(ix: GraphIndex, from: string, to: string): MentionHit[] {
  const t = ix.paperById.get(to);
  if (!t?.firstAuthor || !t.year) return [];
  const re = new RegExp(`\\b${t.firstAuthor.replace(/^vander/i, 'van der ?')}\\b[^.;)]{0,40}?\\b${t.year}\\b`, 'i');
  const ambiguous = ix.papers.filter((p) => p.firstAuthor === t.firstAuthor && p.year === t.year).length > 1;
  const seen = new Set<string>();
  const out: MentionHit[] = [];
  const all = [...ix.nodes.values()].flatMap((n) => n.evidence).concat(ix.edges.flatMap((e) => e.evidence));
  for (const ev of all) {
    if (ev.paperId !== from) continue;
    const text = `${ev.passage} ${ev.context ?? ''}`.replace(/et al\./g, 'et al');
    if (!re.test(text)) continue;
    const k = ev.chunkId ?? ev.passage;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ from, to, ambiguous, evidence: ev });
  }
  return out;
}

// ---------------- main ----------------

export function comparePapers(ix: GraphIndex, aId: string, bId: string, gaps: Gap[] = [], refs: PairCitations | null = null): Comparison {
  const p = prep(ix);
  const a = ix.paperById.get(aId);
  const b = ix.paperById.get(bId);
  if (!a || !b) throw new Error(`Unknown paper: ${!a ? aId : bId}`);

  const entsOf = (pid: string) =>
    [...(ix.paperEntities.get(pid) ?? [])].map((id) => ix.nodes.get(id)!).filter((n) => SHARED_TYPES.includes(n.type) && paperUse(p, n, pid));
  const entsA = entsOf(aId);
  const entsB = entsOf(bId);
  const inA = new Set(entsA.map((n) => n.id));
  const inB = new Set(entsB.map((n) => n.id));

  // ---- citation ----
  const citeEdges = ix.edges.filter(
    (e) => e.predicate === 'CITES' && ((e.source === a.nodeId && e.target === b.nodeId) || (e.source === b.nodeId && e.target === a.nodeId)),
  );
  const mentionHits = [...mentions(ix, aId, bId), ...mentions(ix, bId, aId)];
  const aCitesB = refs?.aCitesB ?? [];
  const bCitesA = refs?.bCitesA ?? [];
  const lbl = (pid: string) => (ix.paperById.get(pid)?.rank != null ? `P${String(ix.paperById.get(pid)!.rank).padStart(2, '0')}` : pid);
  const base = { edges: citeEdges, aCitesB, bCitesA, ambiguous: refs?.ambiguous ?? [], mentions: mentionHits };
  const citation: Comparison['citation'] =
    citeEdges.length ? { ...base, status: 'established', reason: 'The graph contains a citation edge between these papers.' }
      : aCitesB.length || bCitesA.length ? { ...base, status: 'established', reason: 'Matched in the citing paper’s own reference list.' }
      // an unconfirmed (ambiguous) match is never "not found": the reference list may well cite the paper
      : refs?.ambiguous.length ? { ...base, status: 'not-established', reason: `A possible match in ${[...new Set(refs.ambiguous.map((c) => lbl(c.source)))].join(' and ')}’s reference list could not be confirmed, so it is not counted as a citation.` }
      : refs?.bothChecked ? { ...base, status: 'not-found', reason: 'Both reference lists were searched automatically and no entry for the other paper was found. Unusual reference formatting can be missed, so this is not proof that neither paper cites the other.' }
      : refs ? { ...base, status: 'not-established', reason: `The reference list of ${refs.unchecked.map(lbl).join(' and ')} could not be located, so a citation can be neither confirmed nor ruled out.` }
      : { ...base, status: 'not-established', reason: 'No reference-list data is loaded, so a direct citation can be neither confirmed nor ruled out.' };

  // ---- shared entities ----
  const shared: SharedItem[] = [];
  for (const n of entsA) {
    if (!inB.has(n.id)) continue;
    shared.push({ node: n, a: paperUse(p, n, aId)!, b: paperUse(p, n, bId)!, specificity: specificity(ix, n), generic: isGeneric(n) });
  }
  const byRoleThenSpec = (x: SharedItem, y: SharedItem) =>
    ROLE_RANK[x.a.role] + ROLE_RANK[x.b.role] - (ROLE_RANK[y.a.role] + ROLE_RANK[y.b.role]) || y.specificity - x.specificity;
  shared.sort(byRoleThenSpec);
  const concepts = {
    specific: shared.filter((s) => CONCEPT_TYPES.includes(s.node.type) && !s.generic).sort((x, y) => y.specificity - x.specificity),
    generic: shared.filter((s) => CONCEPT_TYPES.includes(s.node.type) && s.generic),
  };
  const sharedMethods = shared.filter((s) => METHOD_TYPES.includes(s.node.type));
  const methods = {
    methodology: sharedMethods.filter((s) => !s.generic && s.a.role === 'results' && s.b.role === 'results'),
    terminology: sharedMethods.filter((s) => !s.generic && !(s.a.role === 'results' && s.b.role === 'results')),
    generic: sharedMethods.filter((s) => s.generic),
  };

  // ---- differences ----
  const uniq = (ents: GNode[], other: Set<string>, pid: string, types: NodeType[]) =>
    ents
      .filter((n) => !other.has(n.id) && types.includes(n.type))
      .map((n) => ({ node: n, use: paperUse(p, n, pid)! }))
      .sort((x, y) => ROLE_RANK[x.use.role] - ROLE_RANK[y.use.role] || y.use.evidence.length - x.use.evidence.length);
  const differences = {
    methodsA: uniq(entsA, inB, aId, METHOD_TYPES),
    methodsB: uniq(entsB, inA, bId, METHOD_TYPES),
    conceptsA: uniq(entsA, inB, aId, CONCEPT_TYPES),
    conceptsB: uniq(entsB, inA, bId, CONCEPT_TYPES),
  };

  // ---- findings ----
  const docsA = p.documents.get(aId) ?? [];
  const docsB = p.documents.get(bId) ?? [];
  const involves = (f: GNode) =>
    (ix.out.get(f.id) ?? []).filter((e) => e.predicate === 'INVOLVES').map((e) => ix.nodes.get(e.target)!).filter((n) => SHARED_TYPES.includes(n.type) && !isGeneric(n));
  const invB = docsB.map((f) => ({ f, ids: new Set(involves(f).map((n) => n.id)) }));
  const related: FindingPair[] = [];
  for (const fa of docsA) {
    const ia = involves(fa);
    for (const { f: fb, ids } of invB) {
      const via = ia.filter((n) => ids.has(n.id));
      if (!via.length) continue;
      related.push({ a: fa, b: fb, via, score: via.reduce((s, n) => s + specificity(ix, n), 0) * (fa.type === 'Finding' && fb.type === 'Finding' ? 1 : 0.7) });
    }
  }
  related.sort((x, y) => y.score - x.score);
  const uses = new Map<string, number>();
  const relatedDiverse = related.filter((r) => {
    const ka = uses.get(r.a.id) ?? 0;
    const kb = uses.get(r.b.id) ?? 0;
    if (ka >= 2 || kb >= 2) return false;
    uses.set(r.a.id, ka + 1);
    uses.set(r.b.id, kb + 1);
    return true;
  });
  const claimEdges = (pid: string) => ix.edges.filter((e) => e.kind === 'semantic' && e.predicate !== 'INVOLVES' && e.papers.includes(pid));
  const ceB = claimEdges(bId);
  const sameRelations: SameRelation[] = [];
  for (const ea of claimEdges(aId)) {
    for (const eb of ceB) {
      if (ea.source !== eb.source || ea.target !== eb.target) continue;
      const pa = polarity(ea);
      const pb = polarity(eb);
      sameRelations.push({ a: ea, b: eb, relation: pa.fam !== pb.fam ? 'different-relationship' : pa.sign === pb.sign ? 'same-direction' : 'opposite-direction' });
    }
  }
  const byEvidence = (x: GNode, y: GNode) => (x.type === y.type ? 0 : x.type === 'Finding' ? -1 : 1) || y.evidence.length - x.evidence.length;

  // ---- paths ----
  const paths = new Map<string, RelPath>();
  const keep = (key: string, path: RelPath) => {
    if ((paths.get(key)?.score ?? -1) < path.score) paths.set(key, path);
  };
  const mention = (pid: string, n: GNode): Extract<Hop, { kind: 'mention' }> => ({ kind: 'mention', paperId: pid, nodeId: n.id, evidence: evidenceFor(n, pid) });
  const label = (pid: string) => (ix.paperById.get(pid)?.rank != null ? `P${String(ix.paperById.get(pid)!.rank).padStart(2, '0')}` : pid);
  for (const s of shared) {
    if (s.generic) continue;
    keep(s.node.id, {
      kind: 'shared', nodes: [a.nodeId, s.node.id, b.nodeId], hops: [mention(aId, s.node), mention(bId, s.node)],
      score: s.specificity * bestQuote(s.a.evidence) * bestQuote(s.b.evidence) * (s.a.role === 'results' && s.b.role === 'results' ? 1 : 0.85),
      text: `Both papers include “${s.node.label}”.`,
    });
  }
  const onlyA = entsA.filter((n) => !inB.has(n.id) && !isGeneric(n));
  const onlyB = new Set(entsB.filter((n) => !inA.has(n.id) && !isGeneric(n)).map((n) => n.id));
  const onlyAIds = new Set(onlyA.map((n) => n.id));
  for (const e of ix.edges) {
    if (e.kind !== 'semantic' || e.predicate === 'INVOLVES') continue;
    const [x, y] = onlyAIds.has(e.source) && onlyB.has(e.target) ? [e.source, e.target] : onlyAIds.has(e.target) && onlyB.has(e.source) ? [e.target, e.source] : [null, null];
    if (!x || !y) continue;
    const X = ix.nodes.get(x)!;
    const Y = ix.nodes.get(y)!;
    const hA = mention(aId, X);
    const hB = mention(bId, Y);
    keep(`${x}|${y}`, {
      kind: 'linked', nodes: [a.nodeId, x, y, b.nodeId], hops: [hA, { kind: 'edge', edge: e }, hB],
      score: 0.7 * specificity(ix, X) * specificity(ix, Y) * bestQuote(hA.evidence) * bestQuote(hB.evidence) * claimWeight(e),
      text: `${label(e.papers[0] ?? '')} reports “${ix.nodes.get(e.source)!.label}” ${e.label} “${ix.nodes.get(e.target)!.label}”, linking a topic of each paper.`,
    });
  }
  for (const [fid, fpid] of p.findingPaper) {
    const f = ix.nodes.get(fid)!;
    const inv = (ix.out.get(fid) ?? []).filter((e) => e.predicate === 'INVOLVES');
    const xs = inv.filter((e) => onlyAIds.has(e.target));
    const ys = inv.filter((e) => onlyB.has(e.target));
    for (const ex of xs) {
      for (const ey of ys) {
        const X = ix.nodes.get(ex.target)!;
        const Y = ix.nodes.get(ey.target)!;
        const hA = mention(aId, X);
        const hB = mention(bId, Y);
        keep(`${X.id}|${Y.id}`, {
          kind: 'co-studied', nodes: [a.nodeId, X.id, fid, Y.id, b.nodeId],
          hops: [hA, { kind: 'finding', finding: f, paperId: fpid, involves: [ex, ey] }, hB],
          score: 0.6 * (f.type === 'Finding' ? 1 : 0.6) * specificity(ix, X) * specificity(ix, Y) * bestQuote(hA.evidence) * bestQuote(hB.evidence) * bestQuote(f.evidence),
          text: `A ${f.type === 'Finding' ? 'finding' : 'hypothesis'} in ${label(fpid)} involves both “${X.label}” and “${Y.label}”.`,
        });
      }
    }
  }
  const rankedPaths = [...paths.values()].filter((pt) => validatePath(ix, pt, aId, bId).ok).sort((x, y) => y.score - x.score);

  // ---- gaps & coverage ----
  const engine = gaps.filter((g) => g.papers.includes(aId) && g.papers.includes(bId));
  // y counts as linked to x if x touches y, or a near-synonym of y, through any edge or shared finding
  const neighbours = (x: string) => {
    const s = new Set<string>();
    for (const e of [...(ix.out.get(x) ?? []), ...(ix.inc.get(x) ?? [])]) {
      if (e.kind !== 'semantic') continue;
      if (e.predicate === 'INVOLVES') for (const f of ix.out.get(e.source) ?? []) { if (f.predicate === 'INVOLVES') s.add(f.target); }
      else s.add(e.source === x ? e.target : e.source);
    }
    return s;
  };
  const linkedAnywhere = (x: string, y: string) => {
    const ty = new Set(tokens(ix.nodes.get(y)!.label));
    for (const id of neighbours(x)) {
      if (id === y) return true;
      const n = ix.nodes.get(id)!;
      if (CONCEPT_TYPES.includes(n.type) && jaccard(ty, new Set(tokens(n.label))) >= 0.5) return true;
    }
    return false;
  };
  const combinations: Combination[] = [];
  const combos = (lp: string, rp: string, lefts: GNode[], rightsAll: GNode[], rightExcl: Set<string>) => {
    const roleOf = (pid: string, n: GNode) => p.roles.get(pid)?.get(n.id)?.role;
    const rights = rightsAll.filter((n) => n.type === 'Behavior' && !rightExcl.has(n.id) && !isGeneric(n) && !METRIC_RE.test(n.label) && roleOf(rp, n) === 'results');
    for (const l of lefts) {
      if (isGeneric(l) || METRIC_RE.test(l.label) || roleOf(lp, l) !== 'results') continue;
      if (l.type !== 'Method' && l.type !== 'EvaluationMethod') continue;
      const kind = 'method-behavior' as const;
      for (const r of rights) {
        if (linkedAnywhere(l.id, r.id)) continue;
        combinations.push({ kind, left: l, leftPaper: lp, right: r, rightPaper: rp, score: specificity(ix, l) * specificity(ix, r) * (1 + 0.1 * Math.min(5, evidenceFor(r, rp).length)) });
      }
    }
  };
  combos(aId, bId, entsA.filter((n) => !inB.has(n.id)), entsB, inA);
  combos(bId, aId, entsB.filter((n) => !inA.has(n.id)), entsA, inB);
  combinations.sort((x, y) => y.score - x.score);
  const perLeft = new Map<string, number>();
  const perRight = new Map<string, number>();
  const diverse = combinations.filter((k) => {
    const nl = perLeft.get(k.left.id) ?? 0;
    const nr = perRight.get(k.right.id) ?? 0;
    if (nl >= 2 || nr >= 2) return false;
    perLeft.set(k.left.id, nl + 1);
    perRight.set(k.right.id, nr + 1);
    return true;
  });

  const coverage: CoverageNote[] = [];
  if (citation.status === 'not-established')
    coverage.push({ kind: 'no-reference-data', text: refs ? citation.reason : 'Reference lists were not extracted, so citation links between papers are unknown.' });
  const noOverlap = !concepts.specific.length && !methods.methodology.length && !methods.terminology.length;
  for (const [m, n] of [[a, entsA.length], [b, entsB.length]] as const)
    if (n < 25) coverage.push({ kind: 'sparse', text: `${label(m.paperId)} has only ${n} extracted concepts, methods and models, so overlap with it is probably underestimated.` });
  if (citation.status === 'established' && noOverlap)
    coverage.push({ kind: 'cited-without-overlap', text: 'One paper cites the other, yet the graph links them through no specific concept, method or model. Extraction coverage for this pair is probably incomplete. The citation alone says nothing about what the papers share or whether they agree.' });
  else if (mentionHits.length && noOverlap)
    coverage.push({ kind: 'mention-without-overlap', text: 'One paper names the other in an extracted passage, yet they share no specific entity in the graph. The extraction may be incomplete.' });
  const tok = (n: GNode) => new Set(tokens(n.label));
  const group = (t: NodeType) => (CONCEPT_TYPES.includes(t) ? 'c' : t === 'AIModel' ? 'm' : t === 'ExperimentalCondition' ? 'x' : 'k');
  const splits: CoverageNote[] = [];
  for (const x of onlyA) {
    for (const yid of onlyB) {
      const y = ix.nodes.get(yid)!;
      if (group(x.type) !== group(y.type) || x.type === 'AIModel') continue;
      const tx = tok(x);
      const ty = tok(y);
      const sameStems = tx.size > 0 && tx.size === ty.size && [...tx].every((t) => ty.has(t));
      if (sameStems || (Math.min(tx.size, ty.size) >= 2 && jaccard(tx, ty) >= 0.6))
        splits.push({ kind: 'naming-split', text: `“${x.label}” (${label(aId)}) and “${y.label}” (${label(bId)}) may name the same thing; the graph keeps them separate.`, nodes: [x.id, y.id] });
    }
  }
  coverage.push(...splits.slice(0, 6));

  return {
    a, b, citation, concepts, methods,
    findings: { a: [...docsA].sort(byEvidence), b: [...docsB].sort(byEvidence), related: relatedDiverse.slice(0, 12), sameRelations },
    differences, paths: rankedPaths.slice(0, 10),
    gaps: { engine, combinations: diverse.slice(0, 6), coverage },
    entityCount: { a: entsA.length, b: entsB.length },
  };
}

// ---------------- validation (used at runtime and by scripts/test-compare.ts) ----------------

/** A path is valid only if every hop exists in the graph and every quote comes from the paper it is attributed to. */
export function validatePath(ix: GraphIndex, path: RelPath, aId: string, bId: string): { ok: boolean; why?: string } {
  const p = prep(ix);
  if (path.nodes[0] !== `paper:${aId}` || path.nodes[path.nodes.length - 1] !== `paper:${bId}`) return { ok: false, why: 'endpoints' };
  for (const id of path.nodes) if (!ix.nodes.has(id)) return { ok: false, why: `missing node ${id}` };
  for (const h of path.hops) {
    if (h.kind === 'mention') {
      const n = ix.nodes.get(h.nodeId)!;
      if (!n.papers.includes(h.paperId)) return { ok: false, why: `${h.nodeId} not listed for ${h.paperId}` };
      if (!h.evidence.length || h.evidence.some((e) => e.paperId !== h.paperId)) return { ok: false, why: `evidence of ${h.nodeId} not from ${h.paperId}` };
    } else if (h.kind === 'edge') {
      const e = p.edgeById.get(h.edge.id);
      if (!e || e !== h.edge) return { ok: false, why: `edge ${h.edge.id} not in graph` };
      if (!path.nodes.includes(e.source) || !path.nodes.includes(e.target)) return { ok: false, why: 'edge endpoints off path' };
      if (!e.evidence.length || e.evidence.some((ev) => !e.papers.includes(ev.paperId))) return { ok: false, why: `edge ${e.id} evidence/paper mismatch` };
    } else {
      if (p.findingPaper.get(h.finding.id) !== h.paperId) return { ok: false, why: `finding ${h.finding.id} not documented by ${h.paperId}` };
      for (const inv of h.involves) {
        if (p.edgeById.get(inv.id) !== inv || inv.source !== h.finding.id || !path.nodes.includes(inv.target)) return { ok: false, why: `INVOLVES ${inv.id} invalid` };
      }
    }
  }
  return { ok: true };
}
