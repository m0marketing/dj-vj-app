/**
 * Integrated loudness (LUFS, ITU-R BS.1770 style): K-weighting (RLB high-pass ~38 Hz + high shelf +4 dB above
 * ~1.7 kHz) rendered natively, 400 ms blocks with 75% overlap, absolute gate -70 LUFS and relative gate -10 LU.
 * Mono input is treated as the mean of channels (good enough for trim). Runs off the main thread's audio graph.
 */
export async function loudnessLufs(buffer: AudioBuffer, bounds: { soundStart: number; soundEnd: number }): Promise<number> {
  const sr = 12000; // the K-weighted mean square does not need more bandwidth than this for a trim value
  const a = Math.max(0, bounds.soundStart);
  const b = Math.min(buffer.duration, bounds.soundEnd);
  const len = Math.max(1, Math.ceil((b - a) * sr));
  const off = new OfflineAudioContext(1, len, sr);
  const src = off.createBufferSource();
  src.buffer = buffer;
  const hp = off.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 38;
  hp.Q.value = 0.5;
  const shelf = off.createBiquadFilter();
  shelf.type = "highshelf";
  shelf.frequency.value = 1681;
  shelf.gain.value = 4;
  src.connect(hp).connect(shelf).connect(off.destination);
  src.start(0, a, b - a);
  const r = await off.startRendering();
  const d = r.getChannelData(0);
  const block = Math.floor(sr * 0.4);
  const hop = Math.floor(block / 4);
  const blocks: number[] = [];
  for (let i = 0; i + block <= d.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + block; j += 2) s += d[j] * d[j];
    blocks.push(s / (block / 2));
  }
  if (!blocks.length) return -20;
  const toLufs = (ms: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, ms));
  const abs = blocks.filter((ms) => toLufs(ms) > -70);
  if (!abs.length) return -40;
  const mean1 = abs.reduce((s, v) => s + v, 0) / abs.length;
  const rel = abs.filter((ms) => toLufs(ms) > toLufs(mean1) - 10);
  const mean2 = (rel.length ? rel : abs).reduce((s, v) => s + v, 0) / (rel.length ? rel : abs).length;
  return Math.round(toLufs(mean2) * 10) / 10;
}

/**
 * Length of the intro in bars: consecutive bars from the first sound whose energy stays under 45% of the
 * track's median bar energy (max 64). A DJ blends over the intro and gets out before the vocal / drop.
 */
export function introBars(buffer: AudioBuffer, bpm: number | null, beatOffset: number, bounds: { soundStart: number; soundEnd: number }) {
  if (!bpm) return 0;
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const barSec = 240 / bpm;
  const first = Math.max(0, Math.ceil((bounds.soundStart - beatOffset) / barSec));
  const n = Math.floor((bounds.soundEnd - beatOffset) / barSec) - first;
  if (n < 8) return 0;
  const e: number[] = [];
  for (let k = 0; k < n; k++) {
    const s0 = Math.floor((beatOffset + (first + k) * barSec) * sr);
    const s1 = Math.min(data.length, Math.floor((beatOffset + (first + k + 1) * barSec) * sr));
    let acc = 0;
    let c = 0;
    for (let i = s0; i < s1; i += 32) {
      acc += data[i] * data[i];
      c++;
    }
    e.push(c ? acc / c : 0);
  }
  const med = [...e].sort((x, y) => x - y)[Math.floor(e.length / 2)] || 1e-9;
  let bars = 0;
  while (bars < Math.min(64, n) && e[bars] < med * 0.45) bars++;
  return bars;
}

/** Loudness of the audible part as RMS in dBFS (used to trim decks so tracks come in at the same level). */
export function loudnessDb(buffer: AudioBuffer, bounds: { soundStart: number; soundEnd: number }): number {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const a = Math.floor(bounds.soundStart * sr);
  const b = Math.min(data.length, Math.floor(bounds.soundEnd * sr));
  // Average the loudest 60% of 1 s windows, so quiet intros / outros do not drag the number down.
  const win = sr;
  const rms: number[] = [];
  for (let i = a; i + win <= b; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j += 8) sum += data[j] * data[j];
    rms.push(sum / (win / 8));
  }
  if (!rms.length) return -20;
  rms.sort((x, y) => y - x);
  const top = rms.slice(0, Math.max(1, Math.round(rms.length * 0.6)));
  const mean = top.reduce((s, v) => s + v, 0) / top.length;
  return Math.round(10 * Math.log10(Math.max(1e-10, mean)) * 10) / 10;
}

/** Where the audible part of a track starts / ends (skips leading & trailing silence, -45 dBFS RMS over 50 ms). */
export function soundBounds(buffer: AudioBuffer): { soundStart: number; soundEnd: number } {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const win = Math.floor(sr * 0.05);
  const thr = Math.pow(10, -45 / 20); // RMS threshold
  const rms = (a: number) => {
    let sum = 0;
    let n = 0;
    for (let i = a; i < Math.min(data.length, a + win); i += 4) {
      sum += data[i] * data[i];
      n++;
    }
    return n ? Math.sqrt(sum / n) : 0;
  };
  let start = 0;
  for (let a = 0; a < data.length; a += win) {
    if (rms(a) > thr) {
      start = a;
      break;
    }
  }
  let end = data.length;
  for (let a = data.length - win; a > start; a -= win) {
    if (rms(a) > thr) {
      end = Math.min(data.length, a + win);
      break;
    }
  }
  return { soundStart: Math.round((start / sr) * 1000) / 1000, soundEnd: Math.round((end / sr) * 1000) / 1000 };
}

/**
 * Picks a "good place to come in": a bar line inside the body of the track whose following 8 bars are among the
 * loudest, so the incoming track lands on a section with energy instead of an intro or a silent gap.
 * Random among the top candidates so repeated plays differ.
 */
export function pickEntry(buffer: AudioBuffer, bpm: number | null, beatOffset = 0, bounds?: { soundStart: number; soundEnd: number }): number {
  const dur = buffer.duration;
  const s0 = bounds?.soundStart ?? 0;
  const s1 = bounds?.soundEnd ?? dur;
  const body = Math.max(1, s1 - s0);
  const barSec = bpm ? 240 / bpm : 8;
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  // Candidates: inside the audible body, leaving at least ~10 bars of music after the entry point.
  const lo = s0 + body * 0.05;
  const hi = Math.max(lo, Math.min(s0 + body * 0.72, s1 - barSec * 10));
  const k0 = Math.ceil((lo - beatOffset) / barSec);
  const k1 = Math.floor((hi - beatOffset) / barSec);
  if (k1 <= k0) return Math.max(0, beatOffset + Math.ceil((s0 - beatOffset) / barSec) * barSec);
  const stride = 48;
  const barEnergy = (k: number) => {
    const a = Math.max(0, Math.floor((beatOffset + k * barSec) * sr));
    const b = Math.min(data.length, Math.floor((beatOffset + (k + 1) * barSec) * sr));
    let sum = 0;
    let n = 0;
    for (let i = a; i < b; i += stride) {
      sum += data[i] * data[i];
      n++;
    }
    return n ? sum / n : 0;
  };
  const bars: number[] = [];
  for (let k = k0; k <= k1 + 8; k++) bars.push(barEnergy(k));
  const cands: { k: number; e: number; first: number }[] = [];
  for (let i = 0; i <= k1 - k0; i++) {
    let e = 0;
    for (let j = 0; j < 8; j++) e += bars[i + j] ?? 0;
    cands.push({ k: k0 + i, e, first: bars[i] });
  }
  const best = Math.max(...cands.map((c) => c.e));
  // Loud 8 bars AND the first bar itself is not a gap (no landing in a silent break).
  const top = cands.filter((c) => c.e >= best * 0.7 && c.first >= (best / 8) * 0.35);
  const pool = top.length ? top : cands.filter((c) => c.e >= best * 0.7);
  const pick = pool[Math.floor(Math.random() * pool.length)] ?? cands[0];
  return Math.max(0, beatOffset + pick.k * barSec);
}
