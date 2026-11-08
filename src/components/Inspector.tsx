import type { GraphIndex } from '../data/graphIndex';
import { paperShortLabel } from '../data/graphIndex';
import type { Gap } from '../analysis/gaps';
import { GAP_KIND_LABEL } from '../analysis/gaps';
import type { CitationIndex } from '../analysis/related';
import { alignedPapers, usesEdge, USES_LABEL } from '../analysis/related';
import type { GapVerification } from '../analysis/verification';
import type { GroundingIndex, QuoteMatch } from '../analysis/grounding';
import { QUOTE_LABEL } from '../analysis/grounding';
import { KNOWN_TITLES } from '../data/paperMeta';
import type { View, ViewGraph } from '../analysis/views';
import type { Evidence, GEdge, GNode, NodeType } from '../types';
import { NODE_STYLE } from '../theme';
import type { Selection } from './GraphView';
import { GAP_KIND_HELP, VERDICT_HELP } from './copy';
import { ClaimBadge, Icon, Section, ShowMore, VerdictBadge } from './ui';

interface Props {
  ix: GraphIndex;
  vg: ViewGraph;
  gaps: Gap[];
  cites: CitationIndex;
  verifications: Record<string, GapVerification>;
  grounding: GroundingIndex | null;
  /** how the gap verdicts were produced (gap_verifications.json "method"), shown as a tooltip */
  reviewMethod?: string;
  selection: NonNullable<Selection>;
  view: View;
  onSelect: (s: Selection) => void;
  onView: (v: View) => void;
}

const isOk = (e: Evidence) => e.validationStatus === 'verified' || e.validationStatus === 'fuzzy_verified' || e.validationStatus == null;

function TypeTag({ t }: { t: NodeType }) {
  return (
    <span className="typetag">
      <span className="dot" style={{ background: NODE_STYLE[t].color }} />
      {t === 'EvaluationMethod' ? 'Evaluation' : t === 'ExperimentalCondition' ? 'Condition' : t === 'AIModel' ? 'Model' : t}
    </span>
  );
}

/** Quotes from the source papers, verified first. Unverified quotes are kept but tucked away. */
/** One provenance tag per quote: the local PDF check when available, otherwise the extraction pipeline's own status. */
function QuoteTag({ e, m }: { e: Evidence; m: QuoteMatch | null }) {
  const pipeline = e.validationStatus === 'verified' ? 'validated' : e.validationStatus === 'fuzzy_verified' ? 'approximate' : 'not validated';
  if (!m) {
    if (e.validationStatus === 'verified') return <span className="tag ok" title="The extraction pipeline that built the graph matched this passage to the PDF text. No independent local check is loaded.">Extractor-validated</span>;
    if (e.validationStatus === 'fuzzy_verified') return <span className="tag warn" title="The extraction pipeline that built the graph matched this passage to the PDF text only approximately.">Extractor: approximate match</span>;
    return null;
  }
  const where = m.pages.length ? ` · p. ${m.pages.join(', ')}` : '';
  const pageNote = m.pageCheck === 'mismatch' ? ` (graph says p. ${e.page})` : m.pageCheck === 'off-by-one' ? ` (graph says p. ${e.page})` : '';
  const tip =
    m.status === 'exact' ? 'These words appear verbatim in the paper’s PDF text (local check).'
      : m.status === 'fuzzy' ? `Most of these words appear in the PDF text, but not verbatim (${Math.round((m.coverage ?? 0) * 100)}% overlap). Check the PDF.`
      : m.status === 'not-found' ? `These words could not be located in the PDF text (${Math.round((m.coverage ?? 0) * 100)}% overlap). Flagged for review.`
      : '';
  const cls = m.status === 'exact' ? 'ok' : m.status === 'fuzzy' ? 'warn' : m.status === 'not-found' ? 'bad' : '';
  return <span className={`tag ${cls}`} title={`${tip} Extraction pipeline status: ${pipeline}.`}>{QUOTE_LABEL[m.status]}{m.status !== 'not-found' && where}{pageNote}</span>;
}

function EvidenceList({ ev, labelOf, initial = 3, match }: { ev: Evidence[]; labelOf: (pid: string) => string; initial?: number; match?: (e: Evidence) => QuoteMatch | null }) {
  // quotes the local check could not find stay visible (flagged) even if the pipeline marked them valid
  const ok = ev.filter(isOk).sort((x, y) => (match?.(x)?.status === 'not-found' ? -1 : 0) - (match?.(y)?.status === 'not-found' ? -1 : 0));
  const bad = ev.filter((e) => !isOk(e));
  if (!ev.length) return <p className="muted small">No supporting quote was extracted for this item, so there is no page reference to show.</p>;
  return (
    <>
      <ShowMore
        items={ok}
        initial={initial}
        className="evidence"
        render={(e, i) => (
          <li key={i}>
            <blockquote>{e.passage}</blockquote>
            <div className="evmeta">
              <span title={e.sourcePdf}>{labelOf(e.paperId)}</span>
              {e.page != null && <span>p. {e.page}</span>}
              <QuoteTag e={e} m={match?.(e) ?? null} />
              <ClaimBadge type={e.claimType} />
            </div>
            {e.context && <div className="evctx">Context: {e.context}</div>}
          </li>
        )}
      />
      {bad.length > 0 && (
        <details className="subtle">
          <summary>{bad.length} unverified quote(s), not counted as evidence</summary>
          <ul className="evidence">{bad.map((e, i) => <li key={i} className="muted"><blockquote>{e.passage}</blockquote><span className="tag bad">Unverified</span></li>)}</ul>
        </details>
      )}
      {match && <p className="hint qnote">“Found in PDF” means these words appear in the paper. It does not confirm that the extracted claim reads them correctly.</p>}
    </>
  );
}

/** Rebuild a derived "paper mentions entity" edge from its id (uses:<paper_id>:<node id>) so it can be inspected from anywhere. */
function derivedUses(ix: GraphIndex, id: string): GEdge | undefined {
  if (!id.startsWith('uses:')) return undefined;
  const rest = id.slice(5);
  const i = rest.indexOf(':');
  const pid = rest.slice(0, i);
  const n = ix.nodes.get(rest.slice(i + 1));
  return n && ix.paperById.has(pid) && n.papers.includes(pid) ? usesEdge(`paper:${pid}`, pid, n) : undefined;
}

export default function Inspector({ ix, vg, gaps, cites, verifications, grounding, reviewMethod, selection, view, onSelect, onView }: Props) {
  const match = grounding ? (e: Evidence) => grounding.quote(e) : undefined;
  const paperLabel = (pid: string) => {
    const m = ix.paperById.get(pid);
    return m ? paperShortLabel(m) : pid;
  };
  const nodeLink = (id: string) => {
    const n = ix.nodes.get(id) ?? vg.nodes.find((x) => x.id === id);
    if (!n) return <span>{id}</span>;
    const label = n.type === 'Paper' ? paperLabel(n.paperId!) : n.label;
    return <button className="link" onClick={() => onSelect({ kind: 'node', id })}>{label}</button>;
  };
  const paperLink = (pid: string) => {
    const m = ix.paperById.get(pid);
    return m
      ? <button key={pid} className="chip paper" title={m.title} onClick={() => onView({ mode: 'paper', paperId: pid })}>{paperShortLabel(m)}</button>
      : <span key={pid} className="chip muted" title="This paper has no data in the graph">{pid}</span>;
  };
  const focusButton = (v: View, label: string, active: boolean) =>
    active ? null : <button className="btn sm" onClick={() => onView(v)}><Icon name="target" size={14} /> {label}</button>;

  // ---------------- relationship / claim ----------------
  if (selection.kind === 'edge') {
    const e: GEdge | undefined = vg.edges.find((x) => x.id === selection.id) ?? ix.edges.find((x) => x.id === selection.id) ?? derivedUses(ix, selection.id);
    if (!e) return null;
    const derived = e.kind !== 'semantic' && e.kind !== 'provenance';
    const paperMention = e.kind === 'derived-uses';
    return (
      <div className="inspector">
        <div className="eyebrow">{paperMention ? 'Mentioned in paper' : derived ? 'Inferred link' : e.kind === 'provenance' ? 'Source' : 'Claim'}</div>
        <h3 className="claim">
          {nodeLink(e.source)} <span className={`pred ${e.negated ? 'neg' : ''}`}>{e.label}</span> {nodeLink(e.target)}
        </h3>
        <div className="row wrap">
          <ClaimBadge type={e.claimType} />
          {e.negated && <span className="tag bad" title="The paper reports that this relationship does not hold">Negative result</span>}
          {e.papers.slice(0, 4).map(paperLink)}
        </div>
        {grounding?.flag(e.id) && (
          <div className={`callout flag ${grounding.flag(e.id)!.kind}`} role="note">
            <div className="small"><b>Flagged for review</b></div>
            <p className="small">{grounding.flag(e.id)!.text}</p>
          </div>
        )}
        {paperMention
          ? <p className="note">This paper is listed as a source for “{ix.nodes.get(e.target)?.label}”. Below are only this paper’s quotes about it.</p>
          : e.note && <p className="note">{e.note}</p>}
        {e.contexts && <p className="small"><span className="muted">Context:</span> {e.contexts}</p>}
        {(!derived || e.evidence.length > 0) && (
          <>
            <h4>{paperMention ? 'Quotes from this paper' : 'Evidence from the papers'}</h4>
            <EvidenceList ev={e.evidence} labelOf={paperLabel} match={match} />
          </>
        )}
        {(e.grounding || e.validation.length > 0 || e.papers.length > 4) && (
          <Section title="Extraction details" defaultOpen={false}>
            {e.grounding && <p className="small"><span className="muted">Grounding:</span> {e.grounding === 'review' ? 'indirect (supported by nearby passages)' : e.grounding.replace(/_/g, ' ')}</p>}
            {e.validation.length > 0 && <p className="small"><span className="muted">Quote validation:</span> {e.validation.join(', ').replace(/_/g, ' ')}</p>}
            {e.papers.length > 4 && <div className="row wrap">{e.papers.map(paperLink)}</div>}
          </Section>
        )}
      </div>
    );
  }

  const n: GNode | undefined = ix.nodes.get(selection.id) ?? vg.nodes.find((x) => x.id === selection.id);
  if (!n) return null;

  // ---------------- research gap ----------------
  if (n.type === 'Gap') {
    const g = gaps.find((x) => x.id === n.id)!;
    const v = verifications[g.id];
    return (
      <div className="inspector">
        <div className="eyebrow">Research gap · {GAP_KIND_LABEL[g.kind]}</div>
        <h3>{g.title}</h3>
        <p className="lead">{GAP_KIND_HELP[g.kind]}</p>

        <div className={`verdict v-${v?.verdict ?? 'unverified'}`}>
          <div className="row"><VerdictBadge verdict={v?.verdict} />{v && <span className="muted small">{VERDICT_HELP[v.verdict]}</span>}</div>
          {v ? (
            <>
              <p>{v.note}</p>
              {v.corpusRefs.length > 0 && (
                <div className="row wrap">
                  {v.corpusRefs.map((r) => (r.startsWith('missing:') ? <span key={r} className="chip warn" title="Planned paper that is not in this graph">Paper #{r.slice(8)} (missing)</span> : paperLink(r)))}
                </div>
              )}
              {(v.reviewer || v.date) && (
                <p className="muted small" title={reviewMethod}>
                  {/claude|gpt|llm|gemini|model/i.test(v.reviewer ?? '')
                    ? <>AI-assisted review ({v.reviewer}{v.date ? `, ${v.date}` : ''}), not a human review.</>
                    : <>Reviewed{v.reviewer ? ` by ${v.reviewer}` : ''}{v.date ? ` · ${v.date}` : ''}</>}
                </p>
              )}
            </>
          ) : (
            <p className="muted">Generated automatically and not yet reviewed. Treat it as a hypothesis.</p>
          )}
        </div>

        <div className="row wrap"><span className="muted small">About:</span>{g.focus.map((f) => <span key={f}>{nodeLink(f)}</span>)}</div>
        {focusButton({ mode: 'gap', gapId: g.id }, 'Show in graph', view.mode === 'gap' && view.gapId === g.id)}

        <h4>How papers in the collection could close it <span className="count">{g.resolutions.length}</span></h4>
        <p className="hint">Suggested by ResearchGraph from the graph. Each suggestion points to a claim in another paper, not to a result.</p>
        {g.resolutions.length === 0 && <p className="muted small">No match in the collection. This may be a truly open question, or the extraction missed the relevant links.</p>}
        <ShowMore
          items={g.resolutions}
          initial={3}
          as="ol"
          className="resolutions"
          render={(r, i) => (
            <li key={i}>
              <p>{r.rationale}</p>
              <div className="row wrap">
                {r.nodeId && nodeLink(r.nodeId)}
                {r.paperIds.map(paperLink)}
                <span className={`tag ${r.observed ? 'ok' : 'warn'}`} title={r.observed ? 'Based on an observed claim' : 'Based on a hypothesized or indirect claim'}>{r.observed ? 'Based on observed claim' : 'Weaker basis'}</span>
              </div>
            </li>
          )}
        />

        <Section title="Why the rule flagged this" defaultOpen={false}>
          <p className="small">{g.description}</p>
          <p className="muted small">Ranking score {g.score.toFixed(1)}: higher means the topic is more central in the collection.</p>
          <div className="row wrap">{g.papers.map(paperLink)}</div>
        </Section>
      </div>
    );
  }

  // ---------------- paper ----------------
  if (n.type === 'Paper') {
    const pid = n.paperId!;
    const m = ix.paperById.get(pid)!;
    const ents = [...(ix.paperEntities.get(pid) ?? [])].map((id) => ix.nodes.get(id)!);
    const byType = new Map<NodeType, GNode[]>();
    for (const x of ents) {
      if (!byType.has(x.type)) byType.set(x.type, []);
      byType.get(x.type)!.push(x);
    }
    const order: NodeType[] = ['Method', 'EvaluationMethod', 'AIModel', 'Behavior', 'Concept', 'Mechanism', 'ExperimentalCondition', 'Finding', 'Hypothesis'];
    const aligned = alignedPapers(ix, pid, cites, 6);
    const out = cites.outgoing(pid);
    const inn = cites.incoming(pid);
    const pg = gaps.filter((g) => g.papers.includes(pid)).slice(0, 8);
    return (
      <div className="inspector">
        <div className="eyebrow">Paper · {paperShortLabel(m)}</div>
        <h3>{m.title}</h3>
        <p className="muted small" title={m.sourcePdf}>{ents.length} extracted entities · evidence on {n.mentionCount} pages</p>
        <div className="row wrap">
          {focusButton({ mode: 'paper', paperId: pid }, 'Focus graph on this paper', view.mode === 'paper' && view.paperId === pid)}
          <button className="btn sm" onClick={() => onView({ mode: 'compare', a: pid, b: view.mode === 'compare' && view.a !== pid ? view.a : null })}>Compare with…</button>
        </div>

        <h4>What it studies</h4>
        {order.filter((t) => byType.has(t) && t !== 'Finding' && t !== 'Hypothesis').map((t) => {
          const list = byType.get(t)!.sort((a, b) => (b.perPaper.get(pid) ?? 0) - (a.perPaper.get(pid) ?? 0));
          return (
            <Section key={t} title={`${NODE_STYLE[t].label} · ${USES_LABEL[t] ?? ''}`} count={list.length} defaultOpen={['Method', 'Behavior'].includes(t)}>
              <ShowMore items={list.slice(0, 25)} initial={6} render={(x) => <li key={x.id}>{nodeLink(x.id)} {x.paperCount > 1 && <span className="muted small">· in {x.paperCount} papers</span>}</li>} />
            </Section>
          );
        })}
        {(['Finding', 'Hypothesis'] as NodeType[]).filter((t) => byType.has(t)).map((t) => (
          <Section key={t} title={t === 'Finding' ? 'Reported findings' : 'Hypotheses'} count={byType.get(t)!.length} defaultOpen={false}>
            <ShowMore items={byType.get(t)!.slice(0, 25)} initial={5} render={(x) => <li key={x.id}>{nodeLink(x.id)}</li>} />
          </Section>
        ))}

        <h4>Related papers</h4>
        <p className="hint">Papers that share the most distinctive concepts with this one.</p>
        <ShowMore
          items={aligned}
          initial={3}
          render={(a) => (
            <li key={a.paperId} className="related">
              <div className="row">{paperLink(a.paperId)}{(a.citesIt > 0 || a.citedBy > 0) && <span className="muted small">{a.citesIt ? 'mentions it' : 'mentioned by it'}</span>}</div>
              <div className="small muted">Shared: {a.shared.slice(0, 4).map((s) => s.label).join(', ')}</div>
            </li>
          )}
        />

        {pg.length > 0 && (
          <Section title="Research gaps it touches" count={pg.length} defaultOpen={false}>
            <ul className="plain">{pg.map((g) => <li key={g.id}><button className="link" onClick={() => onSelect({ kind: 'node', id: g.id })}>{g.title}</button> <VerdictBadge verdict={verifications[g.id]?.verdict} /></li>)}</ul>
          </Section>
        )}
        {grounding && (() => {
          const citesOut = grounding.cites(pid);
          const citesIn = grounding.citedBy(pid);
          const missing = grounding.file.referencesMissing.includes(pid);
          const chip = (other: string, key: string) => {
            const m = ix.paperById.get(other);
            const rank = other.startsWith('rank:') ? Number(other.slice(5)) : null;
            return m
              ? <button key={key} className="chip paper" title={`Compare ${paperShortLabel(ix.paperById.get(pid)!)} with ${m.title}`} onClick={() => onView({ mode: 'compare', a: pid, b: other })}>{paperShortLabel(m)}</button>
              : <span key={key} className="chip muted" title={rank != null ? `${KNOWN_TITLES[rank] ?? ''} (not in this graph)` : other}>#{rank ?? other} · not in graph</span>;
          };
          return (
            <Section title="Citations" count={citesOut.length + citesIn.length} defaultOpen={false} hint="Matched automatically in reference lists (not reviewed by a person). Select a paper to compare the two. A citation is not agreement.">
              <div className="small muted">Cites</div>
              {missing ? <p className="muted small">This paper’s reference list could not be located, so its outgoing citations are unknown.</p>
                : citesOut.length ? <div className="row wrap">{citesOut.map((c) => chip(c.target, c.target))}</div> : <p className="muted small">None found among papers in this collection (automated search).</p>}
              <div className="small muted">Cited by</div>
              {citesIn.length ? <div className="row wrap">{citesIn.map((c) => chip(c.source, c.source))}</div> : <p className="muted small">None found (only papers whose reference lists were located are searched).</p>}
            </Section>
          );
        })()}
        <Section title={grounding ? 'Author–year mentions (approximate)' : 'Mentions of other papers'} count={out.length + inn.length} defaultOpen={false} hint="Found by matching author and year in extracted passages, so this list is approximate.">
          <div className="small muted">Mentions</div>
          {out.length ? <div className="row wrap">{out.map((c) => <span key={c.to} className="row">{paperLink(c.to)}{c.ambiguous && <span className="tag warn" title="Same first author and year as another paper in the collection">ambiguous</span>}</span>)}</div> : <p className="muted small">None detected.</p>}
          <div className="small muted">Mentioned by</div>
          {inn.length ? <div className="row wrap">{inn.map((c) => <span key={c.from} className="row">{paperLink(c.from)}{c.ambiguous && <span className="tag warn">ambiguous</span>}</span>)}</div> : <p className="muted small">None detected.</p>}
        </Section>
        <p className="muted small mono">{m.sourcePdf}</p>
      </div>
    );
  }

  // ---------------- entity (concept, behavior, method, finding, ...) ----------------
  const outE = (ix.out.get(n.id) ?? []).filter((e) => e.kind === 'semantic');
  const inE = (ix.inc.get(n.id) ?? []).filter((e) => e.kind === 'semantic');
  const relGaps = gaps.filter((g) => g.focus.includes(n.id));
  const claims = [...outE.map((e) => ({ e, dir: 'out' as const })), ...inE.map((e) => ({ e, dir: 'in' as const }))]
    .sort((a, b) => (a.e.claimType === 'observed' ? 0 : 1) - (b.e.claimType === 'observed' ? 0 : 1) || b.e.evidenceCount - a.e.evidenceCount);
  return (
    <div className="inspector">
      <div className="eyebrow"><TypeTag t={n.type} /> · in {n.paperCount} paper{n.paperCount === 1 ? '' : 's'} · {n.mentionCount} mentions</div>
      <h3>{n.label}</h3>
      {n.aliases.length > 0 && <p className="muted small">Also called: {n.aliases.join(', ')}</p>}
      <div className="row wrap">{n.papers.slice(0, 8).map(paperLink)}{n.papers.length > 8 && <span className="muted small">+{n.papers.length - 8} more</span>}</div>
      {focusButton({ mode: 'entity', nodeId: n.id }, 'Focus graph on this', view.mode === 'entity' && view.nodeId === n.id)}

      {relGaps.length > 0 && (
        <div className="callout">
          <div className="small"><b>{relGaps.length} research gap{relGaps.length > 1 ? 's' : ''}</b> involve{relGaps.length > 1 ? '' : 's'} this</div>
          <ul className="plain">
            {relGaps.map((g) => (
              <li key={g.id} className="row"><button className="link" onClick={() => onSelect({ kind: 'node', id: g.id })}>{GAP_KIND_LABEL[g.kind]}</button><VerdictBadge verdict={verifications[g.id]?.verdict} /></li>
            ))}
          </ul>
        </div>
      )}

      {claims.length > 0 && (
        <>
          <h4>Claims involving it <span className="count">{claims.length}</span></h4>
          <p className="hint">Select a claim to read its source quotes.</p>
          <ShowMore
            items={claims}
            initial={6}
            className="claims"
            render={({ e, dir }) => (
              <li key={e.id}>
                <button className="claimrow" onClick={() => onSelect({ kind: 'edge', id: e.id })}>
                  <span className="ctext">
                    {dir === 'in' ? <>{ix.nodes.get(e.source)?.label} <span className={`pred ${e.negated ? 'neg' : ''}`}>{e.label}</span> <i>this</i></> : <><i>this</i> <span className={`pred ${e.negated ? 'neg' : ''}`}>{e.label}</span> {ix.nodes.get(e.target)?.label}</>}
                  </span>
                  <span className="cmeta"><ClaimBadge type={e.claimType} />{e.negated && <span className="tag bad">Negative</span>}{grounding?.flag(e.id) && <span className="tag warn" title={grounding.flag(e.id)!.text}>Review</span>}<Icon name="chevron" size={12} /></span>
                </button>
              </li>
            )}
          />
        </>
      )}
      <h4>Evidence from the papers</h4>
      <EvidenceList ev={n.evidence} labelOf={paperLabel} match={match} />
    </div>
  );
}
