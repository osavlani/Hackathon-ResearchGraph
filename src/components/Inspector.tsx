import type { GraphIndex } from '../data/graphIndex';
import { paperShortLabel } from '../data/graphIndex';
import type { Gap } from '../analysis/gaps';
import { GAP_KIND_LABEL } from '../analysis/gaps';
import type { CitationIndex } from '../analysis/related';
import { alignedPapers, USES_LABEL } from '../analysis/related';
import type { GapVerification } from '../analysis/verification';
import { VERDICT_LABEL } from '../analysis/verification';
import type { View, ViewGraph } from '../analysis/views';
import type { Evidence, GEdge, GNode, NodeType } from '../types';
import { NODE_STYLE } from '../theme';
import type { Selection } from './GraphView';

interface Props {
  ix: GraphIndex;
  vg: ViewGraph;
  gaps: Gap[];
  cites: CitationIndex;
  verifications: Record<string, GapVerification>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onView: (v: View) => void;
}

function EvidenceList({ ev, max = 6 }: { ev: Evidence[]; max?: number }) {
  const ok = ev.filter((e) => e.validationStatus === 'verified' || e.validationStatus === 'fuzzy_verified' || e.validationStatus == null);
  const bad = ev.filter((e) => !ok.includes(e));
  if (!ev.length)
    return <p className="muted small">No supporting quote was extracted for this item, so there is no page reference to show.</p>;
  return (
    <>
      <ul className="evidence">
        {ok.slice(0, max).map((e, i) => (
          <li key={i}>
            <blockquote>“{e.passage}”</blockquote>
            <div className="evmeta">
              <span className="mono">{e.sourcePdf || e.paperId}</span>
              {e.page != null && <span> · p.{e.page}</span>}
              {e.validationStatus === 'fuzzy_verified' ? <span className="badge amber">fuzzy match</span> : e.validationStatus === 'verified' ? <span className="badge green">verified</span> : null}
              {e.claimType && <span className="badge">{e.claimType}</span>}
            </div>
            {e.context && <div className="muted small">context: {e.context}</div>}
          </li>
        ))}
      </ul>
      {ok.length > max && <p className="muted small">+{ok.length - max} more quotes</p>}
      {bad.length > 0 && (
        <details>
          <summary className="small">{bad.length} unverified quote(s) — not shown as evidence</summary>
          <ul className="evidence">{bad.map((e, i) => <li key={i} className="muted">“{e.passage}” <span className="badge red">unverified</span></li>)}</ul>
        </details>
      )}
    </>
  );
}

function TypeTag({ t }: { t: NodeType }) {
  return <span className="typetag" style={{ borderColor: NODE_STYLE[t].color, color: NODE_STYLE[t].color }}>{t}</span>;
}

export default function Inspector({ ix, vg, gaps, cites, verifications, selection, onSelect, onView }: Props) {
  if (!selection)
    return (
      <div className="empty-inspector">
        <div className="big">⌕</div>
        <h3>Nothing selected</h3>
        <p className="muted">Click a node or a relationship in the graph to see its evidence, papers and page references. Double-click a node to centre the graph on it.</p>
      </div>
    );

  const nodeLink = (id: string) => {
    const n = ix.nodes.get(id) ?? vg.nodes.find((x) => x.id === id);
    if (!n) return <span>{id}</span>;
    const label = n.type === 'Paper' ? paperShortLabel(ix.paperById.get(n.paperId!)!) : n.label;
    return <button className="link" onClick={() => onSelect({ kind: 'node', id })}>{label}</button>;
  };
  const paperLink = (pid: string) => {
    const m = ix.paperById.get(pid);
    return m ? <button key={pid} className="chip" title={m.title} onClick={() => onView({ mode: 'paper', paperId: pid })}>{paperShortLabel(m)}</button> : <span key={pid} className="chip muted" title="Not a Paper node in the graph">{pid}</span>;
  };

  if (selection.kind === 'edge') {
    const e: GEdge | undefined = vg.edges.find((x) => x.id === selection.id);
    if (!e) return null;
    return (
      <div className="inspector">
        <div className="eyebrow">Relationship · {e.kind}</div>
        <h3>{nodeLink(e.source)} <span className="pred">{e.label}</span> {nodeLink(e.target)}</h3>
        <div className="row wrap">
          {e.claimType && <span className={`badge ${e.claimType === 'observed' ? 'green' : e.claimType === 'hypothesized' ? 'amber' : ''}`}>{e.claimType}</span>}
          {e.negated && <span className="badge red">negated</span>}
          {e.grounding && <span className="badge">{e.grounding.replace(/_/g, ' ')}</span>}
          {e.validation.map((v) => <span key={v} className="badge">{v}</span>)}
        </div>
        {e.note && <p className="small note">{e.note}</p>}
        {e.contexts && <p className="small"><b>Contexts:</b> {e.contexts}</p>}
        {e.papers.length > 0 && <div className="row wrap">{e.papers.map(paperLink)}</div>}
        <h4>Evidence</h4>
        <EvidenceList ev={e.evidence} />
      </div>
    );
  }

  const n: GNode | undefined = ix.nodes.get(selection.id) ?? vg.nodes.find((x) => x.id === selection.id);
  if (!n) return null;

  if (n.type === 'Gap') {
    const g = gaps.find((x) => x.id === n.id)!;
    const v = verifications[g.id];
    return (
      <div className="inspector">
        <div className="eyebrow">Gap · {GAP_KIND_LABEL[g.kind]} · engine score {g.score.toFixed(1)}</div>
        <h3>{g.title}</h3>
        {v ? (
          <div className={`verdict v-${v.verdict}`}>
            <b>{VERDICT_LABEL[v.verdict]}</b>
            <p className="small">{v.note}</p>
            {v.corpusRefs.length > 0 && <div className="row wrap">{v.corpusRefs.map((r) => (r.startsWith('missing:') ? <span key={r} className="chip warn" title="Curated paper not present in this graph">{r}</span> : paperLink(r)))}</div>}
          </div>
        ) : (
          <div className="verdict v-unverified"><b>Not yet verified</b><p className="small">Engine output only. Treat as a hypothesis.</p></div>
        )}
        <p className="small">{g.description}</p>
        <h4>About</h4>
        <div className="row wrap">{g.focus.map((f) => <span key={f}>{nodeLink(f)}</span>)}</div>
        <h4>How to resolve it with the corpus ({g.resolutions.length})</h4>
        {g.resolutions.length === 0 && <p className="muted small">No corpus entity matched. This may be a true open gap, or the extractor missed the relevant edges.</p>}
        <ol className="resolutions">
          {g.resolutions.map((r, i) => (
            <li key={i}>
              <p className="small">{r.rationale}</p>
              <div className="row wrap">
                {r.nodeId && nodeLink(r.nodeId)}
                {r.paperIds.map(paperLink)}
                <span className={`badge ${r.observed ? 'green' : 'amber'}`}>{r.observed ? 'observed' : 'weaker'}</span>
              </div>
            </li>
          ))}
        </ol>
        <h4>Papers involved</h4>
        <div className="row wrap">{g.papers.map(paperLink)}</div>
        <button className="btn" onClick={() => onView({ mode: 'gap', gapId: g.id })}>Centre graph on this gap</button>
      </div>
    );
  }

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
        <p className="muted small mono">{m.sourcePdf} · {n.mentionCount} pages with evidence</p>
        <button className="btn" onClick={() => onView({ mode: 'paper', paperId: pid })}>Centre graph on this paper</button>
        <h4>Aligned papers</h4>
        <ul className="plain">
          {aligned.map((a) => (
            <li key={a.paperId}>
              {paperLink(a.paperId)} <span className="muted small">sim {a.score.toFixed(2)}{a.citesIt ? ' · mentions it' : ''}{a.citedBy ? ' · mentioned by it' : ''}</span>
              <div className="small muted">shares: {a.shared.slice(0, 5).map((s) => s.label).join(', ')}</div>
            </li>
          ))}
        </ul>
        <h4>Mentions other corpus papers <span className="muted small">(detected in extracted passages)</span></h4>
        {out.length ? <div className="row wrap">{out.map((c) => <span key={c.to}>{paperLink(c.to)}{c.ambiguous && <span className="badge amber" title="Same first author + year as another corpus paper">ambiguous</span>}</span>)}</div> : <p className="muted small">None detected.</p>}
        <h4>Mentioned by</h4>
        {inn.length ? <div className="row wrap">{inn.map((c) => <span key={c.from}>{paperLink(c.from)}{c.ambiguous && <span className="badge amber">ambiguous</span>}</span>)}</div> : <p className="muted small">None detected.</p>}
        {order.filter((t) => byType.has(t)).map((t) => {
          const list = byType.get(t)!.sort((a, b) => (b.perPaper.get(pid) ?? 0) - (a.perPaper.get(pid) ?? 0));
          return (
            <details key={t} open={['Method', 'EvaluationMethod', 'AIModel', 'Behavior'].includes(t)}>
              <summary><TypeTag t={t} /> {USES_LABEL[t]} · {list.length}</summary>
              <ul className="plain">{list.slice(0, 25).map((x) => <li key={x.id}>{nodeLink(x.id)} {x.paperCount > 1 && <span className="muted small">· {x.paperCount} papers</span>}</li>)}</ul>
            </details>
          );
        })}
        {pg.length > 0 && (
          <>
            <h4>Gaps this paper touches</h4>
            <ul className="plain">{pg.map((g) => <li key={g.id}><button className="link" onClick={() => onSelect({ kind: 'node', id: g.id })}>{g.title}</button></li>)}</ul>
          </>
        )}
      </div>
    );
  }

  // entity
  const outE = (ix.out.get(n.id) ?? []).filter((e) => e.kind === 'semantic');
  const inE = (ix.inc.get(n.id) ?? []).filter((e) => e.kind === 'semantic');
  const relGaps = gaps.filter((g) => g.focus.includes(n.id));
  const rel = (list: GEdge[], dir: 'out' | 'in') =>
    list.slice(0, 20).map((e) => (
      <li key={e.id}>
        <button className="link" onClick={() => onSelect({ kind: 'node', id: dir === 'out' ? e.target : e.source })}>
          {dir === 'in' && `${ix.nodes.get(e.source)?.label} `}<span className="pred">{e.label}</span>{dir === 'out' && ` ${ix.nodes.get(e.target)?.label}`}
        </button>{' '}
        <span className={`badge ${e.claimType === 'observed' ? 'green' : e.claimType === 'hypothesized' ? 'amber' : ''}`}>{e.claimType}</span>
      </li>
    ));
  return (
    <div className="inspector">
      <div className="eyebrow"><TypeTag t={n.type} /> {n.mentionCount} mentions · {n.paperCount} paper(s)</div>
      <h3>{n.label}</h3>
      {n.aliases.length > 0 && <p className="muted small">aka {n.aliases.join(', ')}</p>}
      <div className="row wrap">{n.papers.map(paperLink)}</div>
      <button className="btn" onClick={() => onView({ mode: 'entity', nodeId: n.id })}>Centre graph on this</button>
      {relGaps.length > 0 && (
        <>
          <h4>Gaps</h4>
          <ul className="plain">{relGaps.map((g) => <li key={g.id}><button className="link" onClick={() => onSelect({ kind: 'node', id: g.id })}>{GAP_KIND_LABEL[g.kind]}</button>{verifications[g.id] && <span className={`badge v-${verifications[g.id].verdict}`}>{VERDICT_LABEL[verifications[g.id].verdict]}</span>}</li>)}</ul>
        </>
      )}
      {outE.length > 0 && <><h4>Outgoing ({outE.length})</h4><ul className="plain">{rel(outE, 'out')}</ul></>}
      {inE.length > 0 && <><h4>Incoming ({inE.length})</h4><ul className="plain">{rel(inE, 'in')}</ul></>}
      <h4>Evidence</h4>
      <EvidenceList ev={n.evidence} />
    </div>
  );
}
