import type { Sampler } from "./sampler";

export const SEQ_STEPS = 16;
export const SEQ_LANES = 8;

/** 0 = off, 1 = normal hit, 2 = accent. */
export type Step = 0 | 1 | 2;
export interface Pattern {
  /** Pad index per lane (absolute pad number), null = empty lane. */
  lanes: (number | null)[];
  steps: Step[][]; // [lane][step]
}

export const emptyPattern = (lanes: (number | null)[] = Array(SEQ_LANES).fill(null)): Pattern => ({
  lanes: [...lanes],
  steps: Array.from({ length: SEQ_LANES }, () => Array(SEQ_STEPS).fill(0) as Step[]),
});

/**
 * 16-step drum sequencer driving the sampler. Look-ahead scheduling (Web Audio clock) so timing is sample-accurate;
 * `tempo()` is polled every step so it follows the playing deck, and `anchor` lets the grid lock to the deck's bars.
 */
export class Sequencer {
  pattern: Pattern = emptyPattern();
  swing = 0; // 0..0.6 of a 16th
  gainAccent = 1;
  gainNormal = 0.7;
  playing = false;
  /** Called on every step (for the UI playhead), with the AudioContext time the step sounds. */
  onStep?: (step: number, at: number) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStep = 0;
  private nextTime = 0;
  private rafStep = -1;

  constructor(private ctx: AudioContext, private sampler: Sampler, private tempo: () => number) {}

  /** Start at AudioContext time `at` (align to a bar) from step 0. */
  start(at = this.ctx.currentTime + 0.05) {
    if (this.playing) return;
    this.playing = true;
    this.nextStep = 0;
    this.nextTime = Math.max(at, this.ctx.currentTime + 0.02);
    this.timer = setInterval(() => this.tick(), 40);
    this.tick();
  }

  stop() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.rafStep = -1;
  }

  private tick() {
    const ahead = this.ctx.currentTime + 0.18;
    while (this.playing && this.nextTime < ahead) {
      const step = this.nextStep;
      const sixteenth = 60 / Math.max(40, this.tempo()) / 4;
      const swung = step % 2 === 1 ? this.swing * sixteenth : 0;
      const when = this.nextTime + swung;
      for (let lane = 0; lane < SEQ_LANES; lane++) {
        const v = this.pattern.steps[lane][step];
        const pad = this.pattern.lanes[lane];
        if (!v || pad == null) continue;
        this.sampler.press(pad, when, v === 2 ? this.gainAccent : this.gainNormal);
      }
      const delay = Math.max(0, (when - this.ctx.currentTime) * 1000);
      setTimeout(() => this.playing && this.onStep?.(step, when), delay);
      this.nextStep = (step + 1) % SEQ_STEPS;
      this.nextTime += sixteenth;
    }
  }
}
