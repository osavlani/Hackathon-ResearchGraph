import { useMemo } from 'react';
import type { GraphIndex } from '../data/graphIndex';
import { paperShortLabel } from '../data/graphIndex';
import { missingCorpusRanks } from '../data/paperMeta';
import { searchTopic } from '../analysis/search';
import type { View } from '../analysis/views';
import { NODE_STYLE } from '../theme';
import { EXAMPLE_QUERIES } from './copy';
import { Section } from './ui';

interface Props {
  ix: GraphIndex;
  view: View;
  /** pinned search topic (null = no active search) */
  topic: string | null;
  onClearTopic: () => void;
  onView: (v: View) => void;
  onSelectNode: (id: string) => void;
}

const clip = (s: string, n = 42) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export default function PapersPanel({ ix, view, topic, onClearTopic, onView, onSelectNode }: Props) {
  const res = useMemo(() => (topic ? searchTopic(ix, topic) : null), [ix, topic]);
  const missing = useMemo(() => missingCorpusRanks(ix.papers), [ix]);
  const activePaper = view.mode === 'paper' ? view.paperId : null;

  const paperList = (
    <ul className="paperlist">
      {ix.papers.map((m) => (
        <li key={m.paperId}>
          <button className={activePaper === m.paperId ? 'active' : ''} onClick={() => onView({ mode: 'paper', paperId: m.paperId })} aria-current={activePaper === m.paperId}>
            <span className="pnum">{paperShortLabel(m)}</span>
            <span className="ptitle">{m.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="tabpanel">
      {res ? (
        <>
          <div className="results-head">
            <div>
              <div className="eyebrow">Results for</div>
              <div className="results-q">“{res.query}”</div>
            </div>
            <div className="row">
              {view.mode !== 'topic' && <button className="btn ghost sm" onClick={() => onView({ mode: 'topic', query: res.query })}>Show in graph</button>}
              <button className="btn ghost sm" onClick={onClearTopic}>Clear</button>
            </div>
          </div>
          {res.papers.length === 0 && res.entities.length === 0 ? (
            <div className="empty">
              <p>No paper or concept matches this search.</p>
              <p className="muted small">Try a shorter or broader term:</p>
              <div className="row wrap">
                {EXAMPLE_QUERIES.slice(0, 3).map((x) => <button key={x} className="chip" onClick={() => onView({ mode: 'topic', query: x })}>{x}</button>)}
              </div>
            </div>
          ) : (
            <>
              <Section title="Papers" count={res.papers.length} hint="Ranked by how much matching evidence each paper contains.">
                <ul className="paperlist">
                  {res.papers.map((p) => {
                    const m = ix.paperById.get(p.paperId)!;
                    return (
                      <li key={p.paperId}>
                        <button className={activePaper === p.paperId ? 'active' : ''} onClick={() => onView({ mode: 'paper', paperId: p.paperId })}>
                          <span className="pnum">{paperShortLabel(m)}</span>
                          <span className="ptitle">{m.title}</span>
                          {p.via.length > 0 && <span className="pvia">Mentions {p.via.slice(0, 2).map((v) => clip(v.label, 32)).join(', ')}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Section>
              {res.entities.length > 0 && (
                <Section title="Concepts, methods & models" count={Math.min(14, res.entities.length)}>
                  <div className="row wrap">
                    {res.entities.slice(0, 14).map((h) => (
                      <button key={h.node.id} className="chip" title={`${h.node.type}: ${h.node.label}`} onClick={() => onSelectNode(h.node.id)}>
                        <span className="dot" style={{ background: NODE_STYLE[h.node.type].color }} />
                        {clip(h.node.label)}
                      </button>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
          <Section title="All papers" count={ix.papers.length} defaultOpen={false}>{paperList}</Section>
        </>
      ) : (
        <>
          <div className="tryrow">
            <span className="eyebrow">Try a topic</span>
            <div className="row wrap">
              {EXAMPLE_QUERIES.map((x) => <button key={x} className="chip" onClick={() => onView({ mode: 'topic', query: x })}>{x}</button>)}
            </div>
          </div>
          <button className="btn sm compare-cta" onClick={() => onView({ mode: 'compare', a: null, b: null })}>Compare two papers →</button>
          <Section title="Papers in this collection" count={ix.papers.length}>
            {missing.length > 0 && (
              <details className="notice">
                <summary>{missing.length} planned papers aren’t in the graph yet</summary>
                <p className="small">Papers #{missing.map((m) => m.rank).join(', #')} have no extracted data, so gaps close to their topics may be artifacts.</p>
                <ul className="plain small muted">{missing.map((m) => <li key={m.rank}>#{m.rank} · {m.title}</li>)}</ul>
              </details>
            )}
            {paperList}
          </Section>
        </>
      )}
    </div>
  );
}
