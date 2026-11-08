// Run: npm test   (or: npx tsx scripts/test-grounding.ts)
// Validates the citation / quote-provenance integration against the grounding pipeline's own output.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildIndex } from '../src/data/graphIndex';
import { KNOWN_TITLES } from '../src/data/paperMeta';
import { findGaps } from '../src/analysis/gaps';
import { comparePapers } from '../src/analysis/compare';
import { buildGroundingIndex, fnv1a } from '../src/analysis/grounding';
import { sha256HexSync } from '../src/data/sha256';
import { checkGraphIntegrity } from './graph-integrity';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Citation, GroundingFile } from '../src/analysis/grounding';
import type { RawGraph } from '../src/types';

const graphBytes = readFileSync('public/graph.json');
const raw = JSON.parse(graphBytes.toString()) as RawGraph;
const file = JSON.parse(readFileSync('public/grounding.json', 'utf8')) as GroundingFile;
const candidates = JSON.parse(readFileSync('analysis/grounding/citation_candidates.json', 'utf8')) as {
  verified: { source: string; target: string; reference_page: number; method: string; status: string }[];
  ambiguous: { source: string; target: string; reference_page: number; method: string; status: string }[];
};
const runSummary = JSON.parse(readFileSync('analysis/grounding/run_summary.json', 'utf8'));
const rels = JSON.parse(readFileSync('analysis/grounding/relationship_candidates.json', 'utf8'));
const verdicts = JSON.parse(readFileSync('public/gap_verifications.json', 'utf8')).verifications as Record<string, unknown>;
const ix = buildIndex(raw);
const gaps = findGaps(ix);
const graphSha = createHash('sha256').update(graphBytes).digest('hex');
const gx = buildGroundingIndex(file, ix, { sha256: graphSha });
const P = ix.papers.map((p) => p.paperId);
const ns = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '');

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

test('graph is unchanged since the grounding run (sha256 matches pipeline and export)', () => {
  const sha = createHash('sha256').update(graphBytes).digest('hex');
  assert.equal(sha, runSummary.graph_sha256);
  assert.equal(sha, file.graphSha256);
  assert.deepEqual(file.graphCounts, { nodes: raw.nodes.length, links: raw.links.length });
  assert.deepEqual(gx.issues, []);
  assert.equal(gx.stale, false);
  assert.equal(gx.fingerprint, 'sha256-match');
});
test('portable SHA-256 matches the standard test vectors and Node crypto on the real graph', () => {
  assert.equal(sha256HexSync(new Uint8Array()), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256HexSync(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  // 56-byte message: padding spills into a second block
  assert.equal(sha256HexSync(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  for (const len of [55, 56, 63, 64, 65, 1000]) {
    const b = new Uint8Array(len).map((_, i) => (i * 31 + 7) & 0xff);
    assert.equal(sha256HexSync(b), createHash('sha256').update(b).digest('hex'), `length ${len}`);
  }
  assert.equal(sha256HexSync(new Uint8Array(graphBytes)), graphSha, 'portable hash of graph.json equals Node crypto');
});
test('integrity requires an exact SHA-256 match: no count-based fallback', () => {
  const wrongSha = buildGroundingIndex(file, ix, { sha256: '0'.repeat(64) });
  assert.equal(wrongSha.stale, true);
  assert.equal(wrongSha.fingerprint, 'sha256-mismatch');
  assert.match(wrongSha.issues.join(' '), /different version of the graph/);
  const noHash = buildGroundingIndex(file, ix, { sha256: null });
  assert.equal(noHash.stale, true, 'unknown integrity is treated as stale');
  assert.equal(noHash.fingerprint, 'unavailable');
  assert.match(noHash.issues.join(' '), /integrity is unknown/);
});
test('a graph edited without changing node/edge counts is detected as stale', () => {
  const text = graphBytes.toString('utf8');
  const i = text.indexOf('Claude 3 Opus');
  assert.ok(i > 0, 'fixture label present');
  const tampered = text.slice(0, i) + 'Claude 3 Opvs' + text.slice(i + 'Claude 3 Opus'.length);
  const tRaw = JSON.parse(tampered) as RawGraph;
  assert.equal(tRaw.nodes.length, raw.nodes.length);
  assert.equal(tRaw.links.length, raw.links.length);
  const tSha = sha256HexSync(new TextEncoder().encode(tampered));
  assert.notEqual(tSha, graphSha);
  const t = buildGroundingIndex(file, buildIndex(tRaw), { sha256: tSha });
  assert.equal(t.stale, true);
  assert.equal(t.fingerprint, 'sha256-mismatch');
});
test('build-time gate: the shipped pair matches, and a same-count edited graph would fail the build', () => {
  const shipped = checkGraphIntegrity('public');
  assert.equal(shipped.match, true);
  assert.equal(shipped.graphSha256, graphSha);
  // tiny synthetic fixtures in a fresh temp directory (public/ is never written): one node relabelled,
  // same node and link counts
  const dir = mkdtempSync(join(tmpdir(), 'rg-integrity-'));
  const original = JSON.stringify({ nodes: [{ id: 'a', label: 'Claude 3 Opus' }], links: [] });
  const edited = original.replace('Claude 3 Opus', 'Claude 3 Opvs');
  writeFileSync(join(dir, 'grounding.json'), JSON.stringify({ graphSha256: createHash('sha256').update(original).digest('hex') }));
  writeFileSync(join(dir, 'graph.json'), original);
  assert.equal(checkGraphIntegrity(dir).match, true);
  writeFileSync(join(dir, 'graph.json'), edited);
  assert.equal(checkGraphIntegrity(dir).match, false, 'edited graph with identical counts must fail the gate');
});
test('gap engine output unchanged (same 60 gap ids as the reviewed verdict file)', () => {
  assert.deepEqual(gaps.map((g) => g.id).sort(), Object.keys(verdicts).sort());
});

// ---------- citations vs pipeline output ----------
const key = (c: { source: string; target: string }) => `${c.source}>${c.target}`;
test('every exported verified citation is a verified pipeline candidate (same direction, page, method)', () => {
  const cand = new Map(candidates.verified.map((c) => [key(c), c]));
  assert.equal(file.citations.verified.length, candidates.verified.length);
  for (const c of file.citations.verified) {
    const k = cand.get(key(c));
    assert.ok(k, `not a pipeline-verified citation: ${key(c)}`);
    assert.equal(k!.status, 'verified');
    assert.equal(k!.reference_page, c.page);
    assert.equal(k!.method, c.method);
  }
});
test('ambiguous matches are never exported or indexed as verified', () => {
  const vk = new Set(file.citations.verified.map(key));
  for (const c of file.citations.ambiguous) {
    assert.ok(candidates.ambiguous.some((a) => key(a) === key(c) && a.reference_page === c.page), `unknown ambiguous ${key(c)}`);
    assert.ok(!vk.has(key(c)), `${key(c)} is both verified and ambiguous`);
  }
  for (let i = 0; i < P.length; i++)
    for (let j = 0; j < P.length; j++) {
      if (i === j) continue;
      const b = gx.between(P[i], P[j]);
      for (const c of [...b.aCitesB, ...b.bCitesA]) assert.ok(vk.has(key(c)), `indexed non-verified citation ${key(c)}`);
    }
});
test('direction: between(a,b).aCitesB holds only a→b, and mirrors between(b,a).bCitesA', () => {
  let n = 0;
  for (const a of P)
    for (const b of P) {
      if (a === b) continue;
      const ab = gx.between(a, b);
      const ba = gx.between(b, a);
      for (const c of ab.aCitesB) assert.ok(c.source === a && c.target === b);
      for (const c of ab.bCitesA) assert.ok(c.source === b && c.target === a);
      assert.deepEqual(ab.aCitesB, ba.bCitesA);
      n += ab.aCitesB.length;
    }
  const inGraph = file.citations.verified.filter((c) => c.sourceInGraph && c.targetInGraph).length;
  assert.equal(n, inGraph, 'every in-graph verified citation reachable exactly once');
  console.log(`      ${n} directed citations between graph papers`);
});
test('all in-graph paper ids resolve to Paper nodes', () => {
  for (const c of file.citations.verified) {
    if (c.sourceInGraph) assert.ok(ix.paperById.has(c.source), c.source);
    if (c.targetInGraph) assert.ok(ix.paperById.has(c.target), c.target);
    if (!c.targetInGraph) assert.match(c.target, /^rank:\d+$/);
  }
});
test('every reference excerpt highlights text that identifies the cited paper', () => {
  for (const c of [...file.citations.verified, ...file.citations.ambiguous] as Citation[]) {
    assert.equal(c.excerptKind, 'reference-text');
    const m = ns(c.excerpt.match);
    const meta = ix.paperById.get(c.target);
    const rank = meta?.rank ?? (c.target.startsWith('rank:') ? Number(c.target.slice(5)) : null);
    const title = ns(rank != null ? KNOWN_TITLES[rank] ?? '' : '');
    if (c.method.startsWith('arxiv-id')) assert.match(c.excerpt.match.replace(/\s/g, ''), /^\d{4}\.\d{4,5}$/, `${key(c)}: ${c.excerpt.match}`);
    else if (c.method.startsWith('exact-title')) assert.equal(m, title, key(c));
    else if (c.method.startsWith('title-prefix')) assert.ok(title.startsWith(m) && m.length >= 20, key(c));
    else assert.equal(m, ns(meta?.firstAuthor ?? 'MacDiarmid'), `${key(c)} highlights ${c.excerpt.match}`);
  }
});

// ---------- comparison statuses ----------
test('comparison: "established" iff a verified citation exists; ambiguous-only pairs never established', () => {
  let est = 0, notFound = 0, notEst = 0, ambOnly = 0;
  for (let i = 0; i < P.length; i++)
    for (let j = i + 1; j < P.length; j++) {
      const refs = gx.between(P[i], P[j]);
      const c = comparePapers(ix, P[i], P[j], gaps, refs).citation;
      const has = refs.aCitesB.length + refs.bCitesA.length > 0;
      assert.equal(c.status === 'established', has, `${P[i]} × ${P[j]}`);
      if (!has && refs.ambiguous.length) {
        ambOnly++;
        // ambiguous-only pairs are "not established", never "established" and never "not found"
        assert.equal(c.status, 'not-established', `${P[i]} × ${P[j]}`);
        assert.match(c.reason, /could not be confirmed/);
      }
      if (c.status === 'not-found') assert.ok(refs.bothChecked && refs.ambiguous.length === 0);
      if (c.status === 'not-established') assert.ok(!refs.bothChecked || refs.ambiguous.length > 0);
      est += +(c.status === 'established'); notFound += +(c.status === 'not-found'); notEst += +(c.status === 'not-established');
    }
  console.log(`      established ${est} · not found in either list ${notFound} · not established ${notEst} (incl. ${ambOnly} ambiguous-only)`);
});
test('P25 (web page, no reference list) yields "not established", never "not found"', () => {
  const p25 = P.find((p) => p.startsWith('Simple-probes'))!;
  const c = comparePapers(ix, p25, P.find((p) => p.startsWith('03-'))!, gaps, gx.between(p25, P.find((p) => p.startsWith('03-'))!)).citation;
  assert.ok(file.referencesMissing.includes(p25));
  assert.equal(c.status, gx.between(p25, P.find((p) => p.startsWith('03-'))!).bCitesA.length ? 'established' : 'not-established');
});
test('citation alone never creates shared concepts or paths (comparison content identical with and without citations)', () => {
  for (const [a, b] of [['01-', '03-'], ['01-', '29-'], ['07-', '33-']]) {
    const A = P.find((p) => p.startsWith(a))!;
    const B = P.find((p) => p.startsWith(b))!;
    const without = comparePapers(ix, A, B, gaps);
    const withRefs = comparePapers(ix, A, B, gaps, gx.between(A, B));
    assert.deepEqual(withRefs.concepts, without.concepts);
    assert.deepEqual(withRefs.methods, without.methods);
    assert.deepEqual(withRefs.paths.map((p) => p.nodes), without.paths.map((p) => p.nodes));
    assert.deepEqual(withRefs.findings.sameRelations, without.findings.sameRelations);
  }
});
test('cited-without-shared-entity notes: only for verified citations with no specific overlap', () => {
  const ours = new Set<string>();
  for (let i = 0; i < P.length; i++)
    for (let j = i + 1; j < P.length; j++) {
      const c = comparePapers(ix, P[i], P[j], gaps, gx.between(P[i], P[j]));
      const note = c.gaps.coverage.some((n) => n.kind === 'cited-without-overlap');
      const none = !c.concepts.specific.length && !c.methods.methodology.length && !c.methods.terminology.length;
      assert.equal(note, c.citation.status === 'established' && none, `${P[i]} × ${P[j]}`);
      if (note) ours.add([P[i], P[j]].sort().join('|'));
    }
  const pipeline = new Set((rels.citation_without_shared_entity as { source: string; target: string }[]).map((x) => [x.source, x.target].sort().join('|')));
  const both = [...ours].filter((k) => pipeline.has(k)).length;
  console.log(`      frontend flags ${ours.size} pairs · pipeline flags ${(rels.citation_without_shared_entity as unknown[]).length} directed = ${pipeline.size} unordered pairs · identical: ${both === ours.size && both === pipeline.size}`);
});

// ---------- quote provenance ----------
test('every graph evidence quote has a local match result; counts equal the pipeline summary', () => {
  const seen = new Map<string, string>();
  for (const n of ix.nodes.values()) for (const e of n.evidence) seen.set(fnv1a(`${e.paperId}\u0000${e.passage}`), gx.quote(e)?.status ?? 'missing');
  for (const e of ix.edges) for (const ev of e.evidence) seen.set(fnv1a(`${ev.paperId}\u0000${ev.passage}`), gx.quote(ev)?.status ?? 'missing');
  const counts: Record<string, number> = {};
  for (const s of seen.values()) counts[s] = (counts[s] ?? 0) + 1;
  assert.ok(!counts.missing, `${counts.missing} quotes without a result`);
  assert.deepEqual(counts, runSummary.quote_verification);
  console.log(`      ${JSON.stringify(counts)}`);
});
test('the unmatched P06 quotation is flagged for review on its claim', () => {
  const e = ix.edges.find((x) => x.id === 'r:c95d7cf8c09aa263')!;
  assert.ok(e.papers.includes('06-Greenblatt2024-AIControl'));
  assert.equal(gx.flag(e.id)?.kind, 'quote-not-found');
  assert.ok(e.evidence.some((ev) => gx.quote(ev)?.status === 'not-found'));
  const notFound = [...ix.edges, ...[...ix.nodes.values()].map((n) => ({ evidence: n.evidence }))].flatMap((x) => x.evidence).filter((ev) => gx.quote(ev)?.status === 'not-found');
  assert.ok(notFound.every((ev) => ev.paperId === '06-Greenblatt2024-AIControl'), 'only the P06 quote is unmatched');
});
test('UI wording never overclaims (automated citation matches, AI-assisted verdicts, graph vs science)', () => {
  const ui = ['src/components/ComparePanel.tsx', 'src/components/Inspector.tsx', 'src/components/copy.ts', 'src/components/GapsPanel.tsx', 'src/components/InsightsPanel.tsx', 'src/components/ui.tsx', 'src/analysis/views.ts', 'src/analysis/compare.ts']
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const banned: [RegExp, string][] = [
    [/verified in [^\n]{0,40}reference list/i, 'citations are automated matches, not "verified"'],
    [/citation is verified/i, 'citations are automated matches, not "verified"'],
    [/A reviewer checked the papers/i, 'verdicts are AI-assisted, papers were not re-read'],
    [/neither lists the other paper/i, '"not found" is not proof of absence'],
    [/no method or evaluation in the collection is reported/i, 'gap rules describe the graph, not the literature'],
    [/Reported as an experimental result in the paper/i, 'claim types are extractor labels'],
  ];
  for (const [re, why] of banned) assert.ok(!re.test(ui), `${re} still present: ${why}`);
  assert.match(ui, /not reviewed by a person/);
  assert.match(ui, /AI-assisted review/);
  assert.match(ui, /does not confirm that the extracted claim reads them correctly/);
});
test('no model was called to produce these results', () => {
  assert.equal(file.modelCalls, 0);
  assert.equal(runSummary.stats.llm_calls, 0);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
