import type { AudioFeatures } from "../types";

/**
 * Extracts simple per-frame audio features from an AnalyserNode and performs
 * energy-based beat detection on the bass band.
 */
export class FeatureExtractor {
  private spectrum: Uint8Array<ArrayBuffer>;
  private waveform: Uint8Array<ArrayBuffer>;
  private history: number[] = [];
  private lastBeat = 0;
  private beatIntervals: number[] = [];
  private smooth = { level: 0, bass: 0, mid: 0, high: 0 };
  sensitivity = 1;

  constructor(private analyser: AnalyserNode) {
    analyser.smoothingTimeConstant = 0.6;
    this.spectrum = new Uint8Array(analyser.frequencyBinCount);
    this.waveform = new Uint8Array(analyser.fftSize);
  }

  private band(from: number, to: number) {
    let sum = 0;
    for (let i = from; i < to; i++) sum += this.spectrum[i];
    return sum / ((to - from) * 255);
  }

  extract(now: number): AudioFeatures {
    this.analyser.getByteFrequencyData(this.spectrum);
    this.analyser.getByteTimeDomainData(this.waveform);
    const n = this.spectrum.length;
    const bass = this.band(1, Math.floor(n * 0.03));
    const mid = this.band(Math.floor(n * 0.03), Math.floor(n * 0.25));
    const high = this.band(Math.floor(n * 0.25), Math.floor(n * 0.7));
    const level = bass * 0.5 + mid * 0.35 + high * 0.15;

    const lerp = (a: number, b: number) => a + (b - a) * (b > a ? 0.6 : 0.15);
    this.smooth.level = lerp(this.smooth.level, level);
    this.smooth.bass = lerp(this.smooth.bass, bass);
    this.smooth.mid = lerp(this.smooth.mid, mid);
    this.smooth.high = lerp(this.smooth.high, high);

    // Beat detection: bass energy vs rolling average.
    this.history.push(bass);
    if (this.history.length > 43) this.history.shift();
    const avg = this.history.reduce((a, b) => a + b, 0) / this.history.length;
    const variance = this.history.reduce((a, b) => a + (b - avg) ** 2, 0) / this.history.length;
    const threshold = (-15 * variance + 1.3) / this.sensitivity;
    let beat = false;
    if (bass > avg * threshold && bass > 0.15 && now - this.lastBeat > 250) {
      if (this.lastBeat) {
        this.beatIntervals.push(now - this.lastBeat);
        if (this.beatIntervals.length > 16) this.beatIntervals.shift();
      }
      this.lastBeat = now;
      beat = true;
    }
    const bpm = this.beatIntervals.length >= 4 ? this.estimateBPM() : null;
    const period = bpm ? 60000 / bpm : 500;
    const beatPhase = ((now - this.lastBeat) % period) / period;

    return {
      level: this.smooth.level,
      bass: this.smooth.bass,
      mid: this.smooth.mid,
      high: this.smooth.high,
      beat,
      beatPhase,
      bpm,
      spectrum: this.spectrum,
      waveform: this.waveform,
    };
  }

  private estimateBPM() {
    const sorted = [...this.beatIntervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    let bpm = 60000 / median;
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return Math.round(bpm);
  }
}
