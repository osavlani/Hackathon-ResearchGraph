import type { GraphIndex } from '../data/graphIndex';
import type { GNode } from '../types';
import { tokens } from './text';

export interface EntityHit { node: GNode; score: number }
export interface PaperHit { paperId: string; score: number; via: GNode[] }
export interface TopicResult { query: string; entities: EntityHit[]; papers: PaperHit[] }

let cache: { ix: GraphIndex; tok: Map<string, { label: Set<string>; alias: Set<string>; passage: Set<string> }> } | null = null;

function tokenCache(ix: GraphIndex) {
  if (cache?.ix === ix) return cache.tok;
  const tok = new Map<string, { label: Set<string>; alias: Set<string>; passage: Set<string> }>();
  for (const n of ix.nodes.values()) {
    tok.set(n.id, {
      label: new Set(tokens(n.label)),
      alias: new Set(n.aliases.flatMap((a) => tokens(a))),
      passage: new Set(tokens(n.firstPassage + ' ' + n.evidence.slice(0, 3).map((e) => e.passage).join(' '))),
    });
  }
  cache = { ix, tok };
  return tok;
}

/**
 * Topic search. Scores every node by query-token overlap (label > alias > evidence passage),
 * with a phrase bonus, then ranks papers by the evidence-weighted sum of matched entities.
 */
export function searchTopic(ix: GraphIndex, query: string, maxEntities = 20, maxPapers = 8): TopicResult {
  const q = tokens(query);
  if (!q.length) return { query, entities: [], papers: [] };
  const tok = tokenCache(ix);
  const phrase = query.trim().toLowerCase();
  const hits: EntityHit[] = [];
  for (const n of ix.nodes.values()) {
    const t = tok.get(n.id)!;
    let s = 0;
    let matched = 0;
    for (const w of q) {
      if (t.label.has(w)) { s += 3; matched++; }
      else if (t.alias.has(w)) { s += 2; matched++; }
      else if (t.passage.has(w)) { s += 0.5; matched += 0.5; }
    }
    if (matched < q.length * 0.5) continue; // at least half the query must match
    if (n.label.toLowerCase().includes(phrase)) s += 4;
    // prefer reusable entities over one-off findings, and paper nodes by title
    if (n.type === 'Finding' || n.type === 'Hypothesis') s *= 0.6;
    s *= 1 + Math.log1p(n.paperCount) * 0.5;
    hits.push({ node: n, score: s / q.length });
  }
  hits.sort((a, b) => b.score - a.score || b.node.mentionCount - a.node.mentionCount);
  const entities = hits.slice(0, maxEntities);

  const paperScore = new Map<string, PaperHit>();
  for (const h of hits.slice(0, 60)) {
    const pids = h.node.type === 'Paper' ? [h.node.paperId!] : h.node.papers;
    for (const pid of pids) {
      const w = h.node.type === 'Paper' ? h.score * 3 : h.score * Math.log1p(h.node.perPaper.get(pid) ?? 1);
      const cur = paperScore.get(pid) ?? { paperId: pid, score: 0, via: [] };
      cur.score += w;
      if (h.node.type !== 'Paper' && cur.via.length < 6) cur.via.push(h.node);
      paperScore.set(pid, cur);
    }
  }
  const papers = [...paperScore.values()].filter((p) => ix.paperById.has(p.paperId)).sort((a, b) => b.score - a.score).slice(0, maxPapers);
  return { query, entities, papers };
}
