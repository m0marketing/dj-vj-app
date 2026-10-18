/**
 * Simple offline BPM detection:
 * lowpass the signal -> collect peaks -> histogram of peak intervals -> fold into 80–180 BPM.
 * The beat offset (position of the first beat) is the phase that best aligns the grid with the peaks.
 */
export interface BpmResult {
  bpm: number;
  /** Seconds from the start of the file to the first beat on the grid. */
  beatOffset: number;
}

export async function detectBPM(buffer: AudioBuffer): Promise<BpmResult | null> {
  const maxSeconds = 90;
  const length = Math.min(buffer.length, buffer.sampleRate * maxSeconds);
  const offline = new OfflineAudioContext(1, length, buffer.sampleRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  const lp = offline.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 150;
  lp.Q.value = 1;
  src.connect(lp).connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  const data = rendered.getChannelData(0);
  const sr = rendered.sampleRate;

  const peaks: number[] = [];
  let threshold = 0.9;
  const max = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  while (peaks.length < 40 && threshold > 0.2) {
    peaks.length = 0;
    const t = max * threshold;
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > t) {
        peaks.push(i);
        i += Math.floor(sr * 0.25);
      }
    }
    threshold -= 0.05;
  }
  if (peaks.length < 8) return null;

  const groups = new Map<number, number>();
  for (let i = 0; i < peaks.length; i++) {
    for (let j = 1; j < 10 && i + j < peaks.length; j++) {
      let bpm = 60 / ((peaks[i + j] - peaks[i]) / sr);
      while (bpm < 80) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      const r = Math.round(bpm);
      groups.set(r, (groups.get(r) ?? 0) + 1);
    }
  }
  // Candidate tempos: the strongest histogram bins plus their common confusions (x2, x1/2, x3/2, x2/3, x4/3, x3/4).
  // A peak-interval histogram alone picks 1.5-beat intervals on syncopated kicks (138 BPM -> "92"), so every
  // candidate is validated against the autocorrelation of the onset envelope at 1-4 periods.
  const bins = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!bins.length) return null;
  const env = onsetEnvelope(data, sr);
  const cands = new Set<number>();
  for (const [b] of bins) for (const m of [1, 2, 0.5, 1.5, 2 / 3, 4 / 3, 0.75]) {
    let v = b * m;
    while (v < 70) v *= 2;
    while (v > 185) v /= 2;
    cands.add(Math.round(v));
  }
  let best = { bpm: bins[0][0], score: -1 };
  for (const c of cands) {
    // Refine to 0.1 BPM around the candidate, then score.
    let localBest = { bpm: c, score: -1 };
    for (let bpm = c - 1; bpm <= c + 1.001; bpm += 0.1) {
      const sc = tempoScore(env, ENV_RATE, bpm);
      if (sc > localBest.score) localBest = { bpm: Math.round(bpm * 10) / 10, score: sc };
    }
    // Electronic music is almost always an integer BPM: snap when the integer scores within 2% of the best.
    const whole = Math.round(localBest.bpm);
    if (whole !== localBest.bpm && tempoScore(env, ENV_RATE, whole) >= localBest.score * 0.98) localBest = { bpm: whole, score: localBest.score };
    const prior = localBest.bpm >= 100 && localBest.bpm <= 145 ? 1 : localBest.bpm >= 85 && localBest.bpm <= 165 ? 0.92 : 0.82;
    const score = localBest.score * prior;
    if (score > best.score) best = { bpm: localBest.bpm, score };
  }
  return { bpm: best.bpm, beatOffset: beatPhaseFor(env, ENV_RATE, best.bpm, peaks, sr) };
}

/**
 * Beat phase from the onset envelope: the offset (0..period) whose comb of beat positions collects the most onset
 * energy, with the downbeat weighted 2x every 4 beats to prefer the bar line. 1 ms resolution, which is what the
 * sample-accurate scheduling of transitions needs (the old peak histogram was ~30 ms). Falls back to the peak
 * method if the envelope is flat.
 */
function beatPhaseFor(env: Float32Array, rate: number, bpm: number, peaks: number[], sr: number) {
  const period = (60 / bpm) * rate;
  const steps = Math.max(8, Math.floor(period)); // ~1 ms steps at 200 Hz? no: period at 128 BPM = 93 frames -> 5 ms; refine below
  let best = 0;
  let bestScore = -Infinity;
  const score = (off: number) => {
    let s = 0;
    let k = 0;
    for (let p = off; p < env.length; p += period, k++) {
      const i = Math.floor(p);
      const v = env[i] ?? 0;
      s += v * (k % 4 === 0 ? 2 : 1);
    }
    return s;
  };
  for (let i = 0; i < steps; i++) {
    const off = (i / steps) * period;
    const sc = score(off);
    if (sc > bestScore) {
      bestScore = sc;
      best = off;
    }
  }
  if (!(bestScore > 0)) return beatOffsetFor(peaks, sr, bpm);
  // Sub-frame refinement: parabolic fit around the best offset.
  const a = score(best - 1);
  const c = score(best + 1);
  const denom = a - 2 * bestScore + c;
  const delta = denom ? Math.max(-1, Math.min(1, (0.5 * (a - c)) / denom)) : 0;
  const offSec = ((best + delta) / rate) % (60 / bpm);
  return Math.round(Math.max(0, offSec) * 1000) / 1000;
}

const ENV_RATE = 200; // onset-envelope frames per second (5 ms)

/** Half-wave rectified energy difference of the low-passed signal at ENV_RATE frames/s (kick onsets). */
function onsetEnvelope(data: Float32Array, sr: number) {
  const hop = Math.floor(sr / ENV_RATE);
  const n = Math.floor(data.length / hop);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j += 4) sum += data[j] * data[j];
    e[i] = sum;
  }
  const out = new Float32Array(n);
  let mean = 0;
  for (let i = 1; i < n; i++) {
    out[i] = Math.max(0, e[i] - e[i - 1]);
    mean += out[i];
  }
  mean /= Math.max(1, n);
  for (let i = 0; i < n; i++) out[i] -= mean;
  return out;
}

/** Normalised autocorrelation of the onset envelope at 1-4 beat periods (weighted). */
function tempoScore(env: Float32Array, rate: number, bpm: number) {
  const period = (60 / bpm) * rate;
  let norm = 0;
  for (let i = 0; i < env.length; i++) norm += env[i] * env[i];
  if (!norm) return 0;
  let score = 0;
  const weights = [1, 0.6, 0.4, 0.3];
  for (let k = 1; k <= 4; k++) {
    const lag = period * k;
    const li = Math.floor(lag);
    const frac = lag - li;
    let acc = 0;
    for (let i = 0; i + li + 1 < env.length; i++) acc += env[i] * (env[i + li] * (1 - frac) + env[i + li + 1] * frac);
    score += weights[k - 1] * (acc / norm);
  }
  return score;
}

/** Phase (0..period) that most peaks fall on, then walked back to the first beat of the file. */
export function beatOffsetFor(peaks: number[], sr: number, bpm: number) {
  const period = (60 / bpm) * sr;
  const bins = 32;
  const hist = new Float32Array(bins);
  for (const p of peaks) {
    const phase = (p % period) / period;
    hist[Math.floor(phase * bins) % bins] += 1;
  }
  let bi = 0;
  for (let i = 1; i < bins; i++) if (hist[i] > hist[bi]) bi = i;
  const phase = ((bi + 0.5) / bins) * period;
  // Refine with the mean of peaks inside the winning bin.
  let sum = 0;
  let n = 0;
  for (const p of peaks) {
    const d = ((p % period) - phase + period * 1.5) % period - period / 2;
    if (Math.abs(d) < period / bins) {
      sum += d;
      n++;
    }
  }
  const off = (phase + (n ? sum / n : 0)) % period;
  return Math.round((off / sr) * 1000) / 1000;
}
