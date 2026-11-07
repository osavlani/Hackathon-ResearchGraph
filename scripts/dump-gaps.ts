// Run: npx tsx scripts/dump-gaps.ts [graph.json] [out.json]
// Runs the same gap engine the UI uses, headless, so gaps can be reviewed / verified offline.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildIndex } from '../src/data/graphIndex';
import { findGaps } from '../src/analysis/gaps';
import { buildCitations } from '../src/analysis/related';
import type { RawGraph } from '../src/types';

const inPath = process.argv[2] ?? 'public/graph.json';
const outPath = process.argv[3] ?? 'gaps.generated.json';
const ix = buildIndex(JSON.parse(readFileSync(inPath, 'utf8')) as RawGraph);
const gaps = findGaps(ix);
const lbl = (id: string | null) => (id ? ix.nodes.get(id)?.label ?? id : null);
const out = gaps.map((g) => ({
  id: g.id, kind: g.kind, score: +g.score.toFixed(2), title: g.title, description: g.description, papers: g.papers,
  resolutions: g.resolutions.map((r) => ({ node: lbl(r.nodeId), via: lbl(r.via), papers: r.paperIds, observed: r.observed, rationale: r.rationale })),
}));
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`papers=${ix.papers.length} nodes=${ix.nodes.size} edges=${ix.edges.length} gaps=${gaps.length}`);
const byKind: Record<string, number> = {};
for (const g of gaps) byKind[g.kind] = (byKind[g.kind] ?? 0) + 1;
console.log(byKind);
const c = buildCitations(ix);
for (const p of ix.papers) {
  const o = c.outgoing(p.paperId);
  if (o.length) console.log('cites', p.paperId, '->', o.map((x) => `${x.to}(${x.n}${x.ambiguous ? '?' : ''})`).join(', '));
}
