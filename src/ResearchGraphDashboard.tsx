import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeType, RawGraph } from './types';
import { buildIndex, paperShortLabel } from './data/graphIndex';
import type { GraphIndex } from './data/graphIndex';
import { findGaps } from './analysis/gaps';
import type { Gap } from './analysis/gaps';
import { alignedPapers, buildCitations } from './analysis/related';
import { buildView } from './analysis/views';
import type { View } from './analysis/views';
import { computeInsights } from './analysis/insights';
import { comparePapers } from './analysis/compare';
import { buildGroundingIndex } from './analysis/grounding';
import type { GroundingFile } from './analysis/grounding';
import type { InsightItem } from './analysis/insights';
import type { GapVerificationFile } from './analysis/verification';
import GraphView from './components/GraphView';
import type { GraphHandle, RevealFrame, Selection } from './components/GraphView';
import RevealBar from './components/RevealBar';
import { buildRevealSequence } from './analysis/reveal';
import { IDLE, RevealPlayer, stepDurations } from './analysis/revealPlayer';
import type { PlayerState } from './analysis/revealPlayer';
import Inspector from './components/Inspector';
import PapersPanel from './components/PapersPanel';
import InsightsPanel from './components/InsightsPanel';
import GapsPanel from './components/GapsPanel';
import ComparePanel from './components/ComparePanel';
import { EXAMPLE_QUERIES } from './components/copy';
import { Icon, IconButton, Popover } from './components/ui';
import { NODE_STYLE, TYPE_ORDER, EDGE_COLORS, VERDICT_COLOR } from './theme';

export interface ResearchGraphDashboardProps {
  /** Raw node-link JSON exactly as GET /graph returns it */
  graph: RawGraph;
  /** Optional reviewer verdicts for engine gaps (public/gap_verifications.json) */
  verifications?: GapVerificationFile | null;
  /** Optional local grounding results (public/grounding.json): automatically matched citations and PDF quote matches */
  grounding?: GroundingFile | null;
  /** SHA-256 of the loaded graph bytes; grounding data is used only if it was produced for this exact graph */
  graphSha256?: string | null;
  /** Where the data came from, shown in the status pill */
  sourceLabel?: string;
}

type SideTab = 'papers' | 'gaps' | 'compare' | 'discover';
const ONBOARD_KEY = 'rg-onboarding-dismissed';

// ---------- view <-> URL hash, so browser Back/Forward work and views can be shared ----------
function viewToHash(v: View): string {
  switch (v.mode) {
    case 'overview': return '#/';
    case 'topic': return `#/topic/${encodeURIComponent(v.query)}`;
    case 'paper': return `#/paper/${encodeURIComponent(v.paperId)}`;
    case 'entity': return `#/entity/${encodeURIComponent(v.nodeId)}`;
    case 'gap': return `#/gap/${encodeURIComponent(v.gapId)}`;
    case 'compare': return `#/compare/${encodeURIComponent(v.a ?? '_')}/${encodeURIComponent(v.b ?? '_')}`;
  }
}
function hashToView(hash: string, ix: GraphIndex, gaps: Gap[]): View {
  const c = hash.match(/^#\/compare\/([^/]+)\/([^/]+)$/);
  if (c) {
    const pick = (x: string) => { const id = decodeURIComponent(x); return ix.paperById.has(id) ? id : null; };
    const a = pick(c[1]);
    const b = pick(c[2]);
    return { mode: 'compare', a, b: b === a ? null : b };
  }
  const m = hash.match(/^#\/(topic|paper|entity|gap)\/(.+)$/);
  if (!m) return { mode: 'overview' };
  const arg = decodeURIComponent(m[2]);
  if (m[1] === 'topic' && arg.trim()) return { mode: 'topic', query: arg };
  if (m[1] === 'paper' && ix.paperById.has(arg)) return { mode: 'paper', paperId: arg };
  if (m[1] === 'entity' && ix.nodes.has(arg)) return { mode: 'entity', nodeId: arg };
  if (m[1] === 'gap' && gaps.some((g) => g.id === arg)) return { mode: 'gap', gapId: arg };
  return { mode: 'overview' };
}
function selectionFor(v: View): Selection {
  if (v.mode === 'paper') return { kind: 'node', id: `paper:${v.paperId}` };
  if (v.mode === 'entity') return { kind: 'node', id: v.nodeId };
  if (v.mode === 'gap') return { kind: 'node', id: v.gapId };
  return null;
}

/**
 * Drop-in dashboard: navigation sidebar (papers · gaps · discover) · graph · contextual evidence panel.
 * All analysis runs client-side from the graph; no other endpoint is required.
 */
export default function ResearchGraphDashboard({ graph, verifications, grounding, graphSha256 = null, sourceLabel }: ResearchGraphDashboardProps) {
  const ix = useMemo(() => buildIndex(graph), [graph]);
  const gaps = useMemo(() => findGaps(ix), [ix]);
  const cites = useMemo(() => buildCitations(ix), [ix]);
  const ver = useMemo(() => verifications?.verifications ?? {}, [verifications]);
  const insights = useMemo(() => computeInsights(ix, gaps, ver), [ix, gaps, ver]);
  const groundingCheck = useMemo(
    () => (grounding ? buildGroundingIndex(grounding, ix, { sha256: graphSha256 }) : null),
    [grounding, ix, graphSha256],
  );
  // stale grounding data is never used: no citation, PDF-match or review labels are derived from it
  const gx = groundingCheck && !groundingCheck.stale ? groundingCheck : null;

  const initialView = useMemo(() => hashToView(window.location.hash, ix, gaps), [ix, gaps]);
  const [view, setView] = useState<View>(initialView);
  const [selection, setSelection] = useState<Selection>(() => selectionFor(initialView));
  const [query, setQuery] = useState(initialView.mode === 'topic' ? initialView.query : '');
  // last searched topic stays pinned in the sidebar while the user opens papers / entities from it
  const [topic, setTopic] = useState<string | null>(initialView.mode === 'topic' ? initialView.query : null);
  const [sideTab, setSideTab] = useState<SideTab>(initialView.mode === 'gap' ? 'gaps' : initialView.mode === 'compare' ? 'compare' : 'papers');
  const [mobilePane, setMobilePane] = useState<'graph' | 'side'>(initialView.mode === 'compare' ? 'side' : 'graph');
  const [depth, setDepth] = useState<number>(() => (window.history.state as { depth?: number } | null)?.depth ?? 0);
  const [showFindings, setShowFindings] = useState(false);
  const [showGaps, setShowGaps] = useState(true);
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set());
  const [filter, setFilter] = useState('');
  const [onboarding, setOnboarding] = useState(() => {
    try { return localStorage.getItem(ONBOARD_KEY) !== '1'; } catch { return true; }
  });
  const graphRef = useRef<GraphHandle>(null);

  const cmp = useMemo(
    () => (view.mode === 'compare' && view.a && view.b ? comparePapers(ix, view.a, view.b, gaps, gx?.between(view.a, view.b) ?? null) : null),
    [ix, view, gaps, gx],
  );

  // ---- Research Connection Reveal: presentation of `cmp` only (no new analysis) ----
  // cmp already excludes citations when grounding data failed the integrity check (gx === null).
  const revealSeq = useMemo(() => (cmp ? buildRevealSequence(ix, cmp) : null), [ix, cmp]);
  const [revealPair, setRevealPair] = useState<string | null>(null);
  const [rv, setRv] = useState<PlayerState>(IDLE);
  const playerRef = useRef<RevealPlayer | null>(null);
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);
  // active only while the pair the user asked to reveal is the pair on screen: changing papers or
  // leaving Compare deactivates it, and the effect cleanup below cancels all timers
  const revealActive = !!revealSeq && view.mode === 'compare' && revealPair === revealSeq.pairKey;
  useEffect(() => {
    if (!revealActive || !revealSeq) return;
    const player = new RevealPlayer(stepDurations(revealSeq.steps.map((s) => s.kind)), setRv, reducedMotion);
    playerRef.current = player;
    player.start();
    // fit once the graph pane is laid out (on mobile it was hidden until the reveal switched to it)
    const raf = requestAnimationFrame(() => graphRef.current?.fit({ uncapped: true }));
    return () => {
      cancelAnimationFrame(raf);
      player.dispose();
      if (playerRef.current === player) playerRef.current = null;
    };
  }, [revealActive, revealSeq, reducedMotion]);
  const revealFrame = useMemo<RevealFrame | null>(
    () => (revealActive && revealSeq && rv.index >= 0 ? { steps: revealSeq.steps.map((s) => s.elements), index: rv.index, done: rv.done, reduced: reducedMotion } : null),
    [revealActive, revealSeq, rv, reducedMotion],
  );
  const startReveal = useCallback(() => {
    if (!revealSeq) return;
    setSelection(null);
    setMobilePane('graph');
    graphRef.current?.fit();
    if (revealPair === revealSeq.pairKey && playerRef.current) playerRef.current.replay();
    else setRevealPair(revealSeq.pairKey);
  }, [revealSeq, revealPair]);

  // one-click partners when only one paper is chosen: matched citations first, then the existing "related papers" score
  const compareSuggestions = useMemo(() => {
    if (view.mode !== 'compare' || (view.a && view.b) || (!view.a && !view.b)) return [];
    const pid = (view.a ?? view.b)!;
    const me = paperShortLabel(ix.paperById.get(pid)!).split(' · ')[0];
    const align = new Map(alignedPapers(ix, pid, cites, ix.papers.length).map((r) => [r.paperId, r]));
    const shares = (p: string) => align.get(p)?.shared.length ?? 0;
    const sharesText = (p: string) => (shares(p) ? ` · shares ${shares(p)} concept${shares(p) === 1 ? '' : 's'}` : '');
    const cited = new Map<string, string>();
    for (const c of gx?.cites(pid) ?? []) if (c.targetInGraph) cited.set(c.target, `${me} cites it (matched reference)`);
    for (const c of gx?.citedBy(pid) ?? []) if (c.sourceInGraph && !cited.has(c.source)) cited.set(c.source, `cites ${me} (matched reference)`);
    // most relevant first: cited papers ranked by shared-concept similarity, then related papers that actually share something
    const topCited = [...cited.entries()]
      .sort(([x], [y]) => (align.get(y)?.score ?? 0) - (align.get(x)?.score ?? 0))
      .slice(0, 3)
      .map(([p, why]) => [p, why + sharesText(p)] as [string, string]);
    const related = [...align.values()]
      .filter((r) => r.shared.length > 0 && !cited.has(r.paperId))
      .slice(0, 6 - topCited.length)
      .map((r) => [r.paperId, `shares ${r.shared.length} concept${r.shared.length === 1 ? '' : 's'}`] as [string, string]);
    return [...topCited, ...related].map(([paperId, reason]) => ({ paperId, reason }));
  }, [view, gx, ix, cites]);

  const vg = useMemo(
    () => buildView(ix, view, gaps, cites, { showFindings, showGaps, hiddenTypes }, cmp),
    [ix, view, gaps, cites, showFindings, showGaps, hiddenTypes, cmp],
  );

  const apply = useCallback((v: View) => {
    setView(v);
    setSelection(selectionFor(v));
    // any navigation (including browser Back/Forward) ends a connection reveal; it never restarts by itself
    setRevealPair(null);
    if (v.mode === 'topic') { setQuery(v.query); setTopic(v.query); }
    if (v.mode === 'compare') setSideTab('compare');
    // compare results are read in the side pane on mobile; everything else lands on the graph
    setMobilePane(v.mode === 'compare' ? 'side' : 'graph');
  }, []);

  /** Navigate: push a history entry so the browser Back button (and ours) returns here. */
  const go = useCallback(
    (v: View) => {
      const hash = viewToHash(v);
      if (hash !== window.location.hash && !(hash === '#/' && !window.location.hash)) {
        const d = ((window.history.state as { depth?: number } | null)?.depth ?? 0) + 1;
        window.history.pushState({ depth: d }, '', hash);
        setDepth(d);
      }
      apply(v);
    },
    [apply],
  );

  useEffect(() => {
    const onPop = () => {
      apply(hashToView(window.location.hash, ix, gaps));
      setDepth((window.history.state as { depth?: number } | null)?.depth ?? 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [apply, ix, gaps]);

  const openNode = useCallback(
    (id: string) => {
      const n = ix.nodes.get(id);
      if (id.startsWith('paper:')) go({ mode: 'paper', paperId: id.slice(6) });
      else if (n) go({ mode: 'entity', nodeId: id });
      else if (gaps.some((g) => g.id === id)) go({ mode: 'gap', gapId: id });
    },
    [ix, gaps, go],
  );

  // select a node; if it's not in the current view, re-centre on it.
  // In compare mode we never navigate away: the details panel opens on top of the comparison.
  const selectNode = useCallback(
    (s: Selection) => {
      if (view.mode !== 'compare' && s?.kind === 'node' && !vg.nodes.some((n) => n.id === s.id)) openNode(s.id);
      else setSelection(s);
    },
    [vg, openNode, view.mode],
  );

  const onInsight = (t: InsightItem['target']) =>
    t.kind === 'gap' ? go({ mode: 'gap', gapId: t.id }) : t.kind === 'paper' ? go({ mode: 'paper', paperId: t.id }) : go({ mode: 'entity', nodeId: t.id });

  const search = (q: string) => {
    const t = q.trim();
    if (!t) return;
    setSideTab('papers');
    go({ mode: 'topic', query: t });
  };

  const dismissOnboarding = () => {
    setOnboarding(false);
    try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* private mode */ }
  };

  const visibleCounts = useMemo(() => {
    const c = new Map<NodeType, number>();
    for (const n of vg.nodes) c.set(n.type, (c.get(n.type) ?? 0) + 1);
    return c;
  }, [vg]);

  const filterHits = filter.trim()
    ? vg.nodes.filter((n) => (vg.display.get(n.id) ?? n.label).toLowerCase().includes(filter.toLowerCase())).slice(0, 8)
    : [];

  const crumb =
    view.mode === 'overview' ? 'Overview'
      : view.mode === 'topic' ? `Topic: ${view.query}`
      : view.mode === 'paper' ? `Paper: ${ix.paperById.get(view.paperId)?.shortTitle ?? view.paperId}`
      : view.mode === 'entity' ? ix.nodes.get(view.nodeId)?.label ?? ''
      : view.mode === 'gap' ? `Gap: ${gaps.find((g) => g.id === view.gapId)?.title ?? ''}`
      : `Compare: ${[view.a, view.b].map((p) => (p ? paperShortLabel(ix.paperById.get(p)!) : '…')).join('  ×  ')}`;

  const tabs: { id: SideTab; label: string; count?: number }[] = [
    { id: 'papers', label: 'Papers' },
    { id: 'gaps', label: 'Gaps', count: gaps.length },
    { id: 'compare', label: 'Compare' },
    { id: 'discover', label: 'Discover' },
  ];
  const fmt = (x: number) => x.toLocaleString('en-US');

  return (
    <div className="app" data-pane={mobilePane}>
      <header className="topbar">
        <button className="brand" onClick={() => go({ mode: 'overview' })} aria-label="ResearchGraph: back to overview">
          <svg className="mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2.6" /><circle cx="18" cy="6" r="2.2" /><circle cx="13" cy="17" r="2.8" /><path d="M8.3 8.2 11.4 15M15.8 7.3 13.9 14.4M8.5 6.8 15.8 6.2" /></svg>
          <span className="brand-text">
            <span className="title">ResearchGraph</span>
            <span className="sub">Explore what {ix.papers.length} papers claim, with links to the source quotes</span>
          </span>
        </button>
        <form className="globalsearch" role="search" onSubmit={(e) => { e.preventDefault(); search(query); }}>
          <Icon name="search" size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a topic, e.g. alignment faking" aria-label="Search topics, papers and concepts" />
          <button className="btn primary" type="submit">Search</button>
        </form>
        <div className="stats" title={`Data source: ${sourceLabel ?? 'graph'}`}>
          {ix.papers.length} papers · {fmt(ix.nodes.size)} entities · {gaps.length} gaps
        </div>
      </header>

      {groundingCheck && groundingCheck.issues.length > 0 && (
        <div className={`datanote ${groundingCheck.stale ? 'stale' : ''}`} role="status">
          <Icon name="info" size={14} />
          <span>{groundingCheck.issues.join(' ')}</span>
        </div>
      )}

      <nav className="mobiletabs" aria-label="Sections">
        <button className={mobilePane === 'graph' ? 'on' : ''} onClick={() => setMobilePane('graph')}>Graph</button>
        {tabs.map((t) => (
          <button key={t.id} className={mobilePane === 'side' && sideTab === t.id ? 'on' : ''} onClick={() => { setSideTab(t.id); setMobilePane('side'); }}>{t.label}</button>
        ))}
      </nav>

      <div className={`main ${selection ? 'has-inspector' : ''} ${sideTab === 'compare' ? 'wide-side' : ''}`}>
        <aside className="sidebar" aria-label="Navigation">
          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={sideTab === t.id} className={sideTab === t.id ? 'on' : ''} onClick={() => setSideTab(t.id)}>
                {t.label}{t.count != null && <span className="count">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="sidebody" role="tabpanel">
            {sideTab === 'papers' && (
              <PapersPanel
                ix={ix} view={view} topic={topic} onView={go} onSelectNode={(id) => selectNode({ kind: 'node', id })}
                onClearTopic={() => { setTopic(null); setQuery(''); if (view.mode === 'topic') go({ mode: 'overview' }); }}
              />
            )}
            {sideTab === 'gaps' && <GapsPanel gaps={gaps} verifications={ver} activeGapId={view.mode === 'gap' ? view.gapId : null} onOpen={(id) => go({ mode: 'gap', gapId: id })} />}
            {sideTab === 'compare' && (
              <ComparePanel
                ix={ix} cmp={cmp} verifications={ver}
                a={view.mode === 'compare' ? view.a : null} b={view.mode === 'compare' ? view.b : null}
                onPick={(a, b) => go({ mode: 'compare', a, b })}
                suggestions={compareSuggestions}
                quoteMatch={gx ? (e) => gx.quote(e) : undefined}
                onReveal={startReveal}
                revealActive={revealActive}
                onInspect={(s) => { setSelection(s); setMobilePane('graph'); }}
              />
            )}
            {sideTab === 'discover' && <InsightsPanel insights={insights} verifications={ver} onItem={onInsight} />}
          </div>
        </aside>

        <section className="stage" aria-label="Knowledge graph">
          <div className="stagebar">
            <div className="crumbs">
              {depth > 0 && <IconButton icon="back" label="Back" onClick={() => window.history.back()} />}
              {view.mode !== 'overview' && <IconButton icon="home" label="Overview" onClick={() => go({ mode: 'overview' })} />}
              <span className="crumb" title={crumb}>{crumb}</span>
            </div>
            <div className="tools">
              <div className="filterbox">
                <Icon name="search" size={14} />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find on graph" aria-label="Find a node in the current graph" />
                {filterHits.length > 0 && (
                  <ul className="dropdown">
                    {filterHits.map((n) => (
                      <li key={n.id}>
                        <button onClick={() => { setSelection({ kind: 'node', id: n.id }); setFilter(''); }}>
                          <span className="dot" style={{ background: NODE_STYLE[n.type].color }} />{n.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Popover icon="filter" label="Filters" badge={hiddenTypes.size + (showFindings ? 1 : 0) + (showGaps ? 0 : 1)}>
                <div className="pop-title">Show on graph</div>
                <div className="typegrid">
                  {TYPE_ORDER.filter((t) => t !== 'Finding' && t !== 'Hypothesis' && t !== 'Gap').map((t) => (
                    <label key={t} className="check">
                      <input type="checkbox" checked={!hiddenTypes.has(t)} onChange={() => setHiddenTypes((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; })} />
                      <span className="dot" style={{ background: NODE_STYLE[t].color }} />
                      {NODE_STYLE[t].label}
                      <span className="muted">{visibleCounts.get(t) ?? 0}</span>
                    </label>
                  ))}
                </div>
                <div className="pop-sep" />
                <label className="check"><input type="checkbox" checked={showGaps && !hiddenTypes.has('Gap')} onChange={(e) => { setShowGaps(e.target.checked); setHiddenTypes((s) => { const n = new Set(s); n.delete('Gap'); return n; }); }} /> Research gaps</label>
                <label className="check"><input type="checkbox" checked={showFindings} onChange={(e) => setShowFindings(e.target.checked)} /> Individual findings &amp; hypotheses <span className="muted small">(adds many nodes)</span></label>
                {(hiddenTypes.size > 0 || showFindings || !showGaps) && (
                  <button className="morebtn" onClick={() => { setHiddenTypes(new Set()); setShowFindings(false); setShowGaps(true); }}>Reset filters</button>
                )}
              </Popover>
              <Popover icon="legend" label="Legend">
                <div className="pop-title">Nodes</div>
                <ul className="legendlist">
                  {TYPE_ORDER.map((t) => <li key={t}><span className="dot" style={{ background: NODE_STYLE[t].color }} />{t === 'Gap' ? 'Research gap (outline colour = review verdict)' : NODE_STYLE[t].label}</li>)}
                </ul>
                <div className="pop-title">Links</div>
                <ul className="legendlist lines">
                  <li><i style={{ borderColor: EDGE_COLORS.semantic }} /> Observed claim</li>
                  <li><i className="dashed" style={{ borderColor: EDGE_COLORS.hypothesized }} /> Hypothesized claim</li>
                  <li><i style={{ borderColor: EDGE_COLORS.negated }} /> Negative result (“does not”)</li>
                  <li><i className="dotted" style={{ borderColor: EDGE_COLORS.cites }} /> Cited / mentions another paper</li>
                  <li><i style={{ borderColor: EDGE_COLORS.uses }} /> Paper studies this</li>
                  <li><i className="dashed" style={{ borderColor: EDGE_COLORS.aligned }} /> Related paper (shared concepts)</li>
                  <li><i className="dashed" style={{ borderColor: EDGE_COLORS.gap }} /> Leads to a gap</li>
                  <li><i className="dashed" style={{ borderColor: EDGE_COLORS.resolve }} /> Could help close a gap (suggestion)</li>
                </ul>
                <div className="pop-title">Gap review verdicts (AI-assisted)</div>
                <ul className="legendlist">
                  {Object.entries(VERDICT_COLOR).map(([k, c]) => <li key={k}><span className="ring" style={{ borderColor: c }} />{k.replace(/-/g, ' ')}</li>)}
                </ul>
              </Popover>
            </div>
          </div>

          <div className="graphwrap">
            <GraphView ref={graphRef} vg={vg} selection={selection} onSelect={selectNode} onOpen={openNode} verifications={ver} reveal={revealFrame} />

            {revealActive && revealSeq && rv.index >= 0 && (
              <RevealBar
                seq={revealSeq}
                state={rv}
                onPause={() => playerRef.current?.pause()}
                onResume={() => playerRef.current?.resume()}
                onReplay={() => { setSelection(null); playerRef.current?.replay(); }}
                onSkip={() => playerRef.current?.skip()}
                onClose={() => setRevealPair(null)}
                onEvidence={(s) => { playerRef.current?.pause(); setSelection(s); }}
              />
            )}

            {vg.nodes.length === 0 && (
              <div className="graph-empty">
                {view.mode === 'topic' ? (
                  <div>
                    <p>Nothing in the collection matches “{view.query}”.</p>
                    <p className="muted small">Try a broader term:</p>
                    <div className="row wrap center">{EXAMPLE_QUERIES.slice(0, 3).map((x) => <button key={x} className="chip" onClick={() => search(x)}>{x}</button>)}</div>
                  </div>
                ) : <p>Nothing to show. Check the filters.</p>}
              </div>
            )}

            {onboarding && view.mode === 'overview' && (
              <div className="onboard" role="note">
                <div className="onboard-title">How to explore</div>
                <ol>
                  <li><b>Search</b> a topic above, or pick a paper from the list.</li>
                  <li><b>Click</b> any node or link to read the evidence behind it.</li>
                  <li><b>Double-click</b> a node to focus the graph on it.</li>
                  <li><span className="gapmark" /> Dashed octagons are <b>research gaps</b>.</li>
                </ol>
                <button className="btn sm" onClick={dismissOnboarding}>Got it</button>
              </div>
            )}

            <div className="viewnote">
              {vg.nodes.length} of {fmt(vg.total)} nodes shown{!showFindings && ' · individual findings hidden'}
              <span className="tip" title={vg.note}><Icon name="info" size={13} /></span>
            </div>
            <div className="zoom" role="group" aria-label="Zoom">
              <IconButton icon="plus" label="Zoom in" onClick={() => graphRef.current?.zoomBy(1.25)} />
              <IconButton icon="minus" label="Zoom out" onClick={() => graphRef.current?.zoomBy(0.8)} />
              <IconButton icon="fit" label="Fit to screen" onClick={() => graphRef.current?.fit()} />
            </div>
          </div>
        </section>

        {selection && (
          <aside className="inspector-panel" aria-label="Details and evidence">
            <div className="inspector-head">
              <span className="eyebrow">Details &amp; evidence</span>
              <IconButton icon="close" label="Close details" onClick={() => setSelection(null)} />
            </div>
            <div className="inspector-body">
              <Inspector ix={ix} vg={vg} gaps={gaps} cites={cites} verifications={ver} grounding={gx} reviewMethod={verifications?.method} selection={selection} view={view} onSelect={selectNode} onView={go} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
