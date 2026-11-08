// Run: npm test   (or: npx tsx scripts/test-compare.ts [graph.json])
// Validates the Paper Relationship Explorer against the real graph. No test framework needed.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildIndex } from '../src/data/graphIndex';
import { findGaps } from '../src/analysis/gaps';
import { comparePapers, evidenceFor, isGeneric, specificity, validatePath } from '../src/analysis/compare';
import type { Comparison } from '../src/analysis/compare';
import type { RawGraph } from '../src/types';

const raw = JSON.parse(readFileSync(process.argv[2] ?? 'public/graph.json', 'utf8')) as RawGraph;
const rawSnapshot = JSON.stringify(raw);
const ix = buildIndex(raw);
const gaps = findGaps(ix);
const P = ix.papers.map((p) => p.paperId);
const byPrefix = (pre: string) => {
  const id = P.find((x) => x.startsWith(pre));
  assert.ok(id, `paper ${pre} present`);
  return id!;
};

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${(e as Error).message.split('\n').join('\n      ')}`);
  }
}

/** Every displayed relationship must trace to graph objects, with quotes from the right paper. */
function checkProvenance(c: Comparison) {
  const A = c.a.paperId;
  const B = c.b.paperId;
  for (const path of c.paths) {
    const v = validatePath(ix, path, A, B);
    assert.ok(v.ok, `invalid path ${path.nodes.join(' > ')}: ${v.why}`);
  }
  const shared = [...c.concepts.specific, ...c.concepts.generic, ...c.methods.methodology, ...c.methods.terminology, ...c.methods.generic];
  for (const s of shared) {
    assert.ok(s.node.papers.includes(A) && s.node.papers.includes(B), `${s.node.label} listed for both`);
    assert.ok(s.a.evidence.length && s.a.evidence.every((e) => e.paperId === A), `${s.node.label}: A quotes from A`);
    assert.ok(s.b.evidence.length && s.b.evidence.every((e) => e.paperId === B), `${s.node.label}: B quotes from B`);
  }
  const uniq = [...c.differences.methodsA, ...c.differences.conceptsA].map((u) => [u, A] as const).concat([...c.differences.methodsB, ...c.differences.conceptsB].map((u) => [u, B] as const));
  for (const [u, pid] of uniq) {
    assert.ok(u.use.evidence.length && u.use.evidence.every((e) => e.paperId === pid), `${u.node.label}: quotes from ${pid}`);
    const other = pid === A ? B : A;
    assert.ok(!(u.node.papers.includes(other) && evidenceFor(u.node, other).length), `${u.node.label} is not actually unique`);
  }
  for (const f of c.findings.a) assert.ok(f.papers.includes(A) && f.evidence.every((e) => e.paperId === A), `finding ${f.id} belongs to A`);
  for (const f of c.findings.b) assert.ok(f.papers.includes(B) && f.evidence.every((e) => e.paperId === B), `finding ${f.id} belongs to B`);
  for (const r of c.findings.related) {
    assert.ok(c.findings.a.includes(r.a) && c.findings.b.includes(r.b), 'related pair from the right papers');
    for (const n of r.via) {
      const inv = (id: string) => (ix.out.get(id) ?? []).some((e) => e.predicate === 'INVOLVES' && e.target === n.id);
      assert.ok(inv(r.a.id) && inv(r.b.id), `both findings INVOLVE ${n.label}`);
    }
  }
  for (const s of c.findings.sameRelations) {
    assert.ok(s.a.papers.includes(A) && s.b.papers.includes(B), 'same-relation edges from each paper');
    assert.ok(s.a.source === s.b.source && s.a.target === s.b.target, 'same endpoints');
  }
  for (const m of c.citation.mentions) assert.equal(m.evidence.paperId, m.from, 'mention quote comes from the mentioning paper');
  for (const k of c.gaps.combinations) {
    assert.ok(k.left.papers.includes(k.leftPaper) && k.right.papers.includes(k.rightPaper), 'combination parts come from their papers');
    const linked = ix.edges.some((e) => e.kind === 'semantic' && ((e.source === k.left.id && e.target === k.right.id) || (e.source === k.right.id && e.target === k.left.id)));
    assert.ok(!linked, `combination ${k.left.label} × ${k.right.label} is actually linked`);
    assert.ok(k.left.type === 'Method' || k.left.type === 'EvaluationMethod', 'combination left side is a method or evaluation');
  }
  for (const g of c.gaps.engine) assert.ok(g.papers.includes(A) && g.papers.includes(B), 'engine gap touches both papers');
}

console.log(`papers=${P.length} nodes=${ix.nodes.size} edges=${ix.edges.length}`);

// ---------- all pairs ----------
const all: Comparison[] = [];
let ms = 0;
test(`all ${(P.length * (P.length - 1)) / 2} pairs compute, with valid provenance`, () => {
  const t0 = performance.now();
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) all.push(comparePapers(ix, P[i], P[j], gaps));
  ms = performance.now() - t0;
  for (const c of all) checkProvenance(c);
});
test('average comparison time < 50 ms', () => {
  const avg = ms / all.length;
  console.log(`      avg ${avg.toFixed(1)} ms per pair`);
  assert.ok(avg < 50, `avg ${avg} ms`);
});
test('comparison is symmetric in what is shared', () => {
  const [x, y] = [byPrefix('01-'), byPrefix('29-')];
  const ab = comparePapers(ix, x, y, gaps);
  const ba = comparePapers(ix, y, x, gaps);
  const ids = (c: Comparison) => [...c.concepts.specific, ...c.methods.methodology, ...c.methods.terminology].map((s) => s.node.id).sort();
  assert.deepEqual(ids(ab), ids(ba));
  assert.equal(ab.paths.length, ba.paths.length);
});

// ---------- citations ----------
test('no direct citation is ever claimed (graph has no reference-list / CITES data)', () => {
  assert.ok(!ix.edges.some((e) => e.predicate === 'CITES'), 'fixture assumption: no CITES edges');
  for (const c of all) {
    assert.equal(c.citation.status, 'not-established');
    assert.equal(c.citation.edges.length, 0);
  }
});
test('author–year mentions are reported separately, from real passages', () => {
  const c = comparePapers(ix, byPrefix('05-'), byPrefix('04-'), gaps); // Carlsmith 2023 mentions Hubinger 2019
  assert.equal(c.citation.status, 'not-established');
  assert.ok(c.citation.mentions.length > 0, 'expected the known Carlsmith→Hubinger mention');
  assert.ok(/Hubinger/i.test(c.citation.mentions[0].evidence.passage + (c.citation.mentions[0].evidence.context ?? '')));
});
test('ambiguous author–year targets are flagged (Greenblatt 2024 ×3)', () => {
  const c = comparePapers(ix, byPrefix('29-'), byPrefix('01-'), gaps);
  const m = c.citation.mentions.filter((x) => x.to === byPrefix('01-'));
  assert.ok(m.length > 0 && m.every((x) => x.ambiguous));
});

// ---------- closely related ----------
test('closely related: P01 Alignment Faking vs P29 Value-Conflict Alignment Faking', () => {
  const c = comparePapers(ix, byPrefix('01-'), byPrefix('29-'), gaps);
  const labels = c.concepts.specific.map((s) => s.node.label);
  assert.ok(labels.includes('alignment faking'), `shared concepts: ${labels.join(', ')}`);
  assert.ok(c.paths.length >= 3, `paths: ${c.paths.length}`);
  assert.equal(c.paths[0].kind, 'shared');
  console.log(`      shared: ${labels.slice(0, 5).join(', ')} · methodology: ${c.methods.methodology.map((s) => s.node.label).join(', ') || '—'} · paths ${c.paths.length}`);
});
test('closely related: P23 Noise Injection vs P24 Auditing Games for Sandbagging', () => {
  const c = comparePapers(ix, byPrefix('23-'), byPrefix('24-'), gaps);
  assert.ok(c.concepts.specific.some((s) => s.node.label === 'sandbagging'));
  console.log(`      shared: ${c.concepts.specific.map((s) => s.node.label).join(', ')} · methods: ${[...c.methods.methodology, ...c.methods.terminology].map((s) => s.node.label).join(', ') || '—'}`);
});

// ---------- unrelated ----------
test('unrelated pairs get no specific overlap and an honest empty result', () => {
  const none = all.filter((c) => !c.concepts.specific.length && !c.methods.methodology.length && !c.methods.terminology.length);
  console.log(`      ${none.length} of ${all.length} pairs share no specific entity`);
  assert.ok(none.length > 0);
  for (const c of none) {
    assert.ok(c.paths.every((p) => p.kind !== 'shared'), 'no shared-entity path without a shared entity');
  }
  const ex = none.find((c) => c.paths.length === 0);
  if (ex) console.log(`      e.g. ${ex.a.paperId} × ${ex.b.paperId}: no path at all`);
});

// ---------- generic concepts ----------
test('generic labels are detected', () => {
  const lab = (l: string) => [...ix.nodes.values()].find((n) => n.label === l);
  for (const l of ['LLMs', 'models', 'frontier models']) {
    const n = lab(l);
    if (n) assert.ok(isGeneric(n), `${l} should be generic`);
  }
  for (const l of ['alignment faking', 'sandbagging', 'Claude 3 Opus', 'noise injection']) {
    const n = lab(l);
    if (n) assert.ok(!isGeneric(n), `${l} should not be generic`);
  }
});
test('generic concepts never appear inside a path or lead the rankings', () => {
  for (const c of all) {
    for (const p of c.paths) for (const id of p.nodes.slice(1, -1)) {
      const n = ix.nodes.get(id)!;
      if (n.type !== 'Finding' && n.type !== 'Hypothesis') assert.ok(!isGeneric(n), `generic ${n.label} in path ${c.a.paperId}×${c.b.paperId}`);
    }
    assert.ok(c.concepts.specific.every((s) => !s.generic));
    assert.ok(c.methods.methodology.every((s) => !s.generic) && c.methods.terminology.every((s) => !s.generic));
  }
});
test('paths are ranked by score, and specific beats common at equal evidence', () => {
  for (const c of all) for (let i = 1; i < c.paths.length; i++) assert.ok(c.paths[i - 1].score >= c.paths[i].score);
  const common = [...ix.nodes.values()].find((n) => n.label === 'sandbagging')!;
  const rare = [...ix.nodes.values()].find((n) => n.paperCount === 2 && !isGeneric(n))!;
  assert.ok(specificity(ix, rare) > specificity(ix, common));
});

// ---------- methodology vs terminology ----------
test('"shared methodology" requires the item in both papers\' reported results', () => {
  for (const c of all) {
    for (const s of c.methods.methodology) assert.ok(s.a.role === 'results' && s.b.role === 'results');
    for (const s of c.methods.terminology) assert.ok(!(s.a.role === 'results' && s.b.role === 'results'));
  }
  const n = all.reduce((k, c) => k + c.methods.terminology.length, 0);
  console.log(`      ${all.reduce((k, c) => k + c.methods.methodology.length, 0)} methodology vs ${n} terminology-only items across all pairs`);
});

// ---------- findings: no agreement/contradiction from overlap alone ----------
test('same-relationship claims require identical endpoints; overlap alone yields only "related findings"', () => {
  const kinds = new Set(all.flatMap((c) => c.findings.sameRelations.map((s) => s.relation)));
  console.log(`      same-relationship claims found: ${all.reduce((k, c) => k + c.findings.sameRelations.length, 0)} (${[...kinds].join(', ') || 'none'})`);
  // related findings carry no polarity field at all: they are "both involve X" only
  for (const c of all) for (const r of c.findings.related) assert.deepEqual(Object.keys(r).sort(), ['a', 'b', 'score', 'via']);
});

// ---------- sparse coverage ----------
test('sparse papers get a coverage warning', () => {
  const sparse = ix.papers.map((p) => p.paperId).sort((x, y) => (ix.paperEntities.get(x)!.size - ix.paperEntities.get(y)!.size))[0];
  const other = P.find((x) => x !== sparse)!;
  const c = comparePapers(ix, sparse, other, gaps);
  assert.ok(c.gaps.coverage.some((n) => n.kind === 'sparse'), `${sparse} should be flagged sparse (${c.entityCount.a} entities)`);
  console.log(`      ${sparse}: ${c.entityCount.a} entities → flagged`);
});
test('every comparison states that citation data is missing', () => {
  for (const c of all) assert.ok(c.gaps.coverage.some((n) => n.kind === 'no-reference-data'));
});

// ---------- graph untouched ----------
test('the knowledge graph is not modified', () => {
  assert.equal(JSON.stringify(raw), rawSnapshot);
  assert.equal(ix.edges.length, raw.links.length);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
