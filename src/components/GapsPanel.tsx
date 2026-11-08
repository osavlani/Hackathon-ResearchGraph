import { useMemo, useState } from 'react';
import type { Gap, GapKind } from '../analysis/gaps';
import { GAP_KIND_LABEL } from '../analysis/gaps';
import type { GapVerification, Verdict } from '../analysis/verification';
import { VERDICT_LABEL } from '../analysis/verification';
import { VerdictBadge } from './ui';

interface Props {
  gaps: Gap[];
  verifications: Record<string, GapVerification>;
  activeGapId: string | null;
  onOpen: (gapId: string) => void;
}

type VerdictFilter = Verdict | 'all' | 'unverified';
const VERDICT_ORDER: Verdict[] = ['confirmed', 'partly-addressed', 'closed-in-corpus', 'extraction-artifact', 'not-supported'];

/** All engine gaps as a filterable list. Full details (rule, review note, corpus fixes) live in the inspector. */
export default function GapsPanel({ gaps, verifications, activeGapId, onOpen }: Props) {
  const [kind, setKind] = useState<GapKind | 'all'>('all');
  const [verdict, setVerdict] = useState<VerdictFilter>('all');

  const counts = useMemo(() => {
    const c = new Map<VerdictFilter, number>();
    for (const g of gaps) {
      const v: VerdictFilter = verifications[g.id]?.verdict ?? 'unverified';
      c.set(v, (c.get(v) ?? 0) + 1);
    }
    return c;
  }, [gaps, verifications]);

  const rows = gaps.filter(
    (g) =>
      (kind === 'all' || g.kind === kind) &&
      (verdict === 'all' || (verdict === 'unverified' ? !verifications[g.id] : verifications[g.id]?.verdict === verdict)),
  );

  const chips: VerdictFilter[] = ['all', ...VERDICT_ORDER.filter((v) => counts.has(v)), ...(counts.has('unverified') ? ['unverified' as const] : [])];

  return (
    <div className="tabpanel">
      <p className="intro">
        Possible open questions found automatically from the graph’s structure, such as a behavior that no extracted claim says can be detected.
        A gap in the graph can be a real research gap or a link the extraction missed. Treat each as a lead to check; verdicts are AI-assisted reviews, not peer review.
      </p>
      <div className="filters" role="group" aria-label="Filter by review verdict">
        {chips.map((v) => (
          <button key={v} className={`chip ${verdict === v ? 'on' : ''}`} aria-pressed={verdict === v} onClick={() => setVerdict(v)}>
            {v === 'all' ? 'All' : v === 'unverified' ? 'Not reviewed' : VERDICT_LABEL[v]}
            <span className="count">{v === 'all' ? gaps.length : counts.get(v) ?? 0}</span>
          </button>
        ))}
      </div>
      <label className="selectrow">
        <span className="muted small">Type</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as GapKind | 'all')}>
          <option value="all">All types</option>
          {Object.entries(GAP_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      {rows.length === 0 && <p className="muted small empty">No gaps match these filters.</p>}
      <ul className="gaplist">
        {rows.map((g) => (
          <li key={g.id}>
            <button className={activeGapId === g.id ? 'active' : ''} onClick={() => onOpen(g.id)} aria-current={activeGapId === g.id}>
              <span className="gtitle">{g.title}</span>
              <span className="gmeta">
                <span className="muted">{GAP_KIND_LABEL[g.kind]}</span>
                <VerdictBadge verdict={verifications[g.id]?.verdict} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
