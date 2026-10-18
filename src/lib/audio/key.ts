/** Musical key detection: Goertzel chromagram + Krumhansl-Schmuckler profile correlation. */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface KeyInfo {
  key: string; // "Am", "C#"
  keyRoot: number; // pitch class 0-11
  keyMinor: boolean;
}

const corr = (a: number[], b: number[]) => {
  const ma = a.reduce((x, y) => x + y, 0) / 12;
  const mb = b.reduce((x, y) => x + y, 0) / 12;
  let n = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return n / Math.sqrt(da * db || 1);
};

export function detectKey(buf: AudioBuffer, windows = 32): KeyInfo | null {
  const ch0 = buf.getChannelData(0);
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const f = Math.max(1, Math.round(buf.sampleRate / 11025));
  const sr = buf.sampleRate / f;
  const N = 8192;
  const span = N * f;
  if (ch0.length < span * 2) return null;
  const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const coeffs = Array.from({ length: 60 }, (_, k) => 2 * Math.cos((2 * Math.PI * 440 * Math.pow(2, (36 + k - 69) / 12)) / sr));
  const chroma = new Array(12).fill(0);
  const x = new Float32Array(N);
  const lo = buf.length * 0.1;
  const hi = buf.length * 0.9 - span;
  for (let w = 0; w < windows; w++) {
    const start = Math.floor(lo + ((hi - lo) * w) / Math.max(1, windows - 1));
    let energy = 0;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = 0; j < f; j++) {
        const idx = start + i * f + j;
        s += ch1 ? (ch0[idx] + ch1[idx]) * 0.5 : ch0[idx];
      }
      x[i] = (s / f) * hann[i];
      energy += x[i] * x[i];
    }
    if (energy < 1e-4) continue;
    for (let k = 0; k < 60; k++) {
      const c = coeffs[k];
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < N; i++) {
        const s0 = x[i] + c * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      chroma[(36 + k) % 12] += Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / Math.sqrt(energy);
    }
  }
  let best = { score: -2, root: 0, minor: false };
  for (let r = 0; r < 12; r++) {
    const rot = chroma.map((_, i) => chroma[(i + r) % 12]);
    for (const minor of [false, true]) {
      const score = corr(rot, minor ? MINOR : MAJOR);
      if (score > best.score) best = { score, root: r, minor };
    }
  }
  return { key: NOTE_NAMES[best.root] + (best.minor ? "m" : ""), keyRoot: best.root, keyMinor: best.minor };
}

/** Semitone shift that moves material written in A minor / C major onto the given key (-6..+5). */
export function shiftFromAm(k: Pick<KeyInfo, "keyRoot" | "keyMinor">) {
  const minorRoot = k.keyMinor ? k.keyRoot : (k.keyRoot + 9) % 12;
  const s = (((minorRoot - 9) % 12) + 12) % 12;
  return s > 6 ? s - 12 : s;
}

/** Camelot wheel number (1-12); the letter is A for minor, B for major. */
export const camelotNumber = (root: number, minor: boolean) => {
  const minorOrder = [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1]; // 1A = G#m, 2A = D#m, ... (circle of fifths)
  const r = minor ? root : (root + 9) % 12; // relative minor of a major key
  return minorOrder.indexOf(r) + 1;
};

/**
 * Smallest semitone shift (−2..+2) that makes `b` harmonically compatible with `a`, or 0 if it already is /
 * cannot be fixed within range. Used to key-match the incoming track through the key-lock shifter.
 */
export const keyShiftToMatch = (a: { keyRoot?: number; keyMinor?: boolean }, b: { keyRoot?: number; keyMinor?: boolean }) => {
  if (a.keyRoot == null || b.keyRoot == null || keysCompatible(a, b)) return 0;
  for (const s of [1, -1, 2, -2]) if (keysCompatible(a, { keyRoot: (((b.keyRoot + s) % 12) + 12) % 12, keyMinor: b.keyMinor })) return s;
  return 0;
};

/** Harmonically compatible: same key, relative major/minor, or one step around the wheel. */
export const keysCompatible = (a: { keyRoot?: number; keyMinor?: boolean }, b: { keyRoot?: number; keyMinor?: boolean }) => {
  if (a.keyRoot == null || b.keyRoot == null) return false;
  const d = Math.abs(camelotNumber(a.keyRoot, !!a.keyMinor) - camelotNumber(b.keyRoot, !!b.keyMinor));
  return d === 0 || d === 1 || d === 11;
};
