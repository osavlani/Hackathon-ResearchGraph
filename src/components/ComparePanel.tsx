import { useId, useMemo, useState } from 'react';
import type { GraphIndex } from '../data/graphIndex';
import { paperShortLabel } from '../data/graphIndex';
import type { Comparison, Hop, RelPath, SharedItem, UniqueItem } from '../analysis/compare';
import { ROLE_LABEL, quoteStatus } from '../analysis/compare';
import type { GapVerification } from '../analysis/verification';
import type { Citation, QuoteMatch } from '../analysis/grounding';
import { METHOD_LABEL, QUOTE_LABEL } from '../analysis/grounding';
import type { Evidence, GNode } from '../types';
import { NODE_STYLE } from '../theme';
import type { Selection } from './GraphView';
import { ClaimBadge, Icon, Section, ShowMore, VerdictBadge } from './ui';

interface Props {
  ix: GraphIndex;
  a: string | null;
  b: string | null;
  cmp: Comparison | null;
  verifications: Record<string, GapVerification>;
  onPick: (a: string | null, b: string | null) => void;
  onInspect: (s: Selection) => void;
  /** one-click partners when only one paper is chosen (matched citations first, then most related) */
  suggestions?: { paperId: string; reason: string }[];
  /** local PDF quote check (grounding.json); absent when grounding data is missing or stale */
  quoteMatch?: (e: Evidence) => QuoteMatch | null;
  /** start (or replay) the animated connection reveal on the graph */
  onReveal?: () => void;
  revealActive?: boolean;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const usesId = (pid: string, nodeId: string) => `uses:${pid}:${nodeId}`;
// the extraction pipeline's own validation status (used only when no local PDF check is loaded)
const STATUS_LABEL = { validated: 'extractor-validated', approximate: 'extractor: approximate match', unvalidated: 'not validated' } as const;

/** Searchable paper selector (combobox). */
function PaperPicker({ ix, label, value, exclude, onChange }: { ix: GraphIndex; label: string; value: string | null; exclude: string | null; onChange: (pid: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const listId = useId();
  const m = value ? ix.paperById.get(value) : null;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = ix.papers.filter((p) => p.paperId !== exclude && words.every((w) => `${paperShortLabel(p)} ${p.title}`.toLowerCase().includes(w)));
  const pick = (pid: string) => { onChange(pid); setOpen(false); setQ(''); };
  return (
    <div className="picker">
      <span className="picker-label">{label}</span>
      <div className="picker-box">
        <input
          role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-label={`${label}: search papers`}
          value={open ? q : m ? `${paperShortLabel(m)} · ${m.title}` : ''}
          placeholder="Search by title, author or year"
          onFocus={() => { setOpen(true); setQ(''); setHi(0); }}
          onBlur={() => setOpen(false)}
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter' && list[hi]) { e.preventDefault(); pick(list[hi].paperId); (e.target as HTMLInputElement).blur(); }
            else if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
        {open && (
          <ul className="picker-list" role="listbox" id={listId}>
            {list.length === 0 && <li className="muted small picker-empty">No paper matches.</li>}
            {list.map((p, i) => (
              <li key={p.paperId} role="option" aria-selected={i === hi}>
                <button type="button" className={i === hi ? 'hi' : ''} onMouseDown={(e) => { e.preventDefault(); pick(p.paperId); }} onMouseEnter={() => setHi(i)}>
                  <span className="pnum">{paperShortLabel(p)}</span>
                  <span className="ptitle">{p.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function ComparePanel({ ix, a, b, cmp, verifications, onPick, onInspect, suggestions = [], quoteMatch, onReveal, revealActive = false }: Props) {
  const short = (pid: string) => {
    const m = ix.paperById.get(pid);
    return m ? paperShortLabel(m).split(' · ')[0] : pid;
  };
  const node = (id: string) => ix.nodes.get(id)!;
  const openNode = (id: string) => onInspect({ kind: 'node', id });
  const openEdge = (id: string) => onInspect({ kind: 'edge', id });

  const examples = useMemo(() => {
    const has = (pre: string) => ix.papers.find((p) => p.paperId.startsWith(pre))?.paperId;
    return ([['01-', '29-'], ['07-', '33-'], ['23-', '24-']] as const)
      .map(([x, y]) => [has(x), has(y)] as const)
      .filter((p): p is readonly [string, string] => !!p[0] && !!p[1]);
  }, [ix]);

  /** One source quote, attributed to its paper; opens the full evidence in the inspector. */
  const quote = (ev: Evidence, onOpen?: () => void) => {
    const body = (
      <>
        <span className="qtext">“{clip(ev.passage, 200)}”</span>
        <span className="qmeta">
          {short(ev.paperId)}{ev.page != null && ` · p. ${ev.page}`} · {(() => {
            // same provenance as the inspector: the local PDF check when loaded, otherwise the extractor's own status
            const m = quoteMatch?.(ev);
            if (m) return <span className={`qs ${m.status === 'exact' ? 'validated' : m.status === 'fuzzy' ? 'approximate' : 'unvalidated'}`}>{QUOTE_LABEL[m.status].toLowerCase()}</span>;
            return <span className={`qs ${quoteStatus(ev)}`}>{STATUS_LABEL[quoteStatus(ev)]}</span>;
          })()}
        </span>
      </>
    );
    return onOpen ? <button className="quote" onClick={onOpen} title="Open all quotes from this paper in the details panel">{body}</button> : <div className="quote">{body}</div>;
  };

  /** Reference-list excerpt with the matched text highlighted. */
  const excerpt = (c: Citation) => (
    <div className="quote refq">
      <span className="qtext">{c.excerptKind === 'reference-text' ? <>…{c.excerpt.before}<mark>{c.excerpt.match}</mark>{c.excerpt.after}…</> : <code>{c.excerpt.match}</code>}</span>
    </div>
  );
  const citationRow = (from: string, to: string, c: Citation) => (
    <details key={`${from}>${to}`} className="cite">
      <summary>
        <span className="cdir"><b>{short(from)}</b> cites <b>{short(to)}</b></span>
        <span className="muted small">ref. list p. {c.page}</span>
      </summary>
      <div className="citebody">
        {excerpt(c)}
        <div className="qmeta">Automated match, not reviewed by a person: {METHOD_LABEL(c.method)} · reference list on pp. {c.block} of {short(from)}’s PDF (text extracted locally)</div>
      </div>
    </details>
  );
  const citeSummary = () => {
    const ci = cmp!.citation;
    const dirs = [...(ci.aCitesB.length ? [[cmp!.a.paperId, cmp!.b.paperId, ci.aCitesB[0]]] : []), ...(ci.bCitesA.length ? [[cmp!.b.paperId, cmp!.a.paperId, ci.bCitesA[0]]] : [])] as [string, string, Citation][];
    if (dirs.length)
      return <>Citation: {dirs.map(([f, t, c], i) => <span key={i}>{i > 0 && ' and '}<b>{short(f)} cites {short(t)}</b> (matched in {short(f)}’s reference list, p. {c.page})</span>)}.</>;
    if (ci.status === 'not-found') return <>Citation: <b>none found</b> in either reference list (automated search; a match can be missed).</>;
    return (
      <>Direct citation: <b>not established from available data</b>.
        {ci.ambiguous.length > 0 && <> {ci.ambiguous.length} unconfirmed reference match{ci.ambiguous.length === 1 ? '' : 'es'} (see Citation).</>}
        {ci.mentions.length > 0 && <> An extracted passage names the other paper’s author and year ({ci.mentions.length}×){ci.mentions.some((m) => m.ambiguous) && ', but that author and year match several papers'}.</>}</>
    );
  };
  const dot = (n: GNode) => <span className="dot" style={{ background: NODE_STYLE[n.type].color }} title={n.type} />;

  const sharedRow = (s: SharedItem) => (
    <li key={s.node.id}>
      <details className="row-details">
        <summary>
          {dot(s.node)}
          <span className="rlabel">{s.node.label}</span>
          <span className="rmeta">{s.node.paperCount > 2 ? `in ${s.node.paperCount} papers` : 'only these two'}</span>
        </summary>
        <div className="pairq">
          <div><div className="qhead">{short(s.a.paperId)} · {ROLE_LABEL[s.a.role]}</div>{quote(s.a.evidence[0], () => openEdge(usesId(s.a.paperId, s.node.id)))}</div>
          <div><div className="qhead">{short(s.b.paperId)} · {ROLE_LABEL[s.b.role]}</div>{quote(s.b.evidence[0], () => openEdge(usesId(s.b.paperId, s.node.id)))}</div>
          <button className="morebtn" onClick={() => openNode(s.node.id)}>All claims about “{clip(s.node.label, 40)}” →</button>
        </div>
      </details>
    </li>
  );

  const uniqueList = (items: UniqueItem[], pid: string) =>
    items.length === 0 ? <p className="muted small">None in the graph.</p> : (
      <ShowMore items={items} initial={5} className="plain uniq" render={(u) => (
        <li key={u.node.id}>
          <button className="link" onClick={() => openEdge(usesId(pid, u.node.id))}>{dot(u.node)} {u.node.label}</button>
          <span className="muted small"> · {ROLE_LABEL[u.use.role]}</span>
        </li>
      )} />
    );

  const hopChip = (h: Hop, i: number) => {
    if (h.kind === 'mention') return null;
    if (h.kind === 'edge')
      return <button key={i} className={`hop rel ${h.edge.negated ? 'neg' : ''}`} onClick={() => openEdge(h.edge.id)} title="Open the claim and its quotes">{h.edge.label}<ClaimBadge type={h.edge.claimType} /></button>;
    return <button key={i} className="hop via" onClick={() => openNode(h.finding.id)} title={h.finding.label}>via a {h.finding.type === 'Finding' ? 'finding' : 'hypothesis'} in {short(h.paperId)}</button>;
  };
  const pathRow = (p: RelPath, rank: number) => {
    const ents = p.nodes.slice(1, -1).filter((id) => !['Finding', 'Hypothesis'].includes(node(id).type));
    const middle = p.hops.filter((h) => h.kind !== 'mention');
    return (
      <li className="path" key={p.nodes.join('>')}>
        <div className="chain">
          <span className="pend">{short(cmp!.a.paperId)}</span>
          <Icon name="chevron" size={11} />
          <button className="hop ent" onClick={() => openEdge(usesId(cmp!.a.paperId, ents[0]))}>{clip(node(ents[0]).label, 38)}</button>
          {middle.map((h, i) => <span key={i} className="row">{hopChip(h, i)}</span>)}
          {ents[1] && <button className="hop ent" onClick={() => openEdge(usesId(cmp!.b.paperId, ents[1]))}>{clip(node(ents[1]).label, 38)}</button>}
          <Icon name="chevron" size={11} />
          <span className="pend">{short(cmp!.b.paperId)}</span>
        </div>
        <div className="ptext">{rank === 0 && <span className="tag">Strongest</span>} {p.text}</div>
      </li>
    );
  };

  return (
    <div className="tabpanel compare">
      <p className="intro">Pick two papers to see why they are connected, what they share, how they differ, and where to check each point.</p>
      <div className="pickers">
        <PaperPicker ix={ix} label="Paper A" value={a} exclude={b} onChange={(pid) => onPick(pid, b)} />
        <button className="iconbtn swap" aria-label="Swap papers" title="Swap papers" onClick={() => onPick(b, a)} disabled={!a && !b}>⇅</button>
        <PaperPicker ix={ix} label="Paper B" value={b} exclude={a} onChange={(pid) => onPick(a, pid)} />
      </div>

      {!cmp && (a || b) && suggestions.length > 0 && (
        <div className="empty">
          <p className="muted small">Compare {short((a ?? b)!)} with:</p>
          <ul className="plain suggest">
            {suggestions.map((s) => (
              <li key={s.paperId}>
                <button className="chip" onClick={() => (a ? onPick(a, s.paperId) : onPick(s.paperId, b))}>{short(s.paperId)}</button>
                <span className="muted small"> {s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!cmp && !a && !b && (
        <div className="empty">
          <p className="muted small">Or try an example:</p>
          <div className="row wrap">
            {examples.map(([x, y]) => <button key={x + y} className="chip" onClick={() => onPick(x, y)}>{short(x)} × {short(y)}</button>)}
          </div>
        </div>
      )}

      {cmp && (() => {
        const nSpecific = cmp.concepts.specific.length;
        const nMeth = cmp.methods.methodology.length + cmp.methods.terminology.length;
        const opp = cmp.findings.sameRelations.filter((s) => s.relation === 'opposite-direction').length;
        const top = cmp.paths[0];
        return (
          <>
            {onReveal && (
              <button className="btn primary reveal-cta" onClick={onReveal}>
                <Icon name="reveal" size={16} /> {revealActive ? 'Replay connection reveal' : 'Reveal connections'}
              </button>
            )}
            <div className="summary" aria-label="Comparison summary">
              <p>
                {nSpecific + nMeth > 0 ? (
                  <>They share <b>{nSpecific} specific concept{nSpecific === 1 ? '' : 's'}</b> and <b>{nMeth} method{nMeth === 1 ? '' : 's'} or model{nMeth === 1 ? '' : 's'}</b>
                    {cmp.methods.methodology.length > 0 && <>, {cmp.methods.methodology.length} of which appear{cmp.methods.methodology.length === 1 ? 's' : ''} in both papers’ reported results</>}.</>
                ) : <>No specific concept, method or model appears in both papers in the graph.</>}
              </p>
              <p>{top ? <>Strongest link: {top.text}</> : <>No evidence-backed connection within two steps.</>}</p>
              <p>{citeSummary()}</p>
              {cmp.citation.status === 'established' && nSpecific + nMeth === 0 && (
                <p className="warntext small">A citation was matched, but the graph links these papers through no specific concept, method or model. This points to incomplete extraction in the graph, not to the papers being scientifically unrelated.</p>
              )}
              {cmp.findings.sameRelations.length > 0 && (
                <p>{cmp.findings.sameRelations.length} claim{cmp.findings.sameRelations.length === 1 ? '' : 's'} describe the same relationship{opp > 0 && <>, {opp} in opposite directions (compare their contexts)</>}.</p>
              )}
              <p className="muted small">Select any item to read the source quotes and page numbers. Missing from the graph does not mean missing from the paper.</p>
            </div>

            <Section title="Citation" count={cmp.citation.aCitesB.length + cmp.citation.bCitesA.length || undefined} defaultOpen={cmp.citation.status === 'established'}>
              {([[cmp.a.paperId, cmp.b.paperId, cmp.citation.aCitesB], [cmp.b.paperId, cmp.a.paperId, cmp.citation.bCitesA]] as const).map(([from, to, list]) =>
                list.map((c) => citationRow(from, to, c)),
              )}
              <p className="small">
                {cmp.citation.status === 'established' ? <>Citations are matched automatically in reference lists and have not been reviewed by a person. A citation shows the papers are connected; it does not show that they agree.</>
                  : cmp.citation.status === 'not-found' ? <><b>No citation found.</b> {cmp.citation.reason}</>
                  : <><b>Direct citation: not established from available data.</b> {cmp.citation.reason}</>}
              </p>
              {cmp.citation.ambiguous.length > 0 && (
                <details className="subtle">
                  <summary>{cmp.citation.ambiguous.length} unconfirmed reference match{cmp.citation.ambiguous.length === 1 ? '' : 'es'} (not counted)</summary>
                  <ul className="plain">
                    {cmp.citation.ambiguous.map((c, i) => (
                      <li key={i}>
                        <div className="muted small">{short(c.source)}’s reference list, p. {c.page}: {c.method}</div>
                        {excerpt(c)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {cmp.citation.mentions.length > 0 && (
                <details className="subtle">
                  <summary>{cmp.citation.mentions.length} author–year mention{cmp.citation.mentions.length === 1 ? '' : 's'} in extracted passages (text match only)</summary>
                  <ul className="plain">
                    {cmp.citation.mentions.map((m, i) => (
                      <li key={i}>
                        <div className="muted small">{short(m.from)} names {short(m.to)}’s author and year{m.ambiguous && ' (ambiguous: same author and year as another paper in the collection)'}</div>
                        {quote(m.evidence)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Section>

            <Section title="How they connect" count={cmp.paths.length} hint="Connections through shared topics, a claim linking a topic of each paper, or another paper’s finding involving both. Ranked by evidence quality and how specific the topics are; generic terms are excluded.">
              {cmp.paths.length === 0 ? <p className="muted small">No connection found in the graph within two steps.</p> : (
                <ShowMore items={cmp.paths} initial={4} className="plain paths" render={pathRow} />
              )}
            </Section>

            <Section title="Shared concepts" count={cmp.concepts.specific.length} hint="Behaviors, concepts and mechanisms extracted from both papers. Open a row to compare the quotes.">
              {cmp.concepts.specific.length === 0 ? <p className="muted small">None in the graph.</p> : <ShowMore items={cmp.concepts.specific} initial={6} className="plain rows" render={sharedRow} />}
              {cmp.concepts.generic.length > 0 && <p className="muted small">Also both use generic terms ({cmp.concepts.generic.map((s) => s.node.label).join(', ')}), which are not counted as a connection.</p>}
            </Section>

            <Section title="Methods & models" count={nMeth} defaultOpen={false}>
              <div className="subhead">Shared methodology <span className="muted">appears in both papers’ reported results</span></div>
              {cmp.methods.methodology.length === 0 ? <p className="muted small">None.</p> : <ul className="plain rows">{cmp.methods.methodology.map(sharedRow)}</ul>}
              <div className="subhead">Shared terms only <span className="muted">named by both, but not in both papers’ results</span></div>
              {cmp.methods.terminology.length === 0 ? <p className="muted small">None.</p> : <ul className="plain rows">{cmp.methods.terminology.map(sharedRow)}</ul>}
              {cmp.methods.generic.length > 0 && <p className="muted small">Generic terms not counted: {cmp.methods.generic.map((s) => s.node.label).join(', ')}.</p>}
            </Section>

            <Section title="Findings" count={cmp.findings.a.length + cmp.findings.b.length} defaultOpen={false} hint="Findings are listed per paper. Overlapping topics do not mean the papers agree or disagree.">
              {cmp.findings.sameRelations.length > 0 && (
                <>
                  <div className="subhead">Same relationship described by both</div>
                  <ul className="plain">
                    {cmp.findings.sameRelations.map((s, i) => (
                      <li key={i} className="samerel">
                        <div className="small"><b>{node(s.a.source).label} → {node(s.a.target).label}</b> · <span className={s.relation === 'opposite-direction' ? 'warntext' : 'muted'}>{s.relation === 'same-direction' ? 'same direction' : s.relation === 'opposite-direction' ? 'opposite directions; compare contexts' : 'different relationships'}</span></div>
                        <button className="link small" onClick={() => openEdge(s.a.id)}>{short(cmp.a.paperId)}: {s.a.label}</button> <ClaimBadge type={s.a.claimType} />
                        {s.a.contexts && <span className="muted small"> · {clip(s.a.contexts, 80)}</span>}<br />
                        <button className="link small" onClick={() => openEdge(s.b.id)}>{short(cmp.b.paperId)}: {s.b.label}</button> <ClaimBadge type={s.b.claimType} />
                        {s.b.contexts && <span className="muted small"> · {clip(s.b.contexts, 80)}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="subhead">Findings about the same topic</div>
              {cmp.findings.related.length === 0 ? <p className="muted small">No pair of findings involves the same specific topic.</p> : (
                <ShowMore items={cmp.findings.related} initial={3} className="plain" render={(r, i) => (
                  <li key={i} className="fpair">
                    <div className="muted small">Both involve {r.via.map((v) => `“${v.label}”`).join(', ')}</div>
                    <button className="link fp" onClick={() => openNode(r.a.id)}><b>{short(cmp.a.paperId)}</b> {clip(r.a.label, 150)}</button>
                    <button className="link fp" onClick={() => openNode(r.b.id)}><b>{short(cmp.b.paperId)}</b> {clip(r.b.label, 150)}</button>
                  </li>
                )} />
              )}
              <div className="sidebyside">
                {([[cmp.a.paperId, cmp.findings.a], [cmp.b.paperId, cmp.findings.b]] as const).map(([pid, fs]) => (
                  <div key={pid}>
                    <div className="subhead">{short(pid)} <span className="muted">{fs.filter((f) => f.type === 'Finding').length} findings · {fs.filter((f) => f.type === 'Hypothesis').length} hypotheses</span></div>
                    <ShowMore items={fs} initial={4} className="plain flist" render={(f) => (
                      <li key={f.id}><button className="link" onClick={() => openNode(f.id)}>{clip(f.label, 110)}</button> {f.type === 'Hypothesis' && <span className="tag claim-hypothesized">Hypothesis</span>}</li>
                    )} />
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Differences" defaultOpen={false} hint="Extracted from one paper but not the other. Absence from the graph does not prove the other paper never covers it.">
              {([[cmp.a.paperId, cmp.differences.methodsA, cmp.differences.conceptsA], [cmp.b.paperId, cmp.differences.methodsB, cmp.differences.conceptsB]] as const).map(([pid, ms, cs]) => (
                <div key={pid} className="diffblock">
                  <div className="subhead">Only in {short(pid)}</div>
                  <div className="muted small">Methods, models & conditions ({ms.length})</div>
                  {uniqueList(ms, pid)}
                  <div className="muted small">Concepts & behaviors ({cs.length})</div>
                  {uniqueList(cs, pid)}
                </div>
              ))}
            </Section>

            <Section title="Gaps & coverage" defaultOpen={false}>
              <div className="subhead">Research gaps involving both papers <span className="muted">from the gap engine</span></div>
              {cmp.gaps.engine.length === 0 ? <p className="muted small">None.</p> : (
                <ul className="plain">{cmp.gaps.engine.map((g) => <li key={g.id}><button className="link" onClick={() => openNode(g.id)}>{g.title}</button> <VerdictBadge verdict={verifications[g.id]?.verdict} /></li>)}</ul>
              )}
              <div className="subhead">Never linked in the graph <span className="muted">method from one paper × behavior from the other</span></div>
              <p className="hint">No edge or shared finding anywhere in the collection connects these. That may be an untested combination, or a link the extraction missed. Check before treating it as a research gap.</p>
              {cmp.gaps.combinations.length === 0 ? <p className="muted small">None found.</p> : (
                <ul className="plain">{cmp.gaps.combinations.map((k, i) => (
                  <li key={i} className="small">
                    <button className="link" onClick={() => openEdge(usesId(k.leftPaper, k.left.id))}>{k.left.label}</button> <span className="muted">({short(k.leftPaper)})</span> × <button className="link" onClick={() => openEdge(usesId(k.rightPaper, k.right.id))}>{k.right.label}</button> <span className="muted">({short(k.rightPaper)})</span>
                  </li>
                ))}</ul>
              )}
              <div className="subhead">Graph coverage notes <span className="muted">about the data, not the science</span></div>
              <ul className="plain small">{cmp.gaps.coverage.map((n, i) => <li key={i} className="muted">{n.text}{n.nodes && <> <button className="link" onClick={() => openNode(n.nodes![0])}>view</button></>}</li>)}</ul>
            </Section>

          </>
        );
      })()}
    </div>
  );
}
