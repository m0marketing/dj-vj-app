/**
 * Tiny procedural synth kit built on Web Audio nodes.
 * Every instrument schedules nodes at time `t` into `out` and returns nothing;
 * used both for default sampler sounds and for the demo track generator.
 */
import { normalize } from "./wav";

export type Ctx = BaseAudioContext;
export type Out = AudioNode;

const FLOOR = 0.0001;

// ---------- utilities ----------

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "A4" -> 440, "Bb3", "F#2" supported */
let TRANSPOSE = 0;
/** Transposes every subsequent note() lookup (used to re-render keyed loops in the playing track's key). */
export const setTranspose = (semis: number) => {
  TRANSPOSE = semis;
};
export function note(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const semis = NOTE_INDEX[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  const midi = 12 * (parseInt(m[3]) + 1) + semis;
  return 440 * Math.pow(2, (midi - 69 + TRANSPOSE) / 12);
}

const noiseCache = new WeakMap<Ctx, AudioBuffer>();
export function noiseBuffer(ctx: Ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

export function noiseSrc(ctx: Ctx, t: number, dur: number) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  s.start(t);
  s.stop(t + dur + 0.05);
  return s;
}

export function osc(ctx: Ctx, type: OscillatorType, freq: number, t: number, dur: number, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

export function filt(ctx: Ctx, type: BiquadFilterType, freq: number, Q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  return f;
}

export function gain(ctx: Ctx, v = 1) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

export function pan(ctx: Ctx, out: Out, p: number) {
  const s = ctx.createStereoPanner();
  s.pan.value = p;
  s.connect(out);
  return s;
}

/** ADSR-ish envelope; returns end time. */
export function env(p: AudioParam, t: number, peak: number, a: number, d: number, s = 0, hold = 0, r = 0.05) {
  p.setValueAtTime(FLOOR, t);
  p.linearRampToValueAtTime(Math.max(peak, FLOOR), t + a);
  const sus = Math.max(s * peak, FLOOR);
  p.exponentialRampToValueAtTime(sus, t + a + d);
  if (hold > 0) p.setValueAtTime(sus, t + a + d + hold);
  p.exponentialRampToValueAtTime(FLOOR, t + a + d + hold + r);
  return t + a + d + hold + r;
}

const shaperCurves = new Map<number, Float32Array<ArrayBuffer>>();
export function saturate(ctx: Ctx, amount = 2) {
  const ws = ctx.createWaveShaper();
  let curve = shaperCurves.get(amount);
  if (!curve) {
    curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 511.5 - 1) * amount);
    shaperCurves.set(amount, curve);
  }
  ws.curve = curve;
  return ws;
}

// ---------- drums ----------

export function kick(ctx: Ctx, out: Out, t: number, o: { pitch?: number; decay?: number; vel?: number } = {}) {
  const { pitch = 160, decay = 0.45, vel = 1 } = o;
  const s = osc(ctx, "sine", pitch, t, decay + 0.1);
  s.frequency.setValueAtTime(pitch, t);
  s.frequency.exponentialRampToValueAtTime(42, t + 0.09);
  const g = ctx.createGain();
  env(g.gain, t, vel, 0.001, decay, 0, 0, 0.02);
  s.connect(saturate(ctx, 1.5)).connect(g).connect(out);
  const n = noiseSrc(ctx, t, 0.03);
  const ng = ctx.createGain();
  env(ng.gain, t, vel * 0.4, 0.001, 0.015, 0, 0, 0.01);
  n.connect(filt(ctx, "bandpass", 3500, 1)).connect(ng).connect(out);
}

export function kick808(ctx: Ctx, out: Out, t: number, vel = 1) {
  const s = osc(ctx, "sine", 120, t, 1.1);
  s.frequency.setValueAtTime(120, t);
  s.frequency.exponentialRampToValueAtTime(38, t + 0.15);
  const g = ctx.createGain();
  env(g.gain, t, vel, 0.002, 0.9, 0, 0, 0.1);
  s.connect(saturate(ctx, 3)).connect(g).connect(out);
}

export function snare(ctx: Ctx, out: Out, t: number, vel = 1) {
  const tone = osc(ctx, "triangle", 190, t, 0.2);
  tone.frequency.exponentialRampToValueAtTime(140, t + 0.1);
  const tg = ctx.createGain();
  env(tg.gain, t, vel * 0.6, 0.001, 0.12, 0, 0, 0.03);
  tone.connect(tg).connect(out);
  const n = noiseSrc(ctx, t, 0.3);
  const ng = ctx.createGain();
  env(ng.gain, t, vel * 0.8, 0.001, 0.18, 0, 0, 0.05);
  n.connect(filt(ctx, "bandpass", 1800, 0.6)).connect(filt(ctx, "highpass", 600)).connect(ng).connect(out);
}

export function clap(ctx: Ctx, out: Out, t: number, vel = 1) {
  const f = filt(ctx, "bandpass", 1300, 1.2);
  f.connect(out);
  for (let i = 0; i < 4; i++) {
    const tt = t + i * 0.011;
    const n = noiseSrc(ctx, tt, i === 3 ? 0.25 : 0.02);
    const g = ctx.createGain();
    env(g.gain, tt, vel * 0.8, 0.001, i === 3 ? 0.18 : 0.01, 0, 0, 0.02);
    n.connect(g).connect(f);
  }
}

export function hat(ctx: Ctx, out: Out, t: number, o: { open?: boolean; vel?: number } = {}) {
  const { open = false, vel = 1 } = o;
  const dur = open ? 0.35 : 0.05;
  const n = noiseSrc(ctx, t, dur + 0.1);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.5, 0.001, dur, 0, 0, 0.03);
  n.connect(filt(ctx, "highpass", 7500, 0.7)).connect(filt(ctx, "peaking", 10000, 1)).connect(g).connect(out);
}

export function crash(ctx: Ctx, out: Out, t: number, vel = 1) {
  const n = noiseSrc(ctx, t, 1.8);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.6, 0.002, 1.4, 0, 0, 0.3);
  n.connect(filt(ctx, "highpass", 4500, 0.5)).connect(filt(ctx, "peaking", 7000, 2)).connect(g).connect(out);
}

export function tom(ctx: Ctx, out: Out, t: number, freq = 120, vel = 1) {
  const s = osc(ctx, "sine", freq, t, 0.5);
  s.frequency.setValueAtTime(freq * 1.4, t);
  s.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 0.3);
  const g = ctx.createGain();
  env(g.gain, t, vel, 0.001, 0.35, 0, 0, 0.1);
  s.connect(saturate(ctx, 1.5)).connect(g).connect(out);
}

export function rim(ctx: Ctx, out: Out, t: number, vel = 1) {
  const s = osc(ctx, "square", 820, t, 0.03);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.5, 0.001, 0.02, 0, 0, 0.01);
  s.connect(filt(ctx, "bandpass", 2600, 2)).connect(g).connect(out);
  const n = noiseSrc(ctx, t, 0.04);
  const ng = ctx.createGain();
  env(ng.gain, t, vel * 0.4, 0.001, 0.025, 0, 0, 0.01);
  n.connect(filt(ctx, "bandpass", 3200, 3)).connect(ng).connect(out);
}

export function shaker(ctx: Ctx, out: Out, t: number, vel = 1) {
  const n = noiseSrc(ctx, t, 0.12);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.35, 0.02, 0.07, 0, 0, 0.02);
  n.connect(filt(ctx, "bandpass", 6500, 2.5)).connect(g).connect(out);
}

// ---------- drum machine kits (909 / 808 flavours) ----------

/** TR-909 style kick: punchy click, longer pitched body, light saturation. */
export function kick909(ctx: Ctx, out: Out, t: number, vel = 1) {
  const s = osc(ctx, "sine", 180, t, 0.6);
  s.frequency.setValueAtTime(180, t);
  s.frequency.exponentialRampToValueAtTime(55, t + 0.07);
  s.frequency.exponentialRampToValueAtTime(48, t + 0.4);
  const g = ctx.createGain();
  env(g.gain, t, vel, 0.001, 0.4, 0, 0, 0.08);
  s.connect(saturate(ctx, 2)).connect(g).connect(out);
  const click = noiseSrc(ctx, t, 0.012);
  const cg = ctx.createGain();
  env(cg.gain, t, vel * 0.6, 0.0005, 0.008, 0, 0, 0.004);
  click.connect(filt(ctx, "highpass", 2500)).connect(cg).connect(out);
}

/** 909 snare: two detuned tones + bright noise with a snappy tail. */
export function snare909(ctx: Ctx, out: Out, t: number, vel = 1) {
  for (const [f, v] of [
    [185, 0.5],
    [330, 0.3],
  ] as const) {
    const o = osc(ctx, "triangle", f, t, 0.25);
    o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.12);
    const g = ctx.createGain();
    env(g.gain, t, vel * v, 0.001, 0.1, 0, 0, 0.04);
    o.connect(g).connect(out);
  }
  const n = noiseSrc(ctx, t, 0.35);
  const ng = ctx.createGain();
  env(ng.gain, t, vel * 0.9, 0.001, 0.22, 0, 0, 0.06);
  n.connect(filt(ctx, "highpass", 1200, 0.5)).connect(filt(ctx, "peaking", 4500, 1.5)).connect(ng).connect(out);
}

/** 808 snare: softer, lower tone, shorter noise. */
export function snare808(ctx: Ctx, out: Out, t: number, vel = 1) {
  const o = osc(ctx, "sine", 200, t, 0.3);
  o.frequency.exponentialRampToValueAtTime(150, t + 0.15);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.7, 0.001, 0.18, 0, 0, 0.05);
  o.connect(g).connect(out);
  const n = noiseSrc(ctx, t, 0.25);
  const ng = ctx.createGain();
  env(ng.gain, t, vel * 0.5, 0.001, 0.12, 0, 0, 0.05);
  n.connect(filt(ctx, "bandpass", 2400, 0.8)).connect(ng).connect(out);
}

/** 808 hi-hat: metallic (six square oscillators) through a band-pass, closed or open. */
export function hat808(ctx: Ctx, out: Out, t: number, o: { open?: boolean; vel?: number } = {}) {
  const { open = false, vel = 1 } = o;
  const dur = open ? 0.45 : 0.06;
  const bp = filt(ctx, "bandpass", 9000, 1.2);
  const hp = filt(ctx, "highpass", 7000, 0.7);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.22, 0.001, dur, 0, 0, 0.04);
  for (const f of [205, 302, 370, 445, 522, 600]) osc(ctx, "square", f * 2.1, t, dur + 0.1).connect(bp);
  bp.connect(hp).connect(g).connect(out);
}

export function ride(ctx: Ctx, out: Out, t: number, vel = 1) {
  const bp = filt(ctx, "bandpass", 6500, 2);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.25, 0.001, 0.9, 0, 0, 0.3);
  for (const f of [412, 619, 843, 1022]) osc(ctx, "square", f * 3.3, t, 1.3).connect(bp);
  const n = noiseSrc(ctx, t, 1.2);
  const ng = ctx.createGain();
  env(ng.gain, t, vel * 0.25, 0.001, 0.8, 0, 0, 0.3);
  n.connect(filt(ctx, "highpass", 6000)).connect(ng).connect(out);
  bp.connect(g).connect(out);
}

export function conga(ctx: Ctx, out: Out, t: number, freq = 190, vel = 1) {
  const s = osc(ctx, "sine", freq, t, 0.3);
  s.frequency.setValueAtTime(freq * 1.25, t);
  s.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.9, 0.001, 0.18, 0, 0, 0.06);
  s.connect(saturate(ctx, 1.3)).connect(g).connect(out);
}

export function clave(ctx: Ctx, out: Out, t: number, vel = 1) {
  const s = osc(ctx, "sine", 2500, t, 0.08);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.7, 0.0005, 0.05, 0, 0, 0.02);
  s.connect(g).connect(out);
}

export function maracas(ctx: Ctx, out: Out, t: number, vel = 1) {
  const n = noiseSrc(ctx, t, 0.08);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.4, 0.004, 0.04, 0, 0, 0.02);
  n.connect(filt(ctx, "highpass", 8000, 1)).connect(g).connect(out);
}

/** Long 808 kick / bass note (trap): pitched, saturated, with a slow decay. */
export function kick808Long(ctx: Ctx, out: Out, t: number, freq = 50, dur = 1.6, vel = 1) {
  const s = osc(ctx, "sine", freq, t, dur + 0.2);
  s.frequency.setValueAtTime(freq * 3, t);
  s.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
  const g = ctx.createGain();
  env(g.gain, t, vel, 0.002, dur * 0.6, 0.35, dur * 0.4, 0.1);
  s.connect(saturate(ctx, 3.5)).connect(g).connect(out);
}

// ---------- bass & tonal ----------

export function sub808(ctx: Ctx, out: Out, t: number, freq: number, dur = 0.8, vel = 1) {
  const s = osc(ctx, "sine", freq, t, dur + 0.2);
  s.frequency.setValueAtTime(freq * 2.2, t);
  s.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
  const g = ctx.createGain();
  env(g.gain, t, vel, 0.003, dur * 0.7, 0.3, dur * 0.3, 0.08);
  s.connect(saturate(ctx, 2.5)).connect(g).connect(out);
}

export function sawBass(ctx: Ctx, out: Out, t: number, freq: number, dur: number, vel = 1) {
  const a = osc(ctx, "sawtooth", freq, t, dur);
  const b = osc(ctx, "square", freq / 2, t, dur);
  const f = filt(ctx, "lowpass", 900, 4);
  f.frequency.setValueAtTime(1800, t);
  f.frequency.exponentialRampToValueAtTime(300, t + dur);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.6, 0.004, dur * 0.5, 0.5, dur * 0.3, 0.05);
  a.connect(f);
  b.connect(f);
  f.connect(saturate(ctx, 1.5)).connect(g).connect(out);
}

/** Tropical-house style pluck (triangle + soft saw, closing lowpass). */
export function pluck(ctx: Ctx, out: Out, t: number, freq: number, dur = 0.5, vel = 1) {
  const a = osc(ctx, "triangle", freq, t, dur);
  const b = osc(ctx, "sawtooth", freq, t, dur, 6);
  const bg = gain(ctx, 0.25);
  const f = filt(ctx, "lowpass", 5000, 2);
  f.frequency.setValueAtTime(freq * 8, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.2, 200), t + 0.25);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.6, 0.002, dur * 0.8, 0, 0, dur * 0.2);
  a.connect(f);
  b.connect(bg).connect(f);
  f.connect(g).connect(out);
}

/** Steel-drum-ish marimba for softer riffs. */
export function marimba(ctx: Ctx, out: Out, t: number, freq: number, vel = 1) {
  const a = osc(ctx, "sine", freq, t, 0.6);
  const b = osc(ctx, "sine", freq * 4, t, 0.15);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.7, 0.002, 0.45, 0, 0, 0.1);
  const bg = ctx.createGain();
  env(bg.gain, t, vel * 0.2, 0.001, 0.08, 0, 0, 0.02);
  a.connect(g).connect(out);
  b.connect(bg).connect(out);
}

/** Big-room supersaw (6 detuned saws). */
export function supersaw(ctx: Ctx, out: Out, t: number, freq: number, dur: number, vel = 1, cutoff = 3500) {
  const f = filt(ctx, "lowpass", cutoff, 0.8);
  f.frequency.setValueAtTime(cutoff * 0.5, t);
  f.frequency.linearRampToValueAtTime(cutoff, t + 0.15);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.22, 0.01, 0.15, 0.8, Math.max(0, dur - 0.3), 0.15);
  const detunes = [-18, -11, -4, 4, 11, 18];
  for (const d of detunes) osc(ctx, "sawtooth", freq, t, dur, d).connect(f);
  f.connect(g).connect(out);
}

export function piano(ctx: Ctx, out: Out, t: number, freq: number, dur = 1.2, vel = 1) {
  const partials: [number, OscillatorType, number, number][] = [
    [1, "triangle", 0.7, dur],
    [2, "sine", 0.25, dur * 0.6],
    [3, "sine", 0.1, dur * 0.4],
    [1, "sawtooth", 0.08, 0.08],
  ];
  const f = filt(ctx, "lowpass", 4500, 0.7);
  f.connect(out);
  for (const [mult, type, amp, d] of partials) {
    const o = osc(ctx, type, freq * mult, t, d);
    const g = ctx.createGain();
    env(g.gain, t, vel * amp, 0.003, d * 0.9, 0, 0, d * 0.1 + 0.02);
    o.connect(g).connect(f);
  }
}

/** Formant "vocal chop": saw through two parallel band-passes. */
export function vocal(ctx: Ctx, out: Out, t: number, freq: number, dur: number, vowel: "a" | "o" | "e" = "a", vel = 1) {
  const formants = { a: [800, 1200], o: [400, 800], e: [400, 2300] }[vowel];
  const src = osc(ctx, "sawtooth", freq, t, dur);
  src.frequency.setValueAtTime(freq * 0.94, t);
  src.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
  const lfo = osc(ctx, "sine", 5.5, t, dur);
  const lfoG = gain(ctx, freq * 0.012);
  lfo.connect(lfoG).connect(src.frequency);
  const mix = gain(ctx, 1);
  for (const f of formants) {
    const bp = filt(ctx, "bandpass", f, 7);
    src.connect(bp).connect(mix);
  }
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.9, 0.02, dur * 0.3, 0.7, dur * 0.5, 0.08);
  mix.connect(filt(ctx, "lowpass", 5000)).connect(g).connect(out);
}

// ---------- FX ----------

export function riser(ctx: Ctx, out: Out, t: number, dur = 2, vel = 1) {
  const n = noiseSrc(ctx, t, dur);
  const f = filt(ctx, "bandpass", 300, 1.2);
  f.frequency.setValueAtTime(250, t);
  f.frequency.exponentialRampToValueAtTime(9000, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.6, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  n.connect(f).connect(g).connect(out);
  const s = osc(ctx, "sawtooth", 110, t, dur);
  s.frequency.setValueAtTime(110, t);
  s.frequency.exponentialRampToValueAtTime(880, t + dur);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(FLOOR, t);
  sg.gain.exponentialRampToValueAtTime(vel * 0.12, t + dur);
  sg.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  s.connect(filt(ctx, "lowpass", 2500)).connect(sg).connect(out);
}

export function downlifter(ctx: Ctx, out: Out, t: number, dur = 1.5, vel = 1) {
  const n = noiseSrc(ctx, t, dur);
  const f = filt(ctx, "bandpass", 6000, 1.5);
  f.frequency.setValueAtTime(7000, t);
  f.frequency.exponentialRampToValueAtTime(150, t + dur);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.6, 0.01, dur * 0.9, 0, 0, dur * 0.1);
  n.connect(f).connect(g).connect(out);
}

export function impact(ctx: Ctx, out: Out, t: number, vel = 1) {
  const s = osc(ctx, "sine", 70, t, 1.5);
  s.frequency.setValueAtTime(70, t);
  s.frequency.exponentialRampToValueAtTime(28, t + 0.5);
  const g = ctx.createGain();
  env(g.gain, t, vel, 0.002, 1.2, 0, 0, 0.2);
  s.connect(saturate(ctx, 2)).connect(g).connect(out);
  const n = noiseSrc(ctx, t, 1.2);
  const ng = ctx.createGain();
  env(ng.gain, t, vel * 0.5, 0.002, 0.8, 0, 0, 0.3);
  n.connect(filt(ctx, "lowpass", 500, 0.7)).connect(ng).connect(out);
}

export function sweep(ctx: Ctx, out: Out, t: number, dur = 2, vel = 1) {
  const n = noiseSrc(ctx, t, dur);
  const f = filt(ctx, "highpass", 200, 0.7);
  f.frequency.setValueAtTime(120, t);
  f.frequency.exponentialRampToValueAtTime(12000, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.linearRampToValueAtTime(vel * 0.5, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0, t + dur);
  n.connect(f).connect(g).connect(out);
}

export function laser(ctx: Ctx, out: Out, t: number, vel = 1) {
  const s = osc(ctx, "square", 2800, t, 0.3);
  s.frequency.setValueAtTime(2800, t);
  s.frequency.exponentialRampToValueAtTime(180, t + 0.22);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.4, 0.002, 0.2, 0, 0, 0.05);
  s.connect(filt(ctx, "lowpass", 4000)).connect(g).connect(out);
}

export function airhorn(ctx: Ctx, out: Out, t: number, dur = 1.4, vel = 1) {
  const f = filt(ctx, "lowpass", 2200, 1.5);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.35, 0.02, 0.1, 0.9, dur - 0.3, 0.15);
  const base = 415; // Ab4-ish, the classic
  for (const [mult, det] of [
    [1, -8],
    [1, 8],
    [1.5, 0],
    [0.5, 4],
  ]) {
    const o = osc(ctx, "sawtooth", base * mult, t, dur, det);
    o.frequency.setValueAtTime(base * mult * 0.97, t);
    o.frequency.exponentialRampToValueAtTime(base * mult, t + 0.12);
    o.connect(f);
  }
  f.connect(saturate(ctx, 2)).connect(g).connect(out);
}

export function siren(ctx: Ctx, out: Out, t: number, dur = 2, vel = 1) {
  const s = osc(ctx, "square", 700, t, dur);
  const lfo = osc(ctx, "triangle", 1 / 1.0, t, dur);
  const lfoG = gain(ctx, 280);
  lfo.connect(lfoG).connect(s.frequency);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.25, 0.02, 0.05, 1, dur - 0.1, 0.03);
  s.connect(filt(ctx, "lowpass", 2500)).connect(g).connect(out);
}

export function rewind(ctx: Ctx, out: Out, t: number, dur = 1, vel = 1) {
  const s = osc(ctx, "sawtooth", 600, t, dur);
  s.frequency.setValueAtTime(900, t);
  s.frequency.exponentialRampToValueAtTime(60, t + dur);
  const lfo = osc(ctx, "square", 18, t, dur);
  const lfoG = gain(ctx, 120);
  lfo.connect(lfoG).connect(s.frequency);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.35, 0.01, dur * 0.8, 0, 0, dur * 0.2);
  s.connect(filt(ctx, "lowpass", 3000)).connect(g).connect(out);
}

// ---------- party ----------

/** Shouted syllable: gritty saw voice with a formant glide, pitch contour and breath. */
export function shout(
  ctx: Ctx,
  out: Out,
  t: number,
  o: { f0: number; f1?: number; dur: number; from: [number, number]; to?: [number, number]; vib?: number; vel?: number },
) {
  const { f0, f1 = f0, dur, from, to = from, vib = 0, vel = 1 } = o;
  const src = osc(ctx, "sawtooth", f0, t, dur);
  src.frequency.setValueAtTime(f0, t);
  src.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.9);
  if (vib) {
    const lfo = osc(ctx, "sine", 6, t, dur);
    lfo.connect(gain(ctx, f0 * vib)).connect(src.frequency);
  }
  const drive = saturate(ctx, 2.5);
  src.connect(drive);
  const mix = gain(ctx, 1);
  from.forEach((fr, i) => {
    const bp = filt(ctx, "bandpass", fr, 5 + i * 2);
    bp.frequency.setValueAtTime(fr, t);
    bp.frequency.linearRampToValueAtTime(to[i], t + dur * 0.7);
    drive.connect(bp).connect(mix);
  });
  const n = noiseSrc(ctx, t, dur);
  n.connect(filt(ctx, "bandpass", from[1], 1.5)).connect(gain(ctx, 0.35)).connect(mix);
  const g = ctx.createGain();
  env(g.gain, t, vel * 1.2, 0.012, dur * 0.35, 0.6, dur * 0.2, dur * 0.3);
  mix.connect(g).connect(out);
}

export function whistle(ctx: Ctx, out: Out, t: number, dur = 0.7, vel = 1) {
  const s = osc(ctx, "sine", 2300, t, dur);
  s.frequency.setValueAtTime(2300, t);
  s.frequency.linearRampToValueAtTime(3000, t + 0.12);
  s.frequency.linearRampToValueAtTime(2850, t + dur);
  const trem = ctx.createGain();
  trem.gain.value = 0.6;
  osc(ctx, "sine", 38, t, dur).connect(gain(ctx, 0.4)).connect(trem.gain);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.5, 0.02, dur * 0.3, 0.8, dur * 0.4, dur * 0.2);
  s.connect(trem).connect(g).connect(out);
  const n = noiseSrc(ctx, t, dur);
  const ng = ctx.createGain();
  env(ng.gain, t, vel * 0.06, 0.03, dur * 0.8, 0.5, 0, 0.1);
  n.connect(filt(ctx, "highpass", 3500)).connect(ng).connect(out);
}

export function cowbell(ctx: Ctx, out: Out, t: number, vel = 1) {
  const f = filt(ctx, "bandpass", 800, 1.5);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.7, 0.001, 0.3, 0, 0, 0.1);
  for (const fr of [587, 845]) osc(ctx, "square", fr, t, 0.45).connect(f);
  f.connect(g).connect(out);
}

/** Record scratch: a saw "voice" dragged back and forth with a gated envelope. */
export function scratch(ctx: Ctx, out: Out, t: number, vel = 1) {
  const pts: [number, number][] = [
    [0, 150],
    [0.07, 650],
    [0.14, 120],
    [0.21, 520],
    [0.3, 80],
    [0.37, 950],
    [0.47, 200],
    [0.58, 50],
  ];
  const s = osc(ctx, "sawtooth", 150, t, 0.7);
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, t);
  pts.forEach(([dt, fr], i) => {
    s.frequency.exponentialRampToValueAtTime(fr, t + dt + 0.001);
    g.gain.linearRampToValueAtTime(i % 2 ? 0.25 : 0.9 * vel, t + dt + 0.001);
  });
  g.gain.linearRampToValueAtTime(0, t + 0.65);
  s.connect(filt(ctx, "bandpass", 1400, 1)).connect(saturate(ctx, 3)).connect(g).connect(out);
  const n = noiseSrc(ctx, t, 0.65);
  const ng = gain(ctx, 0.12 * vel);
  n.connect(filt(ctx, "highpass", 2500)).connect(ng).connect(out);
}

/** Crowd cheer: formant noise swell + scattered claps + a few whoops. */
export function cheer(ctx: Ctx, out: Out, t: number, dur = 2.2, vel = 1) {
  const n = noiseSrc(ctx, t, dur);
  const mix = gain(ctx, 1);
  for (const fr of [700, 1250, 2700]) n.connect(filt(ctx, "bandpass", fr, 1.1)).connect(mix);
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.linearRampToValueAtTime(vel * 0.9, t + 0.4);
  g.gain.exponentialRampToValueAtTime(vel * 0.55, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
  osc(ctx, "sine", 7, t, dur).connect(gain(ctx, 0.12)).connect(g.gain);
  mix.connect(g).connect(out);
  for (let i = 0; i < 55; i++) {
    const tt = t + Math.random() * dur * 0.85;
    const cn = noiseSrc(ctx, tt, 0.05);
    const cg = ctx.createGain();
    env(cg.gain, tt, rnd(0.08, 0.3) * vel, 0.001, 0.03, 0, 0, 0.02);
    cn.connect(filt(ctx, "bandpass", rnd(1000, 2200), 1.5)).connect(cg).connect(pan(ctx, out, rnd(-0.8, 0.8)));
  }
  for (let i = 0; i < 4; i++) {
    const tt = t + rnd(0.1, dur * 0.5);
    const f0 = rnd(380, 760);
    shout(ctx, pan(ctx, out, rnd(-0.7, 0.7)), tt, { f0, f1: f0 * 1.6, dur: rnd(0.4, 0.7), from: [350, 800], to: [500, 900], vib: 0.02, vel: 0.2 });
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function bassDrop(ctx: Ctx, out: Out, t: number, dur = 1.8, vel = 1) {
  const s = osc(ctx, "sine", 120, t, dur);
  s.frequency.setValueAtTime(120, t);
  s.frequency.exponentialRampToValueAtTime(34, t + 0.7);
  const g = ctx.createGain();
  env(g.gain, t, vel, 0.004, dur * 0.7, 0.3, dur * 0.1, dur * 0.15);
  s.connect(saturate(ctx, 3)).connect(g).connect(out);
  const gr = osc(ctx, "sawtooth", 220, t, dur * 0.8);
  gr.frequency.setValueAtTime(220, t);
  gr.frequency.exponentialRampToValueAtTime(42, t + 0.9);
  const lp = filt(ctx, "lowpass", 600, 5);
  osc(ctx, "sine", 7, t, dur).connect(gain(ctx, 380)).connect(lp.frequency);
  const gg = ctx.createGain();
  env(gg.gain, t, vel * 0.45, 0.004, dur * 0.6, 0, 0, dur * 0.1);
  gr.connect(lp).connect(saturate(ctx, 4)).connect(gg).connect(out);
  const n = noiseSrc(ctx, t, 0.9);
  const ng = ctx.createGain();
  env(ng.gain, t, vel * 0.5, 0.002, 0.6, 0, 0, 0.2);
  n.connect(filt(ctx, "lowpass", 900, 0.7)).connect(ng).connect(out);
}

export function snareRoll(ctx: Ctx, out: Out, t: number, dur = 2, vel = 1) {
  let tt = 0;
  let gap = 0.21;
  while (tt < dur - 0.05) {
    snare(ctx, out, t + tt, vel * (0.25 + 0.75 * (tt / dur)));
    tt += gap;
    gap = Math.max(0.05, gap * 0.86);
  }
  riser(ctx, out, t, dur, vel * 0.5);
}

export function confettiPop(ctx: Ctx, out: Out, t: number, vel = 1) {
  const s = osc(ctx, "sine", 220, t, 0.2);
  s.frequency.setValueAtTime(220, t);
  s.frequency.exponentialRampToValueAtTime(55, t + 0.12);
  const g = ctx.createGain();
  env(g.gain, t, vel, 0.001, 0.12, 0, 0, 0.05);
  s.connect(saturate(ctx, 2)).connect(g).connect(out);
  const n = noiseSrc(ctx, t, 0.4);
  const ng = ctx.createGain();
  env(ng.gain, t, vel * 0.7, 0.001, 0.25, 0, 0, 0.1);
  n.connect(filt(ctx, "bandpass", 2500, 0.6)).connect(ng).connect(out);
  for (let i = 0; i < 16; i++) {
    const tt = t + 0.05 + Math.random() * 0.5;
    const p = osc(ctx, "sine", rnd(3000, 8000), tt, 0.08);
    const pg = ctx.createGain();
    env(pg.gain, tt, 0.1 * vel, 0.001, 0.05, 0, 0, 0.02);
    p.connect(pg).connect(pan(ctx, out, rnd(-0.8, 0.8)));
  }
}

/** Festival-anthem supersaw hook (da da da-daaa). */
export function anthem(ctx: Ctx, out: Out, t: number, vel = 1) {
  const seq: [string, number, number][] = [
    ["A4", 0, 0.14],
    ["A4", 0.15, 0.14],
    ["C5", 0.3, 0.14],
    ["E5", 0.45, 0.7],
  ];
  for (const [n, dt, d] of seq) {
    supersaw(ctx, out, t + dt, note(n), d, vel, 5500);
    supersaw(ctx, out, t + dt, note(n) / 2, d, vel * 0.7, 2500);
  }
}

export function orchHit(ctx: Ctx, out: Out, t: number, vel = 1) {
  const f = filt(ctx, "lowpass", 3500, 0.8);
  f.frequency.setValueAtTime(3500, t);
  f.frequency.exponentialRampToValueAtTime(700, t + 0.4);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.18, 0.004, 0.7, 0, 0, 0.2);
  for (const n of ["A2", "E3", "A3", "C4", "E4", "A4"]) {
    osc(ctx, "sawtooth", note(n), t, 0.95, -6).connect(f);
    osc(ctx, "sawtooth", note(n), t, 0.95, 6).connect(f);
  }
  f.connect(g).connect(out);
  impact(ctx, out, t, vel * 0.5);
}

/** Falling bomb whistle followed by a boom. */
export function bombDrop(ctx: Ctx, out: Out, t: number, vel = 1) {
  const dur = 1.1;
  const s = osc(ctx, "sine", 3200, t, dur);
  s.frequency.setValueAtTime(3200, t);
  s.frequency.exponentialRampToValueAtTime(400, t + dur);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.4, 0.05, dur * 0.8, 0.5, 0, 0.05);
  s.connect(g).connect(out);
  impact(ctx, out, t + dur, vel);
  const n = noiseSrc(ctx, t + dur, 0.9);
  const ng = ctx.createGain();
  env(ng.gain, t + dur, vel * 0.6, 0.002, 0.7, 0, 0, 0.2);
  n.connect(filt(ctx, "lowpass", 400, 0.7)).connect(ng).connect(out);
}

/** "Ah-iiiin" comic stinger: quick "a", long falling "i", nasal "n" tail. */
export function aiin(ctx: Ctx, out: Out, t: number, vel = 1) {
  shout(ctx, out, t, { f0: 330, f1: 300, dur: 0.16, from: [800, 1250], to: [600, 1700], vel });
  shout(ctx, out, t + 0.14, { f0: 430, f1: 250, dur: 0.85, from: [300, 2400], to: [280, 2300], vib: 0.015, vel });
  const n = osc(ctx, "sawtooth", 240, t + 0.85, 0.35);
  n.frequency.exponentialRampToValueAtTime(200, t + 1.2);
  const g = ctx.createGain();
  env(g.gain, t + 0.85, vel * 0.5, 0.03, 0.2, 0.3, 0, 0.12);
  n.connect(filt(ctx, "bandpass", 260, 5)).connect(g).connect(out);
}

/** Firework: rising whistle, crack, then glittering pings. */
export function firework(ctx: Ctx, out: Out, t: number, vel = 1) {
  const s = osc(ctx, "sine", 700, t, 0.7);
  s.frequency.setValueAtTime(700, t);
  s.frequency.exponentialRampToValueAtTime(3800, t + 0.65);
  const g = ctx.createGain();
  env(g.gain, t, vel * 0.3, 0.05, 0.6, 0.6, 0, 0.03);
  s.connect(g).connect(out);
  const n = noiseSrc(ctx, t + 0.68, 0.6);
  const ng = ctx.createGain();
  env(ng.gain, t + 0.68, vel * 0.9, 0.002, 0.45, 0, 0, 0.15);
  n.connect(filt(ctx, "bandpass", 1800, 0.5)).connect(ng).connect(out);
  impact(ctx, out, t + 0.68, vel * 0.4);
  for (let i = 0; i < 18; i++) {
    const tt = t + 0.75 + Math.random() * 0.8;
    const p = osc(ctx, "sine", rnd(2500, 7000), tt, 0.08);
    const pg = ctx.createGain();
    env(pg.gain, tt, 0.08 * vel, 0.001, 0.06, 0, 0, 0.02);
    p.connect(pg).connect(pan(ctx, out, rnd(-0.8, 0.8)));
  }
}

// ---------- remix loops (128 BPM, 2 bars) ----------

export const LOOP_BPM = 128;
let BEAT = 60 / LOOP_BPM;
let S16 = BEAT / 4;
/** Re-tempo every loop/phrase builder (used when re-rendering loops at the playing deck's BPM). */
export const setLoopTempo = (bpm: number) => {
  BEAT = 60 / bpm;
  S16 = BEAT / 4;
};
export const LOOP_SECONDS = (60 / LOOP_BPM) * 8;
const AM = ["A3", "C4", "E4"];
const FM = ["F3", "A3", "C4"];

export const loops = {
  kick: (c: Ctx, o: Out) => {
    for (let i = 0; i < 8; i++) kick(c, o, i * BEAT);
  },
  hats: (c: Ctx, o: Out) => {
    for (let i = 0; i < 32; i++) hat(c, o, i * S16, { vel: i % 4 === 2 ? 0.0 : 0.35 });
    for (let i = 0; i < 8; i++) hat(c, o, i * BEAT + BEAT / 2, { open: true, vel: 0.8 });
  },
  backbeat: (c: Ctx, o: Out) => {
    for (let b = 0; b < 2; b++)
      for (const beat of [1, 3]) {
        clap(c, o, (b * 4 + beat) * BEAT);
        snare(c, o, (b * 4 + beat) * BEAT, 0.6);
      }
  },
  bass: (c: Ctx, o: Out) => {
    const pat: [number, string][] = [[0, "A1"], [3, "A1"], [6, "C2"], [10, "A1"], [12, "G1"]];
    for (let b = 0; b < 2; b++) for (const [st, n] of pat) sub808(c, o, (b * 16 + st) * S16, note(b ? n.replace("A1", "F1").replace("C2", "A1") : n), 0.2);
  },
  chords: (c: Ctx, o: Out) => {
    for (let b = 0; b < 2; b++) for (let i = 0; i < 4; i++) for (const n of b ? FM : AM) supersaw(c, o, (b * 4 + i) * BEAT + BEAT / 2, note(n), 0.2, 0.5, 3500);
  },
  arp: (c: Ctx, o: Out) => {
    const A = ["A4", "C5", "E5", "C5"];
    const F = ["F4", "A4", "C5", "A4"];
    for (let s = 0; s < 32; s++) pluck(c, o, s * S16, note((s < 16 ? A : F)[s % 4]), 0.22, 0.7);
  },
  shaker: (c: Ctx, o: Out) => {
    for (let s = 0; s < 32; s++) shaker(c, o, s * S16, s % 2 ? 0.45 : 0.8);
    for (let i = 0; i < 8; i++) rim(c, o, i * BEAT + BEAT * 0.75, 0.5);
  },
  vox: (c: Ctx, o: Out) => {
    const hits = [0, 3, 6, 10, 14, 16, 19, 22, 26, 30];
    const v = ["a", "o", "e"] as const;
    const n = ["A4", "C5", "E4", "G4", "A4"];
    hits.forEach((st, i) => vocal(c, o, st * S16, note(n[i % 5]), 0.2, v[i % 3]));
  },
};

// ---------- EDM chorus phrases & FX (128 BPM, tempo-matched) ----------

export const LOOP4_SECONDS = (60 / LOOP_BPM) * 16;
const PROG = [AM, FM, ["C4", "E4", "G4"], ["G3", "B3", "D4"]];
const ROOTS = ["A1", "F1", "C2", "G1"];
const MEL: [string, number, number][][] = [
  [["E5", 0, 0.75], ["E5", 0.75, 0.75], ["D5", 1.5, 0.5], ["C5", 2, 2]],
  [["C5", 0, 0.75], ["C5", 0.75, 0.75], ["D5", 1.5, 0.5], ["A4", 2, 2]],
  [["E5", 0, 0.75], ["G5", 0.75, 0.75], ["E5", 1.5, 0.5], ["D5", 2, 2]],
  [["D5", 0, 0.75], ["D5", 0.75, 0.75], ["B4", 1.5, 0.5], ["G4", 2, 2]],
];
const bar = (b: number) => b * 4 * BEAT;

/** Detuned saw chord stab with a tight gate. */
function gateStab(c: Ctx, o: Out, t: number, freqs: number[], dur: number, vel = 0.5) {
  const f = filt(c, "lowpass", 4500, 1);
  const g = c.createGain();
  env(g.gain, t, vel * 0.2, 0.003, dur * 0.7, 0, 0, dur * 0.3);
  for (const fr of freqs) for (const d of [-9, 9]) osc(c, "sawtooth", fr, t, dur, d).connect(f);
  f.connect(g).connect(o);
}

const chordFreqs = (ch: string[]) => ch.map(note);

export const edm = {
  lead: (c: Ctx, o: Out) =>
    MEL.forEach((m, b) =>
      m.forEach(([n, st, d]) => {
        supersaw(c, o, bar(b) + st * BEAT, note(n), d * BEAT * 0.95, 0.7, 5500);
        supersaw(c, o, bar(b) + st * BEAT, note(n) / 2, d * BEAT * 0.95, 0.4, 3000);
      }),
    ),
  chords: (c: Ctx, o: Out) => PROG.forEach((ch, b) => ch.forEach((n) => supersaw(c, o, bar(b), note(n), BEAT * 3.9, 0.45, 3000))),
  pluck: (c: Ctx, o: Out) =>
    PROG.forEach((ch, b) => {
      for (let s = 0; s < 16; s++) pluck(c, o, bar(b) + s * S16, note([ch[0], ch[1], ch[2], ch[1]][s % 4]) * 2, 0.2, 0.7);
    }),
  bass: (c: Ctx, o: Out) => ROOTS.forEach((r, b) => { for (let i = 0; i < 4; i++) sub808(c, o, bar(b) + i * BEAT + BEAT / 2, note(r), BEAT * 0.45); }),
  vox: (c: Ctx, o: Out) => MEL.forEach((m, b) => m.forEach(([n, st, d], i) => vocal(c, o, bar(b) + st * BEAT, note(n), Math.max(0.3, d * BEAT * 0.9), i % 2 ? "o" : "a"))),
  drums: (c: Ctx, o: Out) => {
    for (let i = 0; i < 16; i++) {
      kick(c, o, i * BEAT);
      if (i % 4 === 1 || i % 4 === 3) clap(c, o, i * BEAT);
      hat(c, o, i * BEAT + BEAT / 2, { open: true, vel: 0.8 });
    }
    for (let s = 0; s < 64; s++) if (s % 2) hat(c, o, s * S16, { vel: 0.3 });
  },
  offbeat: (c: Ctx, o: Out) => { for (let i = 0; i < 8; i++) sawBass(c, o, i * BEAT + BEAT / 2, note("A1"), BEAT * 0.4); },
  acid: (c: Ctx, o: Out) => {
    const seq = ["A1", "A1", "A2", "A1", "C2", "A1", "A2", "G1"];
    for (let s = 0; s < 32; s++) sawBass(c, o, s * S16, note(seq[s % 8]), S16 * 0.9, 0.9);
  },
  gate: (c: Ctx, o: Out) => PROG.forEach((ch, b) => { for (let s = 0; s < 16; s++) gateStab(c, o, bar(b) + s * S16, chordFreqs(ch), S16 * 0.8); }),
  sidechain: (c: Ctx, o: Out) => {
    const duck = c.createGain();
    duck.connect(o);
    for (let i = 0; i < 16; i++) {
      duck.gain.setValueAtTime(0.12, i * BEAT);
      duck.gain.linearRampToValueAtTime(1, i * BEAT + BEAT * 0.8);
      kick(c, o, i * BEAT, { vel: 0.8 });
    }
    PROG.forEach((ch, b) => ch.forEach((n) => supersaw(c, duck, bar(b), note(n), BEAT * 3.9, 0.5, 3500)));
  },
  bigKick: (c: Ctx, o: Out) => {
    for (let i = 0; i < 8; i++) {
      kick(c, o, i * BEAT, { pitch: 200, decay: 0.5 });
      sub808(c, o, i * BEAT, note("A1"), BEAT * 0.8, 0.7);
    }
  },
  build2: (c: Ctx, o: Out) => snareRoll(c, o, 0, BEAT * 8 - 0.2),
  build4: (c: Ctx, o: Out) => {
    snareRoll(c, o, 0, BEAT * 16 - 0.2);
    sweep(c, o, 0, BEAT * 16 - 0.2, 0.6);
  },
  dropImpact: (c: Ctx, o: Out) => {
    impact(c, o, 0);
    crash(c, o, 0);
    bassDrop(c, o, 0, 1.8);
  },
  revCrash: (c: Ctx, o: Out) => {
    const n = noiseSrc(c, 0, 2);
    const f = filt(c, "highpass", 500, 0.7);
    f.frequency.exponentialRampToValueAtTime(7000, 1.9);
    const g = c.createGain();
    g.gain.setValueAtTime(FLOOR, 0);
    g.gain.exponentialRampToValueAtTime(0.9, 1.9);
    g.gain.linearRampToValueAtTime(0, 2);
    n.connect(f).connect(g).connect(o);
  },
  sweepUp: (c: Ctx, o: Out) => sweep(c, o, 0, BEAT * 8),
  downlift: (c: Ctx, o: Out) => downlifter(c, o, 0, 1.9),
  snareFill: (c: Ctx, o: Out) => { for (let s = 0; s < 16; s++) snare(c, o, s * S16, 0.3 + (0.7 * s) / 15); },
  tomFill: (c: Ctx, o: Out) => { for (let s = 0; s < 16; s++) tom(c, o, s * S16, 230 - s * 8, 0.9); },
  kickRoll: (c: Ctx, o: Out) => {
    let t = 0;
    let gap = BEAT / 2;
    while (t < BEAT * 8 - 0.1) {
      kick(c, o, t, { vel: 0.7 + (0.3 * t) / (BEAT * 8) });
      t += gap;
      gap = Math.max(S16 / 2, gap * 0.9);
    }
  },
  lasers: (c: Ctx, o: Out) => { for (let i = 0; i < 8; i++) laser(c, o, i * S16 * 2); },
  raveStab: (c: Ctx, o: Out) => {
    const g = c.createGain();
    env(g.gain, 0, 0.25, 0.003, 0.4, 0, 0, 0.1);
    const f = filt(c, "lowpass", 3500, 2);
    for (const n of AM) for (const d of [-20, 0, 20]) {
      const s = osc(c, "sawtooth", note(n), 0, 0.6, d);
      s.frequency.setValueAtTime(note(n) * 1.5, 0);
      s.frequency.exponentialRampToValueAtTime(note(n), 0.08);
      s.connect(f);
    }
    f.connect(saturate(c, 2)).connect(g).connect(o);
  },
  stutter: (c: Ctx, o: Out) => {
    const pat = [1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1];
    pat.forEach((on, s) => on && gateStab(c, o, s * S16, chordFreqs(AM), S16 * 0.7, 0.7));
  },
  /** Dubstep-style wobble: detuned saws through an LFO-swept lowpass, LFO rate in 8ths -> 16ths over 2 bars. */
  wobble: (c: Ctx, o: Out) => {
    const f = filt(c, "lowpass", 400, 8);
    const lfo = osc(c, "sine", 1 / (BEAT / 2), 0, BEAT * 8);
    lfo.frequency.setValueAtTime(1 / (BEAT / 2), 0);
    lfo.frequency.setValueAtTime(1 / (BEAT / 4), BEAT * 4);
    const depth = gain(c, 900);
    lfo.connect(depth).connect(f.frequency);
    const g = c.createGain();
    g.gain.value = 0.35;
    const roots = ["A1", "A1", "F1", "G1"];
    roots.forEach((r, b) => {
      for (const d of [-12, 0, 12]) osc(c, "sawtooth", note(r), b * 2 * BEAT, 2 * BEAT - 0.02, d).connect(f);
      osc(c, "square", note(r) / 2, b * 2 * BEAT, 2 * BEAT - 0.02).connect(f);
    });
    f.connect(saturate(c, 2.5)).connect(g).connect(o);
  },
  /** Crowd chant "HEY! … HO!" on beats 2 & 4 with a stomp underneath (2 bars). */
  chant: (c: Ctx, o: Out) => {
    for (let b = 0; b < 2; b++) {
      kick(c, o, b * 4 * BEAT, { pitch: 120, decay: 0.3, vel: 0.8 });
      kick(c, o, b * 4 * BEAT + 2 * BEAT, { pitch: 120, decay: 0.3, vel: 0.8 });
      shout(c, o, b * 4 * BEAT + BEAT, { f0: 330, f1: 290, dur: 0.35, from: [450, 2200], to: [700, 1700] });
      shout(c, o, b * 4 * BEAT + 3 * BEAT, { f0: 250, f1: 190, dur: 0.35, from: [450, 850], to: [500, 800] });
      clap(c, o, b * 4 * BEAT + BEAT, 0.8);
      clap(c, o, b * 4 * BEAT + 3 * BEAT, 0.8);
    }
  },
  /** Trap-style hi-hat rolls with triplet bursts and 808 kicks (2 bars). */
  trapHats: (c: Ctx, o: Out) => {
    for (let s = 0; s < 32; s++) hat(c, o, s * S16, { vel: s % 4 === 0 ? 0.8 : 0.4 });
    for (const st of [6, 14, 22, 30]) for (let k = 0; k < 3; k++) hat(c, o, st * S16 + (k * S16) / 3, { vel: 0.5 });
    for (const st of [0, 10, 16, 22, 26]) kick808(c, o, st * S16, 0.9);
    for (const st of [8, 24]) clap(c, o, st * S16);
  },
  /** Reese bass: two slowly beating saws, one note per bar (2 bars). */
  reese: (c: Ctx, o: Out) => {
    const f = filt(c, "lowpass", 900, 1.5);
    const g = c.createGain();
    g.gain.value = 0.3;
    ["A1", "F1"].forEach((r, b) => {
      osc(c, "sawtooth", note(r), b * 4 * BEAT, 4 * BEAT - 0.05, -7).connect(f);
      osc(c, "sawtooth", note(r), b * 4 * BEAT, 4 * BEAT - 0.05, 7).connect(f);
    });
    f.connect(saturate(c, 1.8)).connect(g).connect(o);
  },
};

/** Tape stop: a chord that slows to a halt with pitch and level dropping together (~1.5 s). */
export function tapeStop(ctx: Ctx, out: Out, t: number, vel = 1) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.3 * vel, t);
  g.gain.setValueAtTime(0.3 * vel, t + 0.3);
  g.gain.exponentialRampToValueAtTime(FLOOR, t + 1.5);
  const f = filt(ctx, "lowpass", 5000, 0.8);
  f.frequency.setValueAtTime(5000, t + 0.3);
  f.frequency.exponentialRampToValueAtTime(120, t + 1.5);
  for (const n of ["A3", "C4", "E4", "A4"]) {
    for (const d of [-8, 8]) {
      const s = osc(ctx, "sawtooth", note(n), t, 1.6, d);
      s.frequency.setValueAtTime(note(n), t + 0.3);
      s.frequency.exponentialRampToValueAtTime(note(n) * 0.05, t + 1.5);
      s.connect(f);
    }
  }
  kick(ctx, out, t, { vel: 0.7 });
  f.connect(g).connect(out);
}

/** Vinyl crackle bed (looping): filtered noise with random pops. */
export function crackle(ctx: Ctx, out: Out, t: number, dur = 2, vel = 1) {
  const n = noiseSrc(ctx, t, dur);
  const g = gain(ctx, 0.05 * vel);
  n.connect(filt(ctx, "bandpass", 2500, 0.5)).connect(g).connect(out);
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  let p = t + rnd(0.02, 0.1);
  while (p < t + dur - 0.02) {
    const pop = noiseSrc(ctx, p, 0.01);
    const pg = ctx.createGain();
    env(pg.gain, p, rnd(0.2, 0.6) * vel, 0.001, 0.008, 0, 0, 0.004);
    pop.connect(filt(ctx, "highpass", 1500)).connect(pg).connect(out);
    p += rnd(0.04, 0.25);
  }
}

/** Short reverse-swell riser into a snap (1 bar at loop tempo), for mini transitions. */
export function reverseSnare(ctx: Ctx, out: Out, t: number, vel = 1) {
  const n = noiseSrc(ctx, t, BEAT);
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.exponentialRampToValueAtTime(0.7 * vel, t + BEAT - 0.03);
  g.gain.linearRampToValueAtTime(0, t + BEAT);
  n.connect(filt(ctx, "bandpass", 2000, 0.8)).connect(g).connect(out);
  snare(ctx, out, t + BEAT, vel);
}

// ---------- rendering ----------

export async function render(
  seconds: number,
  channels: number,
  build: (ctx: OfflineAudioContext, out: GainNode) => void,
  peak = 0.95,
): Promise<AudioBuffer> {
  const sr = 44100;
  const ctx = new OfflineAudioContext(channels, Math.ceil(seconds * sr), sr);
  const out = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -8;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.15;
  out.connect(comp).connect(ctx.destination);
  build(ctx, out);
  return normalize(await ctx.startRendering(), peak);
}
