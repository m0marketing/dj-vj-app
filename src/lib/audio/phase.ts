/**
 * Measured kick alignment between two playing decks.
 * Builds a low-band (kick) energy envelope for ~2.5 s of real time ahead of each deck's position (track time is
 * stretched by the deck rate) and cross-correlates them. Returns how far the incoming deck's kicks lag behind
 * the outgoing deck's, in seconds of real time (positive = incoming is late), plus a confidence (peak / mean).
 */
const HOP = 0.004; // 4 ms envelope resolution

export function kickEnvelope(data: Float32Array, sr: number, pos: number, rate: number, seconds = 2.5): Float32Array {
  const n = Math.floor(seconds / HOP);
  const env = new Float32Array(n);
  const span = HOP * rate * sr; // samples of track time per envelope step
  const a = 1 - Math.exp((-2 * Math.PI * 150) / sr); // one-pole low-pass at ~150 Hz
  let y = 0;
  // warm up the filter on the 50 ms before the window
  for (let i = Math.max(0, Math.floor((pos - 0.05) * sr)); i < Math.floor(pos * sr); i++) y += a * (data[i] - y);
  let s = Math.floor(pos * sr);
  for (let k = 0; k < n; k++) {
    const e = Math.min(data.length, Math.floor(pos * sr + (k + 1) * span));
    let acc = 0;
    let c = 0;
    for (; s < e; s++) {
      y += a * (data[s] - y);
      acc += y * y;
      c++;
    }
    env[k] = c ? Math.sqrt(acc / c) : 0;
  }
  // onset emphasis: positive difference only (kicks, not sustained bass)
  const out = new Float32Array(n);
  for (let k = 1; k < n; k++) out[k] = Math.max(0, env[k] - env[k - 1]);
  return out;
}

export function measureKickLag(src: Float32Array, dst: Float32Array, maxLag = 0.3): { lag: number; confidence: number } {
  const maxK = Math.floor(maxLag / HOP);
  const n = Math.min(src.length, dst.length);
  let best = 0;
  let bestK = 0;
  let sum = 0;
  let cnt = 0;
  for (let k = -maxK; k <= maxK; k++) {
    let acc = 0;
    // dst delayed by k steps matches src: src[i] ~ dst[i + k]
    for (let i = Math.max(0, -k); i < Math.min(n, n - k); i++) acc += src[i] * dst[i + k];
    sum += acc;
    cnt++;
    if (acc > best) {
      best = acc;
      bestK = k;
    }
  }
  const mean = sum / Math.max(1, cnt);
  return { lag: bestK * HOP, confidence: mean > 0 ? best / mean : 0 };
}
