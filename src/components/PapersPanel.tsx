import { useMemo, useState } from 'react';
import type { GraphIndex } from '../data/graphIndex';
import { paperShortLabel } from '../data/graphIndex';
import { missingCorpusRanks } from '../data/paperMeta';
import { searchTopic } from '../analysis/search';
import type { View } from '../analysis/views';
import { NODE_STYLE } from '../theme';

interface Props {
  ix: GraphIndex;
  view: View;
  onView: (v: View) => void;
  onSelectNode: (id: string) => void;
}

const EXAMPLES = ['sandbagging detection', 'alignment faking', 'evaluation awareness', 'chain-of-thought monitoring', 'sleeper agents'];

export default function PapersPanel({ ix, view, onView, onSelectNode }: Props) {
  const [q, setQ] = useState(view.mode === 'topic' ? view.query : '');
  const res = useMemo(() => (view.mode === 'topic' ? searchTopic(ix, view.query) : null), [ix, view]);
  const missing = useMemo(() => missingCorpusRanks(ix.papers), [ix]);
  const activePaper = view.mode === 'paper' ? view.paperId : null;

  return (
    <aside className="panel left">
      <div className="panel-head">
        <h2>Research a topic</h2>
      </div>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) onView({ mode: 'topic', query: q.trim() });
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. sandbagging detection" aria-label="Topic" />
        <button className="btn primary" type="submit">Search</button>
      </form>
      <div className="row wrap examples">
        {EXAMPLES.map((x) => (
          <button key={x} className="chip" onClick={() => { setQ(x); onView({ mode: 'topic', query: x }); }}>{x}</button>
        ))}
      </div>

      {res && (
        <section>
          <div className="section-title">Matching papers <span className="muted">· ranked by evidence</span></div>
          {res.papers.length === 0 && <p className="muted small">No paper matches “{res.query}”. Try a shorter phrase.</p>}
          <ul className="paperlist">
            {res.papers.map((p) => {
              const m = ix.paperById.get(p.paperId)!;
              return (
                <li key={p.paperId} className={activePaper === p.paperId ? 'active' : ''}>
                  <button onClick={() => onView({ mode: 'paper', paperId: p.paperId })}>
                    <span className="pnum">{paperShortLabel(m)}</span>
                    <span className="ptitle">{m.title}</span>
                    <span className="muted small">via {p.via.slice(0, 3).map((v) => (v.label.length > 40 ? v.label.slice(0, 38) + '…' : v.label)).join(' · ')}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="section-title">Matching entities</div>
          <div className="row wrap">
            {res.entities.slice(0, 14).map((h) => (
              <button key={h.node.id} className="chip" style={{ borderColor: NODE_STYLE[h.node.type].color }} title={h.node.type} onClick={() => onSelectNode(h.node.id)}>
                {h.node.label.length > 40 ? h.node.label.slice(0, 38) + '…' : h.node.label}
              </button>
            ))}
          </div>
          <button className="btn ghost" onClick={() => { setQ(''); onView({ mode: 'overview' }); }}>← Back to overview</button>
        </section>
      )}

      <section>
        <div className="section-title">
          Corpus <span className="muted">· {ix.papers.length} papers in graph</span>
        </div>
        {missing.length > 0 && (
          <div className="warnbox small">
            {missing.length} curated paper(s) have no Paper node in this graph: {missing.map((m) => `#${m.rank}`).join(', ')}. Gaps near their topics may be artifacts.
          </div>
        )}
        <ul className="paperlist">
          {ix.papers.map((m) => (
            <li key={m.paperId} className={activePaper === m.paperId ? 'active' : ''}>
              <button onClick={() => onView({ mode: 'paper', paperId: m.paperId })}>
                <span className="pnum">{paperShortLabel(m)}</span>
                <span className="ptitle">{m.title}</span>
                <span className="muted small">{ix.paperEntities.get(m.paperId)?.size ?? 0} entities</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
