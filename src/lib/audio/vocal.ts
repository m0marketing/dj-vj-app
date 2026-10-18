/**
 * Vocal presence per bar (0..1), without ML: the signal is band-passed to the voice band (~300 Hz–3.5 kHz) with
 * native biquads in an OfflineAudioContext, then per bar we combine
 *   - voice-band share of the energy (vocals push the mids up relative to kick / hats),
 *   - sustain: vocals are held notes, so the band energy has a high mean-to-peak ratio within the bar
 *     (drums are spiky: low ratio),
 * z-normalised across the track and clipped. It tells *where* the vocals are in a track (verse / chorus vs. intro,
 * break, instrumental) which is what the mixer needs to keep two vocals from fighting; it cannot certify that an
 * instrumental has no vocals at all (everything is relative to the track itself + a mild absolute floor).
 */
export async function vocalMap(buffer: AudioBuffer, bpm: number | null, beatOffset = 0): Promise<number[] | null> {
  if (!bpm) return null;
  const barSec = 240 / bpm;
  const n = Math.floor((buffer.duration - beatOffset) / barSec);
  if (n < 4) return null;
  const sr = 11025; // enough for a 3.5 kHz band and ~4x cheaper to filter / scan
  const len = Math.ceil(buffer.duration * sr);
  const off = new OfflineAudioContext(2, len, sr);
  const src = off.createBufferSource();
  src.buffer = buffer;
  // Channel 0: voice band. Channel 1: everything (for the share).
  const hp = off.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 300;
  hp.Q.value = 0.7;
  const lp = off.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 3500;
  lp.Q.value = 0.7;
  const merger = off.createChannelMerger(2);
  const mono = off.createGain();
  src.connect(mono);
  mono.connect(hp).connect(lp).connect(merger, 0, 0);
  mono.connect(merger, 0, 1);
  merger.connect(off.destination);
  src.start(0);
  const r = await off.startRendering();
  const band = r.getChannelData(0);
  const full = r.getChannelData(1);

  const share = new Float32Array(n);
  const sustain = new Float32Array(n);
  const sub = Math.max(1, Math.floor(sr * 0.05)); // 50 ms sub-frames
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, Math.floor((beatOffset + i * barSec) * sr));
    const b = Math.min(band.length, Math.floor((beatOffset + (i + 1) * barSec) * sr));
    let eb = 0;
    let ef = 0;
    let peak = 0;
    let frames = 0;
    for (let j = a; j < b; j += sub) {
      let s = 0;
      const e = Math.min(b, j + sub);
      for (let k = j; k < e; k += 2) {
        s += band[k] * band[k];
        ef += full[k] * full[k];
      }
      eb += s;
      peak = Math.max(peak, s);
      frames++;
    }
    share[i] = ef > 1e-9 ? eb / ef : 0;
    sustain[i] = peak > 1e-9 && frames ? eb / frames / peak : 0;
  }
  // Combine: raw = share-weighted sustain. Normalise by the track's own distribution (robust z-score), then floor.
  const raw = Array.from(share, (s, i) => s * (0.4 + sustain[i]));
  const sorted = [...raw].sort((x, y) => x - y);
  const med = sorted[Math.floor(sorted.length / 2)] || 0;
  const mad = sorted.map((v) => Math.abs(v - med)).sort((x, y) => x - y)[Math.floor(sorted.length / 2)] || 1e-6;
  return raw.map((v, i) => {
    const z = (v - med) / (1.4826 * mad);
    const absolute = share[i] > 0.28 ? 1 : share[i] / 0.28; // quiet / drum-only bars cannot be "vocal"
    return Math.round(Math.min(1, Math.max(0, 0.5 + z * 0.25)) * absolute * 100) / 100;
  });
}

/** Average vocal presence of a track over [t0, t1] seconds (bar grid from the track meta). */
export function vocalBetween(map: number[] | undefined, bpm: number | null | undefined, beatOffset: number | undefined, t0: number, t1: number) {
  if (!map?.length || !bpm) return 0;
  const barSec = 240 / bpm;
  const a = Math.max(0, Math.floor((t0 - (beatOffset ?? 0)) / barSec));
  const b = Math.min(map.length - 1, Math.ceil((t1 - (beatOffset ?? 0)) / barSec));
  if (b < a) return 0;
  let s = 0;
  for (let i = a; i <= b; i++) s += map[i];
  return s / (b - a + 1);
}
