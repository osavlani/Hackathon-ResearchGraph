import type { Insights, InsightItem } from '../analysis/insights';
import type { GapVerification } from '../analysis/verification';
import { VERDICT_LABEL } from '../analysis/verification';

interface Props {
  insights: Insights;
  verifications: Record<string, GapVerification>;
  verifiedCount: number;
  gapCount: number;
  onItem: (t: InsightItem['target']) => void;
}

const COLS: { key: keyof Insights; title: string; dot: string; empty: string }[] = [
  { key: 'themes', title: 'Common research themes', dot: '#5b8cff', empty: 'No entity is shared by 3+ papers.' },
  { key: 'methods', title: 'Similar methodologies', dot: '#22d3ee', empty: 'No method is shared by 2+ papers.' },
  { key: 'conflicts', title: 'Potentially conflicting findings', dot: '#f43f5e', empty: 'No conflicting claim pairs detected.' },
  { key: 'underexplored', title: 'Underexplored areas', dot: '#f59e0b', empty: 'No gaps detected.' },
  { key: 'directions', title: 'Suggested directions (from corpus)', dot: '#34d399', empty: 'No corpus-based resolution found.' },
];

export default function InsightsPanel({ insights, verifications, verifiedCount, gapCount, onItem }: Props) {
  return (
    <section className="panel insights">
      <div className="panel-head">
        <h2>Research discovery</h2>
        <span className="pill">COMPUTED FROM GRAPH</span>
        <span className="muted small">
          Every item is a hypothesis to check, not a finding. {verifiedCount}/{gapCount} gaps have a reviewer verdict.
        </span>
      </div>
      <div className="cols">
        {COLS.map((c) => (
          <div key={c.key} className="col">
            <div className="col-title"><span className="dot" style={{ background: c.dot }} />{c.title}</div>
            {insights[c.key].length === 0 && <p className="muted small">{c.empty}</p>}
            {insights[c.key].map((it, i) => {
              const v = it.target.kind === 'gap' ? verifications[it.target.id] : undefined;
              return (
                <button key={i} className="card" onClick={() => onItem(it.target)}>
                  <span>{it.text}</span>
                  <span className="refs">{it.refs}</span>
                  {v && <span className={`badge v-${v.verdict}`}>{VERDICT_LABEL[v.verdict]}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
