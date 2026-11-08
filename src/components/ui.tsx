import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Verdict } from '../analysis/verification';
import { VERDICT_LABEL } from '../analysis/verification';

// Small, dependency-free UI primitives shared across the dashboard.

const PATHS: Record<string, ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="M15 18l-6-6 6-6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  filter: <path d="M4 5h16l-6 8v5l-4 2v-7z" />,
  legend: <><circle cx="6" cy="7" r="2" /><circle cx="6" cy="17" r="2" /><path d="M11 7h9M11 17h9" /></>,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  home: <path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z" />,
  play: <path d="M8 5v14l11-7z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  replay: <><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /></>,
  skip: <path d="M5 5l9 7-9 7zM18 5v14" />,
  reveal: <><circle cx="5" cy="12" r="2.2" /><circle cx="19" cy="12" r="2.2" /><path d="M7.2 12c2-4 7.6-4 9.6 0" /></>,
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function IconButton({ icon, label, onClick, active, className = '' }: { icon: string; label: string; onClick: () => void; active?: boolean; className?: string }) {
  return (
    <button type="button" className={`iconbtn ${active ? 'active' : ''} ${className}`} onClick={onClick} aria-label={label} title={label} aria-pressed={active}>
      <Icon name={icon} />
    </button>
  );
}

/** Observed / hypothesized / cited — the epistemic status of a claim. Always worded, never colour-only. */
export function ClaimBadge({ type }: { type: string | null | undefined }) {
  if (!type) return null;
  const label = type === 'observed' ? 'Observed' : type === 'hypothesized' ? 'Hypothesized' : type === 'cited' ? 'Cited' : type;
  return <span className={`tag claim-${type}`} title={CLAIM_HELP[type] ?? ''}>{label}</span>;
}
const CLAIM_HELP: Record<string, string> = {
  observed: 'Classified by the extraction as a result the paper reports (automatic label; check the quote)',
  hypothesized: 'Classified by the extraction as proposed or speculated, not shown experimentally in the paper',
  cited: 'Classified by the extraction as attributed by the paper to other work',
};

export function VerdictBadge({ verdict }: { verdict: Verdict | undefined }) {
  if (!verdict) return <span className="tag v-unverified">Not reviewed</span>;
  return <span className={`tag v-${verdict}`}>{VERDICT_LABEL[verdict]}</span>;
}

/** Renders the first `initial` items and a "Show N more" toggle. */
export function ShowMore<T>({ items, initial, render, as = 'ul', className = 'plain' }: { items: T[]; initial: number; render: (t: T, i: number) => ReactNode; as?: 'ul' | 'ol' | 'div'; className?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, initial);
  const Tag = as;
  return (
    <>
      <Tag className={className}>{shown.map(render)}</Tag>
      {items.length > initial && (
        <button type="button" className="morebtn" onClick={() => setAll((x) => !x)}>
          {all ? 'Show less' : `Show ${items.length - initial} more`}
        </button>
      )}
    </>
  );
}

/** Button + floating panel. Closes on outside click and Escape. */
export function Popover({ icon, label, children, align = 'right', badge }: { icon: string; label: string; children: ReactNode; align?: 'left' | 'right'; badge?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="popwrap" ref={ref}>
      <button type="button" className={`toolbtn ${open ? 'active' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <Icon name={icon} size={14} /> <span className="toolbtn-label">{label}</span>
        {badge ? <span className="count">{badge}</span> : null}
      </button>
      {open && <div className={`popover ${align}`} role="dialog" aria-label={label}>{children}</div>}
    </div>
  );
}

export function Section({ title, children, hint, defaultOpen = true, count }: { title: string; children: ReactNode; hint?: string; defaultOpen?: boolean; count?: number }) {
  return (
    <details className="section" open={defaultOpen}>
      <summary>
        <Icon name="chevron" size={12} />
        <span>{title}</span>
        {count != null && <span className="count">{count}</span>}
      </summary>
      {hint && <p className="hint">{hint}</p>}
      <div className="section-body">{children}</div>
    </details>
  );
}
