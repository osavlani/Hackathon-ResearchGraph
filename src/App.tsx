import { useEffect, useState } from 'react';
import ResearchGraphDashboard from './ResearchGraphDashboard';
import { DATA_SOURCES, fetchGapVerifications, fetchGraph } from './data/api';
import type { RawGraph } from './types';
import type { GapVerificationFile } from './analysis/verification';

type State =
  | { status: 'loading' }
  | { status: 'error'; error: string; source: string }
  | { status: 'ready'; graph: RawGraph; source: string; ver: GapVerificationFile | null };

export default function App() {
  const [s, setS] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchGraph(), fetchGapVerifications()]).then(([g, v]) => {
      if (!alive) return;
      if (!g.ok) setS({ status: 'error', error: g.error, source: g.source });
      else setS({ status: 'ready', graph: g.data, source: g.source, ver: v.ok ? v.data : null });
    });
    return () => { alive = false; };
  }, [attempt]);

  if (s.status === 'loading')
    return <div className="state"><h2>Loading knowledge graph…</h2><p className="muted">GET {DATA_SOURCES.GRAPH_URL}</p></div>;
  if (s.status === 'error')
    return (
      <div className="state">
        <h2>Can’t reach the graph.</h2>
        <p className="muted"><code>GET {s.source}</code> failed: {s.error}</p>
        <p className="muted small">Set VITE_API_BASE or VITE_GRAPH_URL in .env.local, or put the exported graph at public/graph.json.</p>
        <button className="btn primary" onClick={() => { setS({ status: 'loading' }); setAttempt((a) => a + 1); }}>Retry connection</button>
      </div>
    );
  return <ResearchGraphDashboard graph={s.graph} verifications={s.ver} sourceLabel={s.source} />;
}
