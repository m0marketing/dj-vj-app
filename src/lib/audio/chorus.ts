/**
 * Chorus ("サビ") detection on the beat grid.
 *
 * Per-bar features: energy (RMS²), brightness (zero-crossing rate ≈ high-frequency content) and low-band
 * energy (one-pole low-pass). The chorus is the 16-bar window that is loud and bright, starts with an
 * energy jump (drop / hook entry), repeats elsewhere in the song (self-similarity), and has no gap inside.
 * Returns seconds on the bar grid so transitions can land exactly on it.
 */
export interface ChorusResult {
  /** The strongest chorus. */
  chorusStart: number;
  chorusEnd: number;
  /** Every chorus found, in time order (1 for a normal song, many for a long mix). */
  choruses: [number, number][];
}

export function detectChorus(buffer: AudioBuffer, bpm: number | null, beatOffset = 0, bounds?: { soundStart: number; soundEnd: number }, bars = 16): ChorusResult | null {
  const dur = buffer.duration;
  const s0 = bounds?.soundStart ?? 0;
  const s1 = bounds?.soundEnd ?? dur;
  const barSec = bpm ? 240 / bpm : 2;
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const kFirst = Math.max(0, Math.ceil((s0 - beatOffset) / barSec));
  const kLast = Math.floor((s1 - beatOffset) / barSec) - 1;
  const n = kLast - kFirst + 1;
  if (n < bars + 2) return null;
  // Short songs: an 8-bar chorus is more realistic.
  if (n < bars * 3 && bars > 8) bars = 8;

  const stride = 16;
  const E = new Float32Array(n);
  const Z = new Float32Array(n);
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, Math.floor((beatOffset + (kFirst + i) * barSec) * sr));
    const b = Math.min(data.length, Math.floor((beatOffset + (kFirst + i + 1) * barSec) * sr));
    let e = 0;
    let z = 0;
    let lo = 0;
    let lp = 0;
    let prev = data[a] ?? 0;
    let cnt = 0;
    for (let j = a; j < b; j += stride) {
      const v = data[j];
      e += v * v;
      if ((v >= 0) !== (prev >= 0)) z++;
      prev = v;
      lp += (v - lp) * 0.08;
      lo += lp * lp;
      cnt++;
    }
    E[i] = cnt ? e / cnt : 0;
    Z[i] = cnt ? z / cnt : 0;
    L[i] = cnt ? lo / cnt : 0;
  }
  const norm = (arr: Float32Array) => {
    const m = Math.max(1e-9, ...arr);
    return Array.from(arr, (v) => v / m);
  };
  const e = norm(E);
  const z = norm(Z);
  const l = norm(L);
  const win = (arr: number[], k: number) => {
    let s = 0;
    for (let i = 0; i < bars; i++) s += arr[k + i];
    return s / bars;
  };
  // Self-similarity (only for tracks of reasonable length; a 60-minute mix would be O(n²) for little gain).
  const rep = new Float32Array(n);
  if (n <= 700) {
    const feat = (k: number) => {
      const out: number[] = [];
      for (let i = 0; i < bars; i++) out.push(e[k + i], z[k + i], l[k + i]);
      return out;
    };
    const fs: number[][] = [];
    for (let k = 0; k + bars <= n; k++) fs.push(feat(k));
    const corr = (a: number[], b: number[]) => {
      let sa = 0;
      let sb = 0;
      for (let i = 0; i < a.length; i++) {
        sa += a[i];
        sb += b[i];
      }
      const ma = sa / a.length;
      const mb = sb / b.length;
      let num = 0;
      let da = 0;
      let db = 0;
      for (let i = 0; i < a.length; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2;
        db += (b[i] - mb) ** 2;
      }
      return da && db ? num / Math.sqrt(da * db) : 0;
    };
    for (let k = 0; k < fs.length; k++) {
      let best = 0;
      for (let j = 0; j < fs.length; j += 2) {
        if (Math.abs(j - k) < bars) continue;
        const c = corr(fs[k], fs[j]);
        if (c > best) best = c;
      }
      rep[k] = Math.max(0, best);
    }
  }

  // Score every window, then pick non-overlapping peaks: one chorus for a normal song, several for long files
  // (DJ mixes, albums, live sets) where each contained song has its own hook.
  const scores: { k: number; score: number }[] = [];
  const emax = Math.max(...e);
  for (let k = 0; k + bars <= n; k++) {
    // No gap inside the window (a breakdown is not a chorus).
    let minE = 1;
    for (let i = 0; i < bars; i++) minE = Math.min(minE, e[k + i]);
    if (minE < emax * 0.12) continue;
    // Energy jump into the window (none at the very start: the intro is not a chorus).
    const jump = k > 0 ? Math.max(0, e[k] - e[k - 1]) : 0;
    // The first bars of a song are almost never the chorus; the tail is a fade-out more often than not.
    const edge = k < 2 || k + bars > n - 1 ? -0.25 : 0;
    // Prefer starts that sit on a 4-bar boundary relative to the first audible bar (phrase alignment proxy).
    const phrase = (k % 4 === 0 ? 0.12 : 0) + (k % 8 === 0 ? 0.08 : 0);
    scores.push({ k, score: 0.55 * win(e, k) + 0.2 * win(z, k) + 0.1 * win(l, k) + 0.35 * jump + 0.3 * rep[k] + phrase + edge });
  }
  if (!scores.length) return null;
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0].score;
  const audible = s1 - s0;
  const maxCount = audible < 360 ? 1 : Math.max(2, Math.min(40, Math.floor(audible / 150)));
  const minGapBars = Math.max(bars * 2, Math.round(90 / barSec)); // choruses at least ~90 s / 2 windows apart
  const picked: number[] = [];
  for (const c of scores) {
    if (picked.length >= maxCount) break;
    if (c.score < best * 0.55) break;
    if (picked.some((k) => Math.abs(k - c.k) < minGapBars)) continue;
    picked.push(c.k);
  }
  picked.sort((a, b) => a - b);
  const toRange = (k: number): [number, number] => {
    const start = beatOffset + (kFirst + k) * barSec;
    return [Math.round(start * 1000) / 1000, Math.round(Math.min(s1, start + bars * barSec) * 1000) / 1000];
  };
  const all = picked.map(toRange);
  const main = toRange(scores[0].k);
  return { chorusStart: main[0], chorusEnd: main[1], choruses: all };
}
