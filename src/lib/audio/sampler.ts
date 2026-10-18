import type { PadConfig } from "../types";

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class Sampler {
  readonly output: GainNode;
  readonly analyser: AnalyserNode;
  buffers = new Map<number, AudioBuffer>();
  configs = new Map<number, PadConfig>();
  private voices = new Map<number, Voice[]>();
  private active = new Set<number>();
  private echoDelay: DelayNode;
  private echoWet: GainNode;
  /** BPM of the playing deck (0 = unknown); loop pads with a loopBpm are stretched to it. */
  masterBpm = 0;
  onChange?: (active: Set<number>) => void;

  constructor(private ctx: AudioContext) {
    this.output = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.output.connect(this.analyser);

    // Echo throw: always-on delay line, only audible while the wet send is open.
    this.echoDelay = ctx.createDelay(2);
    this.echoDelay.delayTime.value = 0.375;
    const fb = ctx.createGain();
    fb.gain.value = 0.55;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 3500;
    this.echoWet = ctx.createGain();
    this.echoWet.gain.value = 0;
    this.output.connect(this.echoDelay);
    this.echoDelay.connect(damp).connect(fb).connect(this.echoDelay);
    damp.connect(this.echoWet).connect(this.analyser);
  }

  /** Hold-to-throw echo on the sampler bus; delay is a dotted 8th of `bpm`. */
  setEcho(on: boolean, bpm = 128) {
    const t = this.ctx.currentTime;
    if (on) this.echoDelay.delayTime.setTargetAtTime(Math.min(1.9, (60 / bpm) * 0.75), t, 0.01);
    this.echoWet.gain.setTargetAtTime(on ? 0.7 : 0, t, 0.02);
  }

  setBuffer(index: number, buffer: AudioBuffer | null) {
    if (buffer) this.buffers.set(index, buffer);
    else this.buffers.delete(index);
  }

  setConfig(config: PadConfig) {
    this.configs.set(config.index, config);
  }

  setVolume(v: number) {
    const t = this.ctx.currentTime, gain = this.output.gain;
    // Anchor the ramp explicitly: an idle bus must already be muted when its next voice starts.
    gain.cancelScheduledValues(t);
    gain.setValueAtTime(gain.value, t);
    gain.linearRampToValueAtTime(v, t + 0.01);
  }

  isActive(index: number) {
    return this.active.has(index);
  }

  /** Called on pad press (mouse down / key down). Returns true if a voice was started. */
  press(index: number, when = 0, velocity = 1) {
    const buffer = this.buffers.get(index);
    const cfg = this.configs.get(index);
    if (!buffer || !cfg) return false;

    if (cfg.mode === "toggle" && this.active.has(index)) {
      this.release(index, true, when || undefined);
      return false;
    }

    if (cfg.choke > 0) {
      for (const [i, c] of this.configs) if (i !== index && c.choke === cfg.choke) this.release(i, true, when || undefined);
    }
    // Retrigger: cut previous voices of this pad.
    this.release(index, true, when || undefined);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const stretch = cfg.loopBpm && this.masterBpm ? Math.min(1.25, Math.max(0.8, this.masterBpm / cfg.loopBpm)) : 1;
    src.playbackRate.value = Math.pow(2, cfg.pitch / 12) * stretch;
    src.loop = cfg.mode === "loop" || cfg.mode === "toggle";
    // Trim region (start/end in seconds); loops cycle inside it, one-shots stop at the end.
    const start = Math.max(0, Math.min(cfg.start ?? 0, buffer.duration - 0.01));
    const end = Math.min(buffer.duration, cfg.end ?? buffer.duration);
    const trimmed = start > 0 || end < buffer.duration - 0.001;
    if (src.loop && trimmed) {
      src.loopStart = start;
      src.loopEnd = end;
    }
    const gain = this.ctx.createGain();
    gain.gain.value = cfg.gain * velocity;
    src.connect(gain).connect(this.output);
    const voice = { src, gain };
    src.onended = () => {
      const list = this.voices.get(index);
      if (!list) return;
      const rest = list.filter((v) => v !== voice);
      if (rest.length) this.voices.set(index, rest);
      else {
        this.voices.delete(index);
        this.active.delete(index);
        this.onChange?.(this.active);
      }
      gain.disconnect();
    };
    if (src.loop || !trimmed) src.start(when, src.loop ? start : 0);
    else src.start(when, start, end - start);
    this.voices.set(index, [...(this.voices.get(index) ?? []), voice]);
    this.active.add(index);
    this.onChange?.(this.active);
    return true;
  }

  /** Called on pad release. Only gate mode stops on release (and loop mode too). */
  release(index: number, force = false, at?: number) {
    const cfg = this.configs.get(index);
    if (!force && cfg && (cfg.mode === "oneshot" || cfg.mode === "toggle")) return;
    const list = this.voices.get(index);
    if (!list) return;
    const t = at ?? this.ctx.currentTime;
    for (const v of list) {
      v.gain.gain.setTargetAtTime(0, t, 0.005);
      try {
        v.src.stop(t + 0.03);
      } catch {}
    }
  }

  stopAll() {
    for (const i of [...this.voices.keys()]) this.release(i, true);
  }
}
