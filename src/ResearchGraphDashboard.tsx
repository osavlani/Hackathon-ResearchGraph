import { useCallback, useMemo, useState } from 'react';
import type { NodeType, RawGraph } from './types';
import { buildIndex } from './data/graphIndex';
import { findGaps } from './analysis/gaps';
import { buildCitations } from './analysis/related';
import { buildView } from './analysis/views';
import type { View } from './analysis/views';
import { computeInsights } from './analysis/insights';
import type { InsightItem } from './analysis/insights';
import type { GapVerificationFile } from './analysis/verification';
import GraphView from './components/GraphView';
import type { Selection } from './components/GraphView';
import Inspector from './components/Inspector';
import PapersPanel from './components/PapersPanel';
import InsightsPanel from './components/InsightsPanel';
import GapsTable from './components/GapsTable';
import { NODE_STYLE, TYPE_ORDER, EDGE_COLORS } from './theme';

export interface ResearchGraphDashboardProps {
  /** Raw node-link JSON exactly as GET /graph returns it */
  graph: RawGraph;
  /** Optional reviewer verdicts for engine gaps (public/gap_verifications.json) */
  verifications?: GapVerificationFile | null;
  /** Where the data came from, shown in the status pill */
  sourceLabel?: string;
}

/**
 * Drop-in dashboard: papers/topic panel · graph · evidence inspector · research discovery · gaps table.
 * All analysis runs client-side from the graph; no other endpoint is required.
 */
export default function ResearchGraphDashboard({ graph, verifications, sourceLabel }: ResearchGraphDashboardProps) {
  const ix = useMemo(() => buildIndex(graph), [graph]);
  const gaps = useMemo(() => findGaps(ix), [ix]);
  const cites = useMemo(() => buildCitations(ix), [ix]);
  const ver = useMemo(() => verifications?.verifications ?? {}, [verifications]);
  const insights = useMemo(() => computeInsights(ix, gaps, ver), [ix, gaps, ver]);

  const [view, setView] = useState<View>({ mode: 'overview' });
  const [selection, setSelection] = useState<Selection>(null);
  const [showFindings, setShowFindings] = useState(false);
  const [showGaps, setShowGaps] = useState(true);
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set());
  const [fitSignal, setFit] = useState(0);
  const [filter, setFilter] = useState('');

  const vg = useMemo(
    () => buildView(ix, view, gaps, cites, { showFindings, showGaps, hiddenTypes }),
    [ix, view, gaps, cites, showFindings, showGaps, hiddenTypes],
  );

  const go = useCallback((v: View) => {
    setView(v);
    if (v.mode === 'paper') setSelection({ kind: 'node', id: `paper:${v.paperId}` });
    else if (v.mode === 'entity') setSelection({ kind: 'node', id: v.nodeId });
    else if (v.mode === 'gap') setSelection({ kind: 'node', id: v.gapId });
    else setSelection(null);
  }, []);

  const openNode = useCallback(
    (id: string) => {
      const n = ix.nodes.get(id);
      if (id.startsWith('paper:')) go({ mode: 'paper', paperId: id.slice(6) });
      else if (n) go({ mode: 'entity', nodeId: id });
      else if (gaps.some((g) => g.id === id)) go({ mode: 'gap', gapId: id });
    },
    [ix, gaps, go],
  );

  // select a node; if it's not in the current view, re-centre on it
  const selectNode = useCallback(
    (s: Selection) => {
      if (s?.kind === 'node' && !vg.nodes.some((n) => n.id === s.id)) openNode(s.id);
      else setSelection(s);
    },
    [vg, openNode],
  );

  const onInsight = (t: InsightItem['target']) =>
    t.kind === 'gap' ? go({ mode: 'gap', gapId: t.id }) : t.kind === 'paper' ? go({ mode: 'paper', paperId: t.id }) : go({ mode: 'entity', nodeId: t.id });

  const visibleCounts = useMemo(() => {
    const c = new Map<NodeType, number>();
    for (const n of vg.nodes) c.set(n.type, (c.get(n.type) ?? 0) + 1);
    return c;
  }, [vg]);

  const filterHits = filter.trim()
    ? vg.nodes.filter((n) => (vg.display.get(n.id) ?? n.label).toLowerCase().includes(filter.toLowerCase())).slice(0, 8)
    : [];

  const crumbs =
    view.mode === 'overview' ? 'Overview'
      : view.mode === 'topic' ? `Topic · ${view.query}`
      : view.mode === 'paper' ? `Paper · ${ix.paperById.get(view.paperId)?.shortTitle ?? view.paperId}`
      : view.mode === 'entity' ? `Entity · ${ix.nodes.get(view.nodeId)?.label ?? ''}`
      : `Gap · ${gaps.find((g) => g.id === view.gapId)?.title ?? ''}`;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">◇</div>
          <div>
            <div className="title">Research<span>Graph</span></div>
            <div className="sub">Multi-Agent Research Discovery Platform</div>
          </div>
        </div>
        <div className="row">
          <span className="pill ok">● Graph loaded</span>
          <span className="pill">{sourceLabel ?? 'graph'}</span>
          <span className="pill">{ix.papers.length} papers · {ix.nodes.size} nodes · {ix.edges.length} edges</span>
          <span className="pill">{gaps.length} gaps · {Object.keys(ver).length} verified</span>
        </div>
      </header>

      <div className="main">
        <PapersPanel ix={ix} view={view} onView={go} onSelectNode={(id) => selectNode({ kind: 'node', id })} />

        <section className="panel center">
          <div className="toolbar">
            <div className="crumbs">
              {view.mode !== 'overview' && <button className="link" onClick={() => go({ mode: 'overview' })}>Overview</button>}
              {view.mode !== 'overview' && ' / '}
              <b>{crumbs}</b>
            </div>
            <div className="filterbox">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find in view…" aria-label="Find node in view" />
              {filterHits.length > 0 && (
                <ul className="dropdown">
                  {filterHits.map((n) => (
                    <li key={n.id}><button onClick={() => { setSelection({ kind: 'node', id: n.id }); setFilter(''); }}>{n.label}</button></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="row wrap chips">
            {TYPE_ORDER.filter((t) => visibleCounts.has(t) || hiddenTypes.has(t)).map((t) => (
              <button
                key={t}
                className={`chip type ${hiddenTypes.has(t) ? 'off' : ''}`}
                onClick={() => setHiddenTypes((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; })}
                aria-pressed={!hiddenTypes.has(t)}
              >
                <span className="dot" style={{ background: NODE_STYLE[t].color }} />
                {NODE_STYLE[t].label} {visibleCounts.get(t) ?? 0}
              </button>
            ))}
            <span className="spacer" />
            <label className="toggle"><input type="checkbox" checked={showFindings} onChange={(e) => setShowFindings(e.target.checked)} /> Findings & hypotheses</label>
            <label className="toggle"><input type="checkbox" checked={showGaps} onChange={(e) => setShowGaps(e.target.checked)} /> Gaps</label>
            <button className="btn ghost" onClick={() => setFit((x) => x + 1)}>Fit to screen</button>
            <button className="btn ghost" onClick={() => go({ mode: 'overview' })}>Reset view</button>
          </div>
          <div className="viewnote">
            <span>Showing {vg.nodes.length} of {vg.total} nodes. {vg.note}</span>
            {!showFindings && <span className="muted"> Findings & hypotheses hidden by default.</span>}
          </div>
          <div className="graphwrap">
            <GraphView vg={vg} selection={selection} onSelect={selectNode} onOpen={openNode} verifications={ver} fitSignal={fitSignal} />
            {vg.nodes.length === 0 && <div className="graph-empty">Nothing to show for this view.</div>}
          </div>
          <div className="legend">
            <span><i style={{ borderColor: EDGE_COLORS.semantic }} /> observed</span>
            <span><i className="dashed" style={{ borderColor: EDGE_COLORS.hypothesized }} /> hypothesized</span>
            <span><i className="dotted" style={{ borderColor: EDGE_COLORS.cites }} /> cited / mentions</span>
            <span><i style={{ borderColor: EDGE_COLORS.negated }} /> negated</span>
            <span><i className="dashed" style={{ borderColor: EDGE_COLORS.aligned }} /> aligned papers</span>
            <span><i className="dashed" style={{ borderColor: EDGE_COLORS.gap }} /> leads to gap</span>
            <span><i className="dashed" style={{ borderColor: EDGE_COLORS.resolve }} /> could resolve</span>
            <span><i style={{ borderColor: EDGE_COLORS.uses }} /> paper uses</span>
          </div>
        </section>

        <aside className="panel right">
          <div className="panel-head"><h2>Evidence inspector</h2></div>
          <Inspector ix={ix} vg={vg} gaps={gaps} cites={cites} verifications={ver} selection={selection} onSelect={selectNode} onView={go} />
        </aside>
      </div>

      <InsightsPanel insights={insights} verifications={ver} verifiedCount={gaps.filter((g) => ver[g.id]).length} gapCount={gaps.length} onItem={onInsight} />
      <GapsTable gaps={gaps} verifications={ver} onOpen={(id) => go({ mode: 'gap', gapId: id })} />
    </div>
  );
}
