import type { GraphIndex } from '../data/graphIndex';
import { paperShortLabel } from '../data/graphIndex';
import type { GEdge, GNode, NodeType } from '../types';
import type { Gap } from './gaps';
import { GAP_KIND_LABEL } from './gaps';
import type { CitationIndex } from './related';
import { SHARED_TYPES, alignedPapers, usesEdge } from './related';
import { searchTopic } from './search';
import type { Comparison } from './compare';

/** What the graph is centred on. */
export type View =
  | { mode: 'overview' }
  | { mode: 'topic'; query: string }
  | { mode: 'paper'; paperId: string }
  | { mode: 'entity'; nodeId: string }
  | { mode: 'gap'; gapId: string }
  | { mode: 'compare'; a: string | null; b: string | null };

export type Role = 'focus' | 'match' | 'aligned' | 'context' | 'gap' | 'resolution';

export interface ViewGraph {
  nodes: GNode[];
  edges: GEdge[];
  roles: Map<string, Role>;
  /** display label override (papers get "P01 · Greenblatt 2024") */
  display: Map<string, string>;
  total: number; // nodes in the full graph (for "Showing N of TOTAL")
  note: string;
  /** edges to draw prominently (compare: the connecting paths) */
  emphasis?: Set<string>;
  /** nodes pinned during layout (compare: paper A left, paper B right) */
  fixed?: { id: string; x: number; y: number }[];
}

export interface ViewOptions {
  showFindings: boolean; // Finding / Hypothesis nodes are hidden by default (as in the mockup)
  showGaps: boolean;
  hiddenTypes: Set<NodeType>;
}

export function gapNode(g: Gap): GNode {
  return {
    id: g.id, label: `${GAP_KIND_LABEL[g.kind]}: ${g.title}`, type: 'Gap', papers: g.papers, paperCount: g.papers.length,
    mentionCount: 0, sourcePages: '', firstPassage: g.description, aliases: [], evidence: [], perPaper: new Map(),
  };
}

function gapEdge(g: Gap, target: string): GEdge {
  return {
    id: `gapedge:${g.id}:${target}`, source: target, target: g.id, predicate: 'LEADS_TO_GAP', label: 'leads to gap', kind: 'gap',
    negated: false, claimType: null, papers: g.papers, evidenceCount: 0, validation: [], grounding: null, contexts: '', evidence: [],
    note: 'Derived by the gap engine (src/analysis/gaps.ts).',
  };
}
function resolveEdge(g: Gap, from: string, rationale: string): GEdge {
  return {
    id: `resolve:${g.id}:${from}`, source: from, target: g.id, predicate: 'COULD_RESOLVE', label: 'could resolve', kind: 'gap',
    negated: false, claimType: null, papers: [], evidenceCount: 0, validation: [], grounding: null, contexts: '', evidence: [], note: rationale,
  };
}

export function buildView(ix: GraphIndex, view: View, gaps: Gap[], cites: CitationIndex, opt: ViewOptions, cmp: Comparison | null = null): ViewGraph {
  const nodes = new Map<string, GNode>();
  const roles = new Map<string, Role>();
  const extraEdges: GEdge[] = [];
  const add = (id: string, role: Role) => {
    const n = ix.nodes.get(id);
    if (!n) return;
    if (!opt.showFindings && (n.type === 'Finding' || n.type === 'Hypothesis') && role !== 'focus' && role !== 'match') return;
    if (opt.hiddenTypes.has(n.type) && role !== 'focus') return;
    nodes.set(id, n);
    const prev = roles.get(id);
    const rank: Role[] = ['focus', 'match', 'gap', 'resolution', 'aligned', 'context'];
    if (!prev || rank.indexOf(role) < rank.indexOf(prev)) roles.set(id, role);
  };
  const addGap = (g: Gap, withResolutions: boolean) => {
    if (!opt.showGaps || opt.hiddenTypes.has('Gap')) return;
    const gn = gapNode(g);
    nodes.set(gn.id, gn);
    roles.set(gn.id, roles.get(gn.id) ?? 'gap');
    for (const f of g.focus) if (nodes.has(f)) extraEdges.push(gapEdge(g, f));
    if (withResolutions)
      for (const r of g.resolutions) {
        if (!r.nodeId) continue;
        add(r.nodeId, 'resolution');
        if (nodes.has(r.nodeId)) extraEdges.push(resolveEdge(g, r.nodeId, r.rationale));
        for (const p of r.paperIds) add(`paper:${p}`, 'context');
      }
  };
  const paperEdges = (pid: string, ids: Iterable<string>) => {
    for (const id of ids) {
      const n = nodes.get(id);
      if (n && n.type !== 'Paper' && n.type !== 'Gap' && n.papers.includes(pid)) extraEdges.push(usesEdge(`paper:${pid}`, pid, n));
    }
  };
  let note = '';
  const emphasis = new Set<string>();
  let fixed: ViewGraph['fixed'];

  if (view.mode === 'overview') {
    for (const p of ix.papers) add(p.nodeId, 'context');
    for (const n of ix.nodes.values()) if (SHARED_TYPES.includes(n.type) && n.paperCount >= 2) add(n.id, 'match');
    for (const g of gaps.slice(0, 12)) addGap(g, false);
    note = 'Overview: all papers, entities shared by 2+ papers, and the top 12 gaps.';
  } else if (view.mode === 'topic') {
    const r = searchTopic(ix, view.query);
    for (const h of r.entities.slice(0, 14)) add(h.node.id, 'match');
    for (const p of r.papers) {
      add(`paper:${p.paperId}`, 'match');
      for (const a of alignedPapers(ix, p.paperId, cites, 2)) add(`paper:${a.paperId}`, 'aligned');
      // what the matched paper uses: its most-evidenced shared entities
      const ents = [...(ix.paperEntities.get(p.paperId) ?? [])]
        .map((id) => ix.nodes.get(id)!)
        .filter((n) => ['Method', 'EvaluationMethod', 'AIModel'].includes(n.type))
        .sort((a, b) => (b.perPaper.get(p.paperId) ?? 0) - (a.perPaper.get(p.paperId) ?? 0))
        .slice(0, 4);
      for (const n of ents) add(n.id, 'context');
    }
    const matched = new Set(r.entities.map((h) => h.node.id));
    for (const g of gaps) if (g.focus.some((f) => matched.has(f))) addGap(g, false);
    note = r.entities.length
      ? `Topic “${view.query}”: ${r.entities.length} matching entities, ${r.papers.length} papers ranked by evidence, their aligned papers and what they use.`
      : `No entity or paper matches “${view.query}”.`;
  } else if (view.mode === 'paper') {
    const pid = view.paperId;
    add(`paper:${pid}`, 'focus');
    const ents = [...(ix.paperEntities.get(pid) ?? [])]
      .map((id) => ix.nodes.get(id)!)
      .sort((a, b) => (b.perPaper.get(pid) ?? 0) - (a.perPaper.get(pid) ?? 0) || b.paperCount - a.paperCount);
    let k = 0;
    for (const n of ents) {
      const isLocal = n.type === 'Finding' || n.type === 'Hypothesis';
      if (isLocal && !opt.showFindings) continue;
      if (k++ >= (opt.showFindings ? 45 : 30)) break;
      add(n.id, 'context');
    }
    for (const a of alignedPapers(ix, pid, cites, 5)) {
      add(`paper:${a.paperId}`, 'aligned');
      extraEdges.push({
        id: `aligned:${pid}:${a.paperId}`, source: `paper:${pid}`, target: `paper:${a.paperId}`, predicate: 'ALIGNED', kind: 'derived-aligned',
        label: `aligned · ${a.shared.length} shared`, negated: false, claimType: null, papers: [pid, a.paperId], evidenceCount: 0,
        validation: [], grounding: null, contexts: '', evidence: [],
        note: `Similarity ${a.score.toFixed(2)} (IDF-weighted shared entities). Shared: ${a.shared.slice(0, 8).map((s) => s.label).join(', ')}`,
      });
      for (const s of a.shared.slice(0, 3)) add(s.id, 'context');
    }
    for (const c of cites.outgoing(pid)) {
      add(`paper:${c.to}`, 'context');
      extraEdges.push(citeEdge(pid, c.to, c.n, c.ambiguous, c.sample));
    }
    for (const c of cites.incoming(pid)) {
      add(`paper:${c.from}`, 'context');
      extraEdges.push(citeEdge(c.from, pid, c.n, c.ambiguous, c.sample));
    }
    for (const g of gaps.filter((g) => g.papers.includes(pid)).slice(0, 6)) addGap(g, false);
    for (const p of [...nodes.values()].filter((n) => n.type === 'Paper')) paperEdges(p.paperId!, nodes.keys());
    note = `Paper focus: its entities, aligned papers (shared entities), in-corpus mentions, and gaps it touches.`;
  } else if (view.mode === 'entity') {
    const n = ix.nodes.get(view.nodeId);
    if (n) {
      add(n.id, 'focus');
      const nb = [...(ix.out.get(n.id) ?? []), ...(ix.inc.get(n.id) ?? [])].filter((e) => e.kind !== 'provenance');
      nb.sort((a, b) => b.evidenceCount - a.evidenceCount);
      for (const e of nb.slice(0, 40)) add(e.source === n.id ? e.target : e.source, 'context');
      for (const pid of n.papers) add(`paper:${pid}`, 'context');
      for (const g of gaps.filter((g) => g.focus.includes(n.id))) addGap(g, true);
      note = `Entity focus: 1-hop neighbours, papers that mention it, and gaps about it.`;
    }
  } else if (view.mode === 'compare') {
    for (const pid of [view.a, view.b]) if (pid) add(`paper:${pid}`, 'focus');
    if (cmp && view.a && view.b) {
      fixed = [{ id: cmp.a.nodeId, x: -420, y: 0 }, { id: cmp.b.nodeId, x: 420, y: 0 }];
      for (const p of cmp.paths.slice(0, 8)) {
        for (const id of p.nodes) {
          const n = ix.nodes.get(id)!;
          // path nodes are shown even when Findings are hidden: they are the explanation
          if (n.type !== 'Paper') { nodes.set(id, n); roles.set(id, roles.get(id) ?? 'match'); }
        }
        for (const h of p.hops) {
          if (h.kind === 'mention') {
            const ue = usesEdge(`paper:${h.paperId}`, h.paperId, ix.nodes.get(h.nodeId)!);
            extraEdges.push(ue);
            emphasis.add(ue.id);
          } else if (h.kind === 'edge') emphasis.add(h.edge.id);
          else for (const inv of h.involves) emphasis.add(inv.id);
        }
      }
      // automatically matched reference-list citations: dotted paper -> paper edge (direction = who cites whom)
      for (const c of [...cmp.citation.aCitesB, ...cmp.citation.bCitesA]) {
        const ce: GEdge = {
          id: `refcite:${c.source}:${c.target}`, source: `paper:${c.source}`, target: `paper:${c.target}`, predicate: 'CITES', kind: 'derived-cites',
          label: `cites · ref. list p. ${c.page}`, negated: false, claimType: null, papers: [c.source], evidenceCount: 1, validation: [], grounding: null, contexts: '', evidence: [],
          note: `Matched automatically in the citing paper’s reference list (p. ${c.page}): “…${c.excerpt.match}…”. Not reviewed by a person. A citation shows the papers are connected, not that they agree.`,
        };
        extraEdges.push(ce);
        emphasis.add(ce.id);
      }
      note = cmp.paths.length
        ? `Compare: the ${Math.min(8, cmp.paths.length)} strongest evidence-backed connections between the two papers.`
        : 'Compare: no evidence-backed connection between these papers in the graph.';
    } else note = 'Compare: choose two papers.';
  } else if (view.mode === 'gap') {
    const g = gaps.find((x) => x.id === view.gapId);
    if (g) {
      for (const f of g.focus) add(f, 'focus');
      for (const t of g.triggers) {
        const e = ix.edges.find((x) => x.id === t);
        if (e) { add(e.source, 'context'); add(e.target, 'context'); }
      }
      for (const p of g.papers) add(`paper:${p}`, 'context');
      addGap(g, true);
      roles.set(g.id, 'focus');
      note = `Gap focus: the entity, the edges that triggered the rule, papers involved, and corpus resolutions.`;
    }
  }

  // paper -> entity edges for every visible paper (topic/overview/entity/gap)
  if (view.mode !== 'paper' && view.mode !== 'compare') for (const p of [...nodes.values()].filter((n) => n.type === 'Paper')) paperEdges(p.paperId!, nodes.keys());
  // backend semantic edges among visible nodes
  const edges: GEdge[] = ix.edges.filter((e) => e.kind !== 'provenance' && nodes.has(e.source) && nodes.has(e.target));
  // provenance (paper reports finding) when findings shown
  for (const e of ix.edges) if (e.kind === 'provenance' && nodes.has(e.source) && nodes.has(e.target)) edges.push(e);
  const seen = new Set(edges.map((e) => `${e.source}>${e.target}`));
  for (const e of extraEdges) {
    const k = `${e.source}>${e.target}`;
    if (e.kind === 'derived-uses' && seen.has(k)) continue;
    seen.add(k);
    edges.push(e);
  }

  const display = new Map<string, string>();
  for (const n of nodes.values()) {
    if (n.type === 'Paper') {
      const m = ix.paperById.get(n.paperId!)!;
      display.set(n.id, `${paperShortLabel(m)}\n${m.shortTitle}`);
    } else if (n.type === 'Gap') {
      const g = gaps.find((x) => x.id === n.id)!;
      display.set(n.id, `${GAP_KIND_LABEL[g.kind]}\n${ix.nodes.get(g.focus[0])?.label ?? ''}${g.focus[1] ? ' → ' + (ix.nodes.get(g.focus[1])?.label ?? '') : ''}`);
    } else display.set(n.id, n.label.length > 60 ? n.label.slice(0, 57) + '…' : n.label);
  }
  // in compare view keep only the connecting edges, so the picture explains rather than decorates
  const shownEdges = view.mode === 'compare' ? edges.filter((e) => emphasis.has(e.id)) : edges;
  return { nodes: [...nodes.values()], edges: shownEdges, roles, display, total: ix.nodes.size, note, emphasis, fixed };
}

function citeEdge(from: string, to: string, n: number, ambiguous: boolean, sample: string): GEdge {
  return {
    id: `cites:${from}:${to}`, source: `paper:${from}`, target: `paper:${to}`, predicate: 'MENTIONS', kind: 'derived-cites',
    label: `mentions${ambiguous ? ' (ambiguous)' : ''} ×${n}`, negated: false, claimType: null, papers: [from], evidenceCount: n,
    validation: [], grounding: null, contexts: '', evidence: [],
    note: `Detected author+year mention in an extracted passage of ${from}${ambiguous ? '; several corpus papers share this author+year, so the target is ambiguous' : ''}. Example: “${sample.slice(0, 220)}”`,
  };
}
