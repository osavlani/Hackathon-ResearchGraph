import type { RevealSequence, RevealStep } from '../analysis/reveal';
import { REVEAL_CAVEAT } from '../analysis/reveal';
import type { PlayerState } from '../analysis/revealPlayer';
import type { Selection } from './GraphView';
import { Icon, IconButton } from './ui';

interface Props {
  seq: RevealSequence;
  state: PlayerState;
  onPause: () => void;
  onResume: () => void;
  onReplay: () => void;
  onSkip: () => void;
  onClose: () => void;
  onEvidence: (s: NonNullable<Selection>) => void;
}

const KIND_TAG: Record<RevealStep['kind'], { text: string; cls: string }> = {
  paper: { text: 'Paper', cls: '' },
  citation: { text: 'Citation · reference-list match', cls: 'rv-cite' },
  shared: { text: 'Graph evidence', cls: 'rv-ev' },
  linked: { text: 'Graph evidence', cls: 'rv-ev' },
  'co-studied': { text: 'Graph evidence', cls: 'rv-ev' },
  empty: { text: 'No supported connection', cls: 'rv-none' },
};

/** Compact caption over the graph: one connection at a time while playing; a static list when finished. */
export default function RevealBar({ seq, state, onPause, onResume, onReplay, onSkip, onClose, onEvidence }: Props) {
  const step = state.index >= 0 ? seq.steps[state.index] : null;
  const connections = seq.steps.filter((s) => s.kind !== 'paper');
  const evidenceButtons = (s: RevealStep) =>
    s.evidence.map((e) => (
      <button key={e.label} className="rv-evbtn" onClick={() => onEvidence(e.selection)}>
        {e.label} <Icon name="chevron" size={11} />
      </button>
    ));

  return (
    <div className="revealbar" role="region" aria-label="Connection reveal" aria-live="polite">
      <div className="rv-head">
        <div className="rv-dots" aria-hidden="true">
          {seq.steps.map((s, i) => (
            <span key={s.key} className={`rv-dot ${state.done || i < state.index ? 'past' : i === state.index ? 'now' : ''} ${s.kind === 'citation' ? 'cite' : ''}`} />
          ))}
        </div>
        <span className="rv-count">{state.done ? `${connections.filter((s) => s.kind !== 'empty').length} connection${connections.length === 1 ? '' : 's'}` : `${state.index + 1} / ${seq.steps.length}`}</span>
        <span className="spacer" />
        {!state.done && (state.playing
          ? <IconButton icon="pause" label="Pause" onClick={onPause} />
          : <IconButton icon="play" label="Resume" onClick={onResume} />)}
        <IconButton icon="replay" label="Replay" onClick={onReplay} />
        {!state.done && <IconButton icon="skip" label="Skip animation" onClick={onSkip} />}
        <IconButton icon="close" label="Close reveal" onClick={onClose} />
      </div>

      {!state.done && step && (
        <div className="rv-step" key={step.key}>
          <span className={`rv-tag ${KIND_TAG[step.kind].cls}`}>{KIND_TAG[step.kind].text}</span>
          <div className="rv-title">{step.title}</div>
          <p className="rv-detail">{step.detail}</p>
          {step.kind !== 'paper' && step.evidence.length > 0 && <div className="rv-evrow">{evidenceButtons(step)}</div>}
        </div>
      )}

      {state.done && (
        <ol className="rv-list">
          {connections.map((s) => (
            <li key={s.key}>
              <span className={`rv-tag ${KIND_TAG[s.kind].cls}`}>{KIND_TAG[s.kind].text}</span>
              <div className="rv-title">{s.title}</div>
              <p className="rv-detail">{s.detail}</p>
              {s.evidence.length > 0 && <div className="rv-evrow">{evidenceButtons(s)}</div>}
            </li>
          ))}
        </ol>
      )}
      <p className="rv-caveat">{REVEAL_CAVEAT}</p>
    </div>
  );
}
