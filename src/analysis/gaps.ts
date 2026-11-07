import type { GraphIndex } from '../data/graphIndex';
import type { GEdge, GNode } from '../types';
import { jaccard, tokens } from './text';

/**
 * Gap engine. Deterministic, explainable rules over the backend graph — every gap lists the
 * edges/nodes that triggered it, and every suggested resolution points to an entity or paper
 * INSIDE the uploaded corpus (no outside literature). Gaps are hypotheses to check, not findings.
 */

export type GapKind =
  | 'untested-claim' // causal claims about X are only hypothesized in the corpus
  | 'no-detection' // nothing in the corpus detects / measures X
  | 'no-mitigation' // nothing in the corpus mitigates / reduces behavior X
  | 'conflict' // two claims about the same pair disagree
  | 'single-source' // X appears in many papers but observed evidence comes from one
  | 'narrow-models'; // X has only been observed in one model family

export const GAP_KIND_LABEL: Record<GapKind, string> = {
  'untested-claim': 'Hypothesized, not tested',
  'no-detection': 'No detection method',
  'no-mitigation': 'No mitigation',
  conflict: 'Conflicting claims',
  'single-source': 'Single-source evidence',
  'narrow-models': 'Narrow model coverage',
};

export interface Resolution {
  /** what to bring in from the corpus */
  nodeId: string | null; // Method / EvaluationMethod / AIModel / ExperimentalCondition (null = paper-level suggestion)
  paperIds: string[];
  via: string | null; // related entity id through which this resolution was found
  predicate: string | null;
  edgeId: string | null; // backend edge supporting the suggestion
  observed: boolean;
  score: number;
  rationale: string;
}

export interface Gap {
  id: string;
  kind: GapKind;
  title: string;
  description: string;
  focus: string[]; // entity node ids the gap is about
  papers: string[]; // corpus papers involved
  triggers: string[]; // backend edge ids that triggered / support the gap
  score: number;
  resolutions: Resolution[];
}

const DETECT = new Set(['DETECTS', 'MEASURES']);
const MITIGATE = new Set(['MITIGATES', 'REDUCES']);
const CAUSAL = new Set(['EXHIBITS', 'INCREASES', 'REDUCES', 'MITIGATES', 'ENABLES', 'DETECTS', 'MEASURES', 'CORRELATES_WITH', 'OBSERVED_UNDER']);
const UP = new Set(['INCREASES', 'ENABLES']);
const DOWN = new Set(['REDUCES', 'MITIGATES']);

const MODEL_FAMILIES: [RegExp, string][] = [
  [/claude|opus|sonnet|haiku/i, 'Anthropic Claude'],
  [/\bgpt|\bo1\b|\bo3\b|\bo4|openai|davinci|chatgpt/i, 'OpenAI'],
  [/gemini|palm|gemma|bard/i, 'Google'],
  [/llama|meta/i, 'Meta Llama'],
  [/mistral|mixtral/i, 'Mistral'],
  [/qwen/i, 'Qwen'],
  [/deepseek/i, 'DeepSeek'],
  [/grok/i, 'xAI'],
];
export function modelFamily(label: string): string {
  for (const [re, f] of MODEL_FAMILIES) if (re.test(label)) return f;
  return 'Other / unspecified';
}

interface Ctx {
  ix: GraphIndex;
  labelTok: Map<string, Set<string>>;
  key: GNode[];
}

const importance = (n: GNode) => Math.log1p(n.mentionCount) * (1 + 0.5 * (n.paperCount - 1));
const live = (e: GEdge) => e.kind === 'semantic' && !e.negated;

/** Entities related to `e`: itself, IS_A neighbours, similarly named, co-involved in findings. */
function related(ctx: Ctx, e: GNode): Map<string, { w: number; why: string }> {
  const { ix } = ctx;
  const r = new Map<string, { w: number; why: string }>();
  const put = (id: string, w: number, why: string) => {
    const cur = r.get(id);
    if (!cur || cur.w < w) r.set(id, { w, why });
  };
  put(e.id, 1.2, 'same entity');
  for (const x of [...(ix.out.get(e.id) ?? []), ...(ix.inc.get(e.id) ?? [])]) {
    if (x.predicate === 'IS_A') put(x.source === e.id ? x.target : x.source, 1, 'is-a');
  }
  const mine = ctx.labelTok.get(e.id)!;
  for (const n of ix.nodes.values()) {
    if (n.id === e.id || !['Behavior', 'Concept', 'Mechanism'].includes(n.type)) continue;
    const j = jaccard(mine, ctx.labelTok.get(n.id)!);
    if (j >= 0.34) put(n.id, 0.5 + 0.5 * j, 'similar name');
  }
  // co-involvement: findings/hypotheses that INVOLVE both
  for (const f of ix.inc.get(e.id) ?? []) {
    if (f.predicate !== 'INVOLVES') continue;
    for (const g of ix.out.get(f.source) ?? []) {
      if (g.predicate !== 'INVOLVES' || g.target === e.id) continue;
      const n = ix.nodes.get(g.target)!;
      if (['Behavior', 'Concept', 'Mechanism'].includes(n.type)) put(n.id, 0.45, 'co-studied');
    }
  }
  return r;
}

function edgesInto(ix: GraphIndex, id: string, preds: Set<string>, srcTypes: string[]) {
  return (ix.inc.get(id) ?? []).filter((x) => live(x) && preds.has(x.predicate) && srcTypes.includes(ix.nodes.get(x.source)!.type));
}

/** Resolutions = corpus edges `M -pred-> X` where X is related to the gap entity. */
function resolveVia(ctx: Ctx, e: GNode, preds: Set<string>, srcTypes: string[], verb: string, excludeSelf: boolean): Resolution[] {
  const { ix } = ctx;
  const res = new Map<string, Resolution>();
  for (const [xid, { w, why }] of related(ctx, e)) {
    if (excludeSelf && xid === e.id) continue;
    const x = ix.nodes.get(xid)!;
    for (const ed of edgesInto(ix, xid, preds, srcTypes)) {
      const m = ix.nodes.get(ed.source)!;
      const observed = ed.claimType === 'observed';
      const score = w * (observed ? 1 : 0.5) * Math.log1p(ed.evidenceCount + 1);
      const k = m.id;
      if ((res.get(k)?.score ?? 0) >= score) continue;
      res.set(k, {
        nodeId: m.id, paperIds: ed.papers, via: xid, predicate: ed.predicate, edgeId: ed.id, observed, score,
        rationale:
          xid === e.id
            ? `“${m.label}” ${ed.label} “${x.label}” (${ed.claimType ?? 'claim'}) — ${verb}.`
            : `“${m.label}” ${ed.label} “${x.label}” (${why}, ${ed.claimType ?? 'claim'}) — candidate to ${verb} “${e.label}”.`,
      });
    }
  }
  return [...res.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Papers that already mention X and own an evaluation method → best places to run the missing test. */
function evalSetups(ctx: Ctx, e: GNode, verb: string): Resolution[] {
  const { ix } = ctx;
  const out: Resolution[] = [];
  for (const pid of e.papers) {
    const evals = [...(ix.paperEntities.get(pid) ?? [])].map((id) => ix.nodes.get(id)!).filter((n) => n.type === 'EvaluationMethod');
    if (!evals.length) continue;
    evals.sort((a, b) => b.mentionCount - a.mentionCount);
    out.push({
      nodeId: evals[0].id, paperIds: [pid], via: e.id, predicate: null, edgeId: null, observed: false,
      score: 0.4 * Math.log1p(e.perPaper.get(pid) ?? 1) + 0.1 * evals.length,
      rationale: `${pid} already discusses “${e.label}” and has an evaluation setup (“${evals[0].label}”${evals.length > 1 ? ` +${evals.length - 1} more` : ''}) that could be reused to ${verb}.`,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

export function findGaps(ix: GraphIndex, opts = { minPapers: 2, minMentions: 4, max: 60 }): Gap[] {
  const labelTok = new Map([...ix.nodes.values()].map((n) => [n.id, new Set(tokens(n.label))]));
  const key = [...ix.nodes.values()].filter(
    (n) => ['Behavior', 'Concept', 'Mechanism'].includes(n.type) && (n.paperCount >= opts.minPapers || n.mentionCount >= opts.minMentions),
  );
  const ctx: Ctx = { ix, labelTok, key };
  const gaps: Gap[] = [];

  for (const e of key) {
    const imp = importance(e);
    const inEdges = (ix.inc.get(e.id) ?? []).filter((x) => x.kind === 'semantic');
    const allEdges = [...inEdges, ...(ix.out.get(e.id) ?? []).filter((x) => x.kind === 'semantic')];

    // --- no-detection
    // phenomena only: behaviors, or concepts the graph treats as an outcome (something exhibits / increases them)
    const isPhenomenon =
      e.type === 'Behavior' ||
      (e.type === 'Concept' && inEdges.some((x) => live(x) && ['EXHIBITS', 'INCREASES', 'ENABLES', 'REDUCES', 'MITIGATES'].includes(x.predicate)));
    if (isPhenomenon && !edgesInto(ix, e.id, DETECT, ['Method', 'EvaluationMethod']).length) {
      const resolutions = [...resolveVia(ctx, e, DETECT, ['Method', 'EvaluationMethod'], 'detect / measure it', true), ...evalSetups(ctx, e, 'build a detector or measurement')];
      gaps.push({
        id: `no-detection:${e.id}`, kind: 'no-detection', focus: [e.id], papers: e.papers, triggers: [], score: imp * 0.9,
        title: `No method in the corpus detects or measures “${e.label}”`,
        description: `“${e.label}” (${e.type}) is discussed in ${e.paperCount} paper(s), ${e.mentionCount} mention(s), but no Method or EvaluationMethod has a DETECTS / MEASURES edge to it.`,
        resolutions,
      });
    }

    // --- no-mitigation (behaviors only)
    if (e.type === 'Behavior') {
      const mit = edgesInto(ix, e.id, MITIGATE, ['Method']);
      const observedMit = mit.filter((x) => x.claimType === 'observed');
      if (!observedMit.length) {
        gaps.push({
          id: `no-mitigation:${e.id}`, kind: 'no-mitigation', focus: [e.id], papers: e.papers, triggers: mit.map((x) => x.id),
          score: imp * (mit.length ? 0.7 : 1),
          title: mit.length ? `Mitigations for “${e.label}” are only hypothesized` : `No mitigation for “${e.label}” in the corpus`,
          description: mit.length
            ? `${mit.length} method(s) are claimed to reduce “${e.label}”, but none of those claims is observed (all hypothesized / cited).`
            : `Behavior “${e.label}” appears in ${e.paperCount} paper(s) but no Method has a MITIGATES / REDUCES edge to it.`,
          resolutions: resolveVia(ctx, e, MITIGATE, ['Method'], 'mitigate it', true),
        });
      }
    }

    // --- untested causal claims
    const hyp = allEdges.filter((x) => CAUSAL.has(x.predicate) && x.claimType === 'hypothesized');
    const untested = hyp.filter(
      (h) => !allEdges.some((o) => o !== h && o.source === h.source && o.target === h.target && o.predicate === h.predicate && o.claimType === 'observed'),
    );
    const hypNodes = inEdges.filter((x) => x.predicate === 'INVOLVES' && ix.nodes.get(x.source)!.type === 'Hypothesis').length;
    const findNodes = inEdges.filter((x) => x.predicate === 'INVOLVES' && ix.nodes.get(x.source)!.type === 'Finding').length;
    const hypHeavy = hypNodes >= 3 && findNodes * 2 <= hypNodes;
    const observedCausal = allEdges.filter((x) => live(x) && CAUSAL.has(x.predicate) && x.claimType === 'observed').length;
    // fire only when hypothesized claims outweigh observed ones (an entity can be well-observed AND speculated about)
    if ((untested.length >= 2 && observedCausal * 2 <= untested.length) || (hypHeavy && observedCausal <= 1)) {
      const resolutions = [
        ...resolveVia(ctx, e, new Set([...DETECT]), ['Method', 'EvaluationMethod'], 'turn the claim into a measurement', false),
        ...evalSetups(ctx, e, 'test the hypothesized effect'),
      ];
      gaps.push({
        id: `untested-claim:${e.id}`, kind: 'untested-claim', focus: [e.id], papers: e.papers, triggers: untested.map((x) => x.id),
        score: imp * (0.6 + 0.1 * Math.min(untested.length, 5)) * (hypHeavy ? 1.2 : 1),
        title: `Claims about “${e.label}” are mostly hypothesized`,
        description:
          `${untested.length} causal claim(s) involving “${e.label}” are hypothesized with no observed counterpart (${observedCausal} observed); ${hypNodes} hypothesis node(s) vs ${findNodes} finding node(s) involve it.` +
          (untested.length
            ? ' Untested: ' + untested.slice(0, 3).map((h) => `“${ix.nodes.get(h.source)!.label}” ${h.label} “${ix.nodes.get(h.target)!.label}”`).join('; ') + (untested.length > 3 ? '; …' : '')
            : ''),
        resolutions,
      });
    }

    // --- single-source evidence
    if (e.paperCount >= 3) {
      const obs = allEdges.filter((x) => live(x) && x.claimType === 'observed' && x.predicate !== 'IS_A');
      const obsPapers = new Set(obs.flatMap((x) => x.papers));
      if (obsPapers.size <= 1) {
        gaps.push({
          id: `single-source:${e.id}`, kind: 'single-source', focus: [e.id], papers: e.papers, triggers: obs.map((x) => x.id),
          score: imp * 0.8,
          title: `“${e.label}”: ${e.paperCount} papers discuss it, ${obsPapers.size || 'none'} observe${obsPapers.size === 1 ? 's' : ''} it`,
          description: `Observed (non-hypothesized) claims about “${e.label}” come from ${obsPapers.size ? [...obsPapers].join(', ') : 'no paper'}; the other papers only mention or hypothesize it.`,
          resolutions: evalSetups(ctx, e, 'replicate the observation'),
        });
      }
    }

    // --- narrow model coverage
    if (e.type === 'Behavior') {
      const ex = inEdges.filter((x) => live(x) && x.predicate === 'EXHIBITS' && x.claimType === 'observed' && ix.nodes.get(x.source)!.type === 'AIModel');
      const fams = new Set(ex.map((x) => modelFamily(ix.nodes.get(x.source)!.label)));
      // near-synonyms (is-a / very similar names) count as the same behavior for coverage, to avoid
      // firing on entity-normalization splits like "scheming" vs "in-context scheming"
      const rel = related(ctx, e);
      const synFams = new Set<string>();
      for (const [xid, { w, why }] of rel) {
        if (xid === e.id || !(why === 'is-a' || (why === 'similar name' && w >= 0.75))) continue;
        for (const ed of ix.inc.get(xid) ?? [])
          if (live(ed) && ed.predicate === 'EXHIBITS' && ed.claimType === 'observed' && ix.nodes.get(ed.source)!.type === 'AIModel')
            synFams.add(modelFamily(ix.nodes.get(ed.source)!.label));
      }
      const fam0 = [...fams][0];
      if (ex.length && fams.size === 1 && fam0 !== 'Other / unspecified' && [...synFams].every((f) => f === fam0)) {
        const fam = fam0;
        // corpus models from other families observed exhibiting related behaviors
        const cand = new Map<string, Resolution>();
        for (const [xid, { w, why }] of rel) {
          if (xid === e.id) continue;
          for (const ed of ix.inc.get(xid) ?? []) {
            if (!live(ed) || ed.predicate !== 'EXHIBITS') continue;
            const m = ix.nodes.get(ed.source)!;
            if (m.type !== 'AIModel' || modelFamily(m.label) === fam) continue;
            const s = w * Math.log1p(ed.evidenceCount + 1);
            if ((cand.get(m.id)?.score ?? 0) >= s) continue;
            cand.set(m.id, {
              nodeId: m.id, paperIds: ed.papers, via: xid, predicate: 'EXHIBITS', edgeId: ed.id, observed: ed.claimType === 'observed', score: s,
              rationale: `${m.label} (${modelFamily(m.label)}) already exhibits “${ix.nodes.get(xid)!.label}” (${why}) in ${ed.papers.join(', ')} — test it for “${e.label}” too.`,
            });
          }
        }
        gaps.push({
          id: `narrow-models:${e.id}`, kind: 'narrow-models', focus: [e.id], papers: e.papers, triggers: ex.map((x) => x.id), score: imp * 0.75,
          title: `“${e.label}” observed only in ${fam} models`,
          description: `Observed EXHIBITS edges for “${e.label}” come from ${ex.length} model(s), all ${fam}: ${ex.map((x) => ix.nodes.get(x.source)!.label).join(', ')}.`,
          resolutions: [...cand.values()].sort((a, b) => b.score - a.score).slice(0, 5),
        });
      }
    }
  }

  // --- conflicts (pairwise over all semantic edges)
  const byPair = new Map<string, GEdge[]>();
  for (const x of ix.edges) {
    if (x.kind !== 'semantic' || x.predicate === 'INVOLVES') continue;
    const k = `${x.source}|${x.target}`;
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k)!.push(x);
  }
  for (const [k, es] of byPair) {
    const negMix = es.filter((x) => x.negated).find((n) => es.some((p) => !p.negated && p.predicate === n.predicate));
    const dirMix = es.some((x) => !x.negated && UP.has(x.predicate)) && es.some((x) => !x.negated && DOWN.has(x.predicate));
    if (!negMix && !dirMix) continue;
    const [sid, tid] = k.split('|');
    const s = ix.nodes.get(sid)!;
    const t = ix.nodes.get(tid)!;
    const papers = [...new Set(es.flatMap((x) => x.papers))];
    // moderators: experimental conditions that change the target
    const mods = (ix.inc.get(tid) ?? [])
      .filter((x) => live(x) && (UP.has(x.predicate) || DOWN.has(x.predicate)) && ix.nodes.get(x.source)!.type === 'ExperimentalCondition')
      .slice(0, 5)
      .map<Resolution>((x) => ({
        nodeId: x.source, paperIds: x.papers, via: tid, predicate: x.predicate, edgeId: x.id, observed: x.claimType === 'observed',
        score: Math.log1p(x.evidenceCount + 1),
        rationale: `Condition “${ix.nodes.get(x.source)!.label}” ${x.label} “${t.label}” — a candidate moderator that may explain the disagreement.`,
      }));
    gaps.push({
      id: `conflict:${k}`, kind: 'conflict', focus: [sid, tid], papers, triggers: es.map((x) => x.id),
      score: (importance(s) + importance(t)) * 0.6 + papers.length,
      title: `Conflicting claims: “${s.label}” → “${t.label}”`,
      description: es.map((x) => `${x.negated ? 'NOT ' : ''}${x.predicate} (${x.claimType ?? '?'}; ${x.papers.join(', ')})`).join(' vs '),
      resolutions: mods,
    });
  }

  return gaps.sort((a, b) => b.score - a.score).slice(0, opts.max);
}
