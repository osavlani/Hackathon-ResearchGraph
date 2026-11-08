/**
 * Timing controller for the connection reveal. No React, no DOM: it only advances a step index on a
 * fixed schedule and reports state changes, so pause / resume / replay / skip / cancellation are
 * deterministic and unit-testable with a fake scheduler.
 */

export interface Scheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface PlayerState {
  /** index of the step currently highlighted; -1 before start */
  index: number;
  playing: boolean;
  /** all steps shown (end reached, skipped, or reduced motion) */
  done: boolean;
}

export const IDLE: PlayerState = { index: -1, playing: false, done: false };

export class RevealPlayer {
  private state: PlayerState = IDLE;
  private timer: unknown = null;
  private disposed = false;
  private readonly durations: number[];
  private readonly onChange: (s: PlayerState) => void;
  private readonly reducedMotion: boolean;
  private readonly sched: Scheduler;

  /**
   * @param durations how long each step stays current, in ms (same length as the step list)
   * @param reducedMotion when true, start() shows the final, fully revealed state immediately
   */
  constructor(durations: number[], onChange: (s: PlayerState) => void, reducedMotion = false, sched: Scheduler = realScheduler) {
    this.durations = durations;
    this.onChange = onChange;
    this.reducedMotion = reducedMotion;
    this.sched = sched;
  }

  get current(): PlayerState {
    return this.state;
  }

  start(): void {
    this.clearTimer();
    if (this.reducedMotion || this.durations.length === 0) return this.skip();
    this.emit({ index: 0, playing: true, done: false });
    this.schedule();
  }

  /** Same as start: replays the identical sequence from the beginning. */
  replay(): void {
    this.start();
  }

  pause(): void {
    if (!this.state.playing) return;
    this.clearTimer();
    this.emit({ ...this.state, playing: false });
  }

  resume(): void {
    if (this.state.playing || this.state.done || this.state.index < 0) return;
    this.emit({ ...this.state, playing: true });
    this.schedule();
  }

  /** Jump to the end: every step revealed, nothing animating. */
  skip(): void {
    this.clearTimer();
    this.emit({ index: this.durations.length - 1, playing: false, done: true });
  }

  /** Cancel: stop timers and stop reporting. Safe to call more than once. */
  dispose(): void {
    this.clearTimer();
    this.disposed = true;
  }

  private schedule(): void {
    const ms = this.durations[this.state.index] ?? 0;
    this.timer = this.sched.set(() => {
      this.timer = null;
      if (this.disposed || !this.state.playing) return;
      const next = this.state.index + 1;
      if (next >= this.durations.length) this.emit({ index: this.state.index, playing: false, done: true });
      else {
        this.emit({ index: next, playing: true, done: false });
        this.schedule();
      }
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer != null) this.sched.clear(this.timer);
    this.timer = null;
  }

  private emit(s: PlayerState): void {
    if (this.disposed) return;
    this.state = s;
    this.onChange(s);
  }
}

/** Fixed, predictable timing for a live demo: papers appear quickly, each connection gets time to be read. */
export function stepDurations(kinds: string[]): number[] {
  return kinds.map((k) => (k === 'paper' ? 900 : k === 'empty' ? 2400 : 2800));
}
