// Run: npm test   (or: npx tsx scripts/test-reveal.ts)
// Deterministic tests for the Research Connection Reveal: sequence grounding + player timing (fake clock).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildIndex } from '../src/data/graphIndex';
import { findGaps } from '../src/analysis/gaps';
import { buildCitations } from '../src/analysis/related';
import { comparePapers } from '../src/analysis/compare';
import { buildGroundingIndex } from '../src/analysis/grounding';
import type { GroundingFile } from '../src/analysis/grounding';
import { buildView } from '../src/analysis/views';
import { MAX_REVEAL_PATHS, buildRevealSequence, validateReveal } from '../src/analysis/reveal';
import { RevealPlayer, stepDurations } from '../src/analysis/revealPlayer';
import type { PlayerState, Scheduler } from '../src/analysis/revealPlayer';
import type { RawGraph } from '../src/types';

const graphBytes = readFileSync('public/graph.json');
const raw = JSON.parse(graphBytes.toString()) as RawGraph;
const file = JSON.parse(readFileSync('public/grounding.json', 'utf8')) as GroundingFile;
const ix = buildIndex(raw);
const gaps = findGaps(ix);
const cites = buildCitations(ix);
const gx = buildGroundingIndex(file, ix, { sha256: createHash('sha256').update(graphBytes).digest('hex') });
const P = ix.papers.map((p) => p.paperId);
const pid = (pre: string) => P.find((p) => p.startsWith(pre))!;
const opts = { showFindings: false, showGaps: true, hiddenTypes: new Set<never>() };

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
function viewIds(a: string, b: string, refs = gx.between(a, b)) {
  const cmp = comparePapers(ix, a, b, gaps, refs);
  const vg = buildView(ix, { mode: 'compare', a, b }, gaps, cites, opts, cmp);
  return { cmp, ids: new Set([...vg.nodes.map((n) => n.id), ...vg.edges.map((e) => e.id)]) };
}

assert.equal(gx.stale, false, 'fixture: grounding matches graph');

// ---------- grounding ----------
test('all 435 pairs: only real, correctly attributed elements that are drawn in the compare view', () => {
  let steps = 0;
  for (let i = 0; i < P.length; i++)
    for (let j = i + 1; j < P.length; j++) {
      const { cmp, ids } = viewIds(P[i], P[j]);
      const seq = buildRevealSequence(ix, cmp);
      const problems = validateReveal(ix, cmp, seq, ids);
      assert.deepEqual(problems, [], `${P[i]} × ${P[j]}`);
      steps += seq.steps.length;
    }
  console.log(`      ${steps} steps across all pairs`);
});
test('sequence = paper A, paper B, citations, then the top paths in rank order (no invented intermediates)', () => {
  const { cmp } = viewIds(pid('07-'), pid('33-'));
  const seq = buildRevealSequence(ix, cmp);
  assert.deepEqual(seq.steps.slice(0, 2).map((s) => s.kind), ['paper', 'paper']);
  assert.equal(seq.steps[0].elements[0], `paper:${pid('07-')}`);
  assert.equal(seq.steps[1].elements[0], `paper:${pid('33-')}`);
  const pathSteps = seq.steps.filter((s) => ['shared', 'linked', 'co-studied'].includes(s.kind));
  assert.equal(pathSteps.length, Math.min(MAX_REVEAL_PATHS, cmp.paths.length));
  pathSteps.forEach((s, k) => {
    const nodesInPath = new Set(cmp.paths[k].nodes);
    for (const id of s.elements) if (ix.nodes.has(id)) assert.ok(nodesInPath.has(id), `${id} not on path ${k}`);
  });
  console.log(`      P07 × P33: ${seq.steps.map((s) => s.kind).join(' → ')}`);
});
test('citation steps: correct direction, verified records only, labelled as reference-list matches', () => {
  let n = 0;
  for (let i = 0; i < P.length; i++)
    for (let j = 0; j < P.length; j++) {
      if (i === j) continue;
      const refs = gx.between(P[i], P[j]);
      const { cmp } = viewIds(P[i], P[j], refs);
      for (const s of buildRevealSequence(ix, cmp).steps.filter((x) => x.kind === 'citation')) {
        n++;
        const [from, to] = s.key.slice(5).split('>');
        const rec = [...refs.aCitesB, ...refs.bCitesA].find((c) => c.source === from && c.target === to);
        assert.ok(rec, `no verified record for ${s.key}`);
        assert.equal(s.elements[0], `refcite:${from}:${to}`);
        assert.equal(s.provenance, 'reference-list-match');
        assert.match(s.detail, /Matched automatically/);
        assert.match(s.detail, new RegExp(`p\\. ${rec!.page}\\b`));
      }
    }
  assert.ok(n > 0);
  const p07 = buildRevealSequence(ix, viewIds(pid('07-'), pid('33-')).cmp).steps.find((s) => s.kind === 'citation')!;
  assert.equal(p07.title, 'P07 cites P33');
});
test('ambiguous-only citation (P24 × P33) produces no citation step', () => {
  const refs = gx.between(pid('24-'), pid('33-'));
  assert.ok(refs.ambiguous.length > 0 && refs.aCitesB.length + refs.bCitesA.length === 0, 'fixture');
  const seq = buildRevealSequence(ix, viewIds(pid('24-'), pid('33-'), refs).cmp);
  assert.ok(!seq.steps.some((s) => s.kind === 'citation'));
});
test('no supported connection (P01 × P25): elegant empty step, nothing invented', () => {
  const p25 = P.find((p) => p.startsWith('Simple-probes'))!;
  const seq = buildRevealSequence(ix, viewIds(pid('01-'), p25).cmp);
  assert.equal(seq.empty, true);
  assert.deepEqual(seq.steps.map((s) => s.kind), ['paper', 'paper', 'empty']);
  assert.deepEqual(seq.steps[2].elements, []);
  assert.match(seq.steps[2].detail, /not proof that the research is unrelated/);
});
test('sparse paper (P32) sequences validate', () => {
  const p32 = pid('32-');
  for (const o of P.filter((p) => p !== p32)) {
    const { cmp, ids } = viewIds(p32, o);
    assert.deepEqual(validateReveal(ix, cmp, buildRevealSequence(ix, cmp), ids), []);
  }
});
test('stale grounding: no citation steps, graph-evidence steps unchanged', () => {
  const stale = buildGroundingIndex(file, ix, { sha256: '0'.repeat(64) });
  assert.equal(stale.stale, true);
  // the dashboard passes no citation records when grounding is stale (gx === null)
  const fresh = buildRevealSequence(ix, viewIds(pid('07-'), pid('33-')).cmp);
  const staleSeq = buildRevealSequence(ix, comparePapers(ix, pid('07-'), pid('33-'), gaps, null));
  assert.ok(fresh.steps.some((s) => s.kind === 'citation'));
  assert.ok(!staleSeq.steps.some((s) => s.kind === 'citation'));
  assert.deepEqual(staleSeq.steps.filter((s) => s.kind !== 'citation'), fresh.steps.filter((s) => s.kind !== 'citation'));
});
test('linked-claim titles keep the claim edge’s own direction and predicate', () => {
  let n = 0;
  for (let i = 0; i < P.length; i++)
    for (let j = i + 1; j < P.length; j++) {
      const { cmp } = viewIds(P[i], P[j]);
      const seq = buildRevealSequence(ix, cmp);
      cmp.paths.slice(0, MAX_REVEAL_PATHS).forEach((p) => {
        const mid = p.hops.find((h) => h.kind === 'edge');
        if (!mid || mid.kind !== 'edge') return;
        n++;
        const step = seq.steps.find((s) => s.elements.includes(mid.edge.id))!;
        assert.equal(step.title, `Linked by a claim · ${ix.nodes.get(mid.edge.source)!.label} → ${ix.nodes.get(mid.edge.target)!.label}`);
        assert.ok(step.detail.includes(mid.edge.label), 'predicate wording preserved');
      });
    }
  console.log(`      ${n} linked-claim steps checked`);
});
test('no explanation claims agreement, contradiction or causation', () => {
  for (let i = 0; i < P.length; i++)
    for (let j = i + 1; j < P.length; j++) {
      const seq = buildRevealSequence(ix, viewIds(P[i], P[j]).cmp);
      for (const s of seq.steps) assert.ok(!/\b(agrees?|confirms?|proves?|contradicts?)\b/i.test(s.detail.replace(/not that they agree/g, '')), s.detail);
    }
});
test('replay consistency: identical sequence on every build, independent of build order', () => {
  const a = buildRevealSequence(ix, viewIds(pid('07-'), pid('33-')).cmp);
  for (const o of P.slice(0, 5)) if (o !== pid('07-')) buildRevealSequence(ix, viewIds(pid('07-'), o).cmp);
  const b = buildRevealSequence(ix, viewIds(pid('07-'), pid('33-')).cmp);
  assert.deepEqual(b, a);
});

// ---------- player (fake clock) ----------
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const sched: Scheduler = {
    set: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clear: (h) => { timers.delete(h as number); },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].sort((x, y) => x[1].at - y[1].at)[0];
      if (!next || next[1].at > end) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  };
  return { sched, advance, pending: () => timers.size };
}
const durations = stepDurations(['paper', 'paper', 'citation', 'shared', 'shared']);

test('player plays the steps in order with fixed timing and ends in the done state', () => {
  const c = fakeClock();
  const seen: PlayerState[] = [];
  const p = new RevealPlayer(durations, (s) => seen.push(s), false, c.sched);
  p.start();
  c.advance(60_000);
  assert.deepEqual(seen.map((s) => s.index), [0, 1, 2, 3, 4, 4]);
  assert.deepEqual(seen.at(-1), { index: 4, playing: false, done: true });
  assert.equal(c.pending(), 0);
});
test('replay repeats exactly the same sequence', () => {
  const c = fakeClock();
  const seen: number[] = [];
  const p = new RevealPlayer(durations, (s) => seen.push(s.index), false, c.sched);
  p.start();
  c.advance(60_000);
  const first = [...seen];
  seen.length = 0;
  p.replay();
  c.advance(60_000);
  assert.deepEqual(seen, first);
  seen.length = 0;
  p.replay();
  c.advance(2000); // replay mid-way restarts cleanly
  p.replay();
  c.advance(60_000);
  assert.deepEqual(seen.slice(-first.length), first);
});
test('pause holds the step; resume continues; skip jumps to the end', () => {
  const c = fakeClock();
  const p = new RevealPlayer(durations, () => {}, false, c.sched);
  p.start();
  c.advance(950); // into step 1
  p.pause();
  const held = p.current;
  c.advance(30_000);
  assert.deepEqual(p.current, held);
  assert.equal(c.pending(), 0);
  p.resume();
  c.advance(950);
  assert.equal(p.current.index, 2);
  p.skip();
  assert.deepEqual(p.current, { index: 4, playing: false, done: true });
  assert.equal(c.pending(), 0);
});
test('cancellation: dispose stops all timers and all further updates', () => {
  const c = fakeClock();
  const seen: number[] = [];
  const p = new RevealPlayer(durations, (s) => seen.push(s.index), false, c.sched);
  p.start();
  c.advance(1000);
  const before = [...seen];
  p.dispose();
  assert.equal(c.pending(), 0);
  c.advance(60_000);
  p.start(); // even if something calls it afterwards
  assert.deepEqual(seen, before);
});
test('reduced motion: start shows the final, fully revealed state with no timers', () => {
  const c = fakeClock();
  const seen: PlayerState[] = [];
  const p = new RevealPlayer(durations, (s) => seen.push(s), true, c.sched);
  p.start();
  assert.deepEqual(seen, [{ index: 4, playing: false, done: true }]);
  assert.equal(c.pending(), 0);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
