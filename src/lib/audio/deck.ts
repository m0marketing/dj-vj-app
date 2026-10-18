import type { DeckId, TrackMeta } from "../types";

export interface DeckState {
  id: DeckId;
  track: TrackMeta | null;
  playing: boolean;
  position: number;
  duration: number;
  rate: number;
  volume: number;
  eq: { low: number; mid: number; high: number };
  filter: number; // -1 (LPF) .. 0 (off) .. 1 (HPF)
  cues: (number | null)[];
  cuePoint: number;
  loop: { in: number | null; out: number | null; active: boolean };
  keylock: boolean;
  keyShift: number;
  scratching: boolean;
}

export class Deck {
  readonly id: DeckId;
  readonly input: GainNode;
  readonly output: GainNode;
  readonly analyser: AnalyserNode;

  buffer: AudioBuffer | null = null;
  track: TrackMeta | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private _playing = false;
  private _rate = 1;
  /** Temporary playback-rate multiplier while the jog wheel is nudged (1 = none). */
  private _bend = 1;
  private previewing = false;

  private low: BiquadFilterNode;
  private mid: BiquadFilterNode;
  private high: BiquadFilterNode;
  private lpf: BiquadFilterNode;
  private hpf: BiquadFilterNode;
  private fader: GainNode;
  /** Loudness trim (auto gain) so tracks of different mastering levels come in equally loud. */
  private trim: GainNode;
  /** Pre-fader listen send (headphone cue): tapped after EQ / filter / trim, before the channel fader. */
  readonly cueSend: GainNode;
  /** Key lock (master tempo): granular pitch shifter that undoes the pitch change of playbackRate. */
  private shifter: AudioWorkletNode | null = null;
  private shifterIn: GainNode;
  private direct: GainNode;
  keylock = true;
  /** Harmonic key shift in semitones (applied through the key-lock shifter), 0 = none. */
  keyShift = 0;

  cues: (number | null)[] = [null, null, null, null];
  /** CDJ-style main cue point. */
  cuePoint = 0;
  loop = { in: null as number | null, out: null as number | null, active: false };
  volume = 1;
  eq = { low: 0, mid: 0, high: 0 };
  filter = 0;
  onEnded?: () => void;

  constructor(private ctx: AudioContext, id: DeckId) {
    this.id = id;
    this.input = ctx.createGain();
    this.low = ctx.createBiquadFilter();
    this.low.type = "lowshelf";
    this.low.frequency.value = 250;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = "peaking";
    this.mid.frequency.value = 1200;
    this.mid.Q.value = 0.8;
    this.high = ctx.createBiquadFilter();
    this.high.type = "highshelf";
    this.high.frequency.value = 4000;
    this.lpf = ctx.createBiquadFilter();
    this.lpf.type = "lowpass";
    this.lpf.frequency.value = 22000;
    this.hpf = ctx.createBiquadFilter();
    this.hpf.type = "highpass";
    this.hpf.frequency.value = 10;
    this.fader = ctx.createGain();
    this.trim = ctx.createGain();
    this.cueSend = ctx.createGain();
    this.cueSend.gain.value = 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.output = ctx.createGain();

    // Source -> (direct | shifter) -> input. The worklet is attached once the module has loaded (see attachKeylock).
    this.shifterIn = ctx.createGain();
    this.direct = ctx.createGain();
    this.direct.connect(this.input);
    this.shifterIn.gain.value = 0;
    this.input
      .connect(this.low)
      .connect(this.mid)
      .connect(this.high)
      .connect(this.lpf)
      .connect(this.hpf)
      .connect(this.trim)
      .connect(this.fader)
      .connect(this.analyser)
      .connect(this.output);
    this.trim.connect(this.cueSend);
  }

  // ---- Scratch -------------------------------------------------------------------------------------------
  /** Scratch player (window of the track playable at negative rates) + its gate; attached once the module loads. */
  private scratchNode: AudioWorkletNode | null = null;
  private scratchGain: GainNode | null = null;
  private scratchPos = 0; // read head inside the window (samples)
  private scratchWin = { start: 0, len: 0 }; // window origin (track seconds) / length (samples)
  private scratchResume: { pos: number; at: number; wasPlaying: boolean } | null = null;
  private scratchTimer: ReturnType<typeof setTimeout> | null = null;
  get scratching() {
    return !!this.scratchResume;
  }
  /** Fired when a scratch (pattern or hand) ends and normal playback resumes. */
  onScratchEnd?: () => void;

  attachScratch() {
    if (this.scratchNode) return;
    try {
      this.scratchNode = new AudioWorkletNode(this.ctx, "scratch-player", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      this.scratchGain = this.ctx.createGain();
      this.scratchGain.gain.value = 0;
      this.scratchNode.connect(this.scratchGain).connect(this.input);
      this.scratchNode.port.onmessage = (e) => (this.scratchPos = e.data as number);
    } catch {
      this.scratchNode = null;
    }
  }

  /**
   * Take the record in hand: the normal player pauses, a 6 s window around the current position is handed to the
   * scratch player. `scratchRate()` then drives it (1 = normal speed forward, -1 = backwards, 0 = held).
   */
  scratchBegin() {
    if (!this.buffer || !this.scratchNode || !this.scratchGain || this.scratchResume) return false;
    const sr = this.buffer.sampleRate;
    const pos = this.position;
    const wasPlaying = this._playing;
    const start = Math.max(0, pos - 3);
    const end = Math.min(this.duration, pos + 3);
    const a = Math.floor(start * sr);
    const b = Math.floor(end * sr);
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, this.buffer.numberOfChannels); c++) channels.push(this.buffer.getChannelData(c).slice(a, b));
    this.scratchWin = { start: a / sr, len: b - a };
    this.scratchPos = Math.floor(pos * sr) - a;
    this.scratchNode.port.postMessage({ type: "load", channels, pos: this.scratchPos }, channels.map((x) => x.buffer));
    this.scratchResume = { pos, at: this.ctx.currentTime, wasPlaying };
    if (wasPlaying) {
      this.offset = pos;
      this.killSource();
      this._playing = false;
    }
    const t = this.ctx.currentTime;
    this.scratchNode.parameters.get("rate")!.setValueAtTime(0, t);
    this.scratchGain.gain.setTargetAtTime(1, t, 0.004);
    return true;
  }

  /** Read-head speed relative to normal playback (negative = backwards). */
  scratchRate(r: number, tc = 0.015) {
    if (!this.scratchNode || !this.scratchResume) return;
    const sr = this.buffer?.sampleRate ?? this.ctx.sampleRate;
    const p = this.scratchNode.parameters.get("rate")!;
    p.setTargetAtTime(Math.max(-8, Math.min(8, r)) * (sr / this.ctx.sampleRate) * this._rate, this.ctx.currentTime, tc);
  }

  /**
   * Put the record down. "here": continue from where the hand left the window (vinyl mode).
   * "beat": continue as if the track had kept playing underneath (auto scratch patterns stay in time).
   */
  scratchEnd(mode: "here" | "beat" = "here") {
    const r = this.scratchResume;
    if (!r || !this.scratchNode || !this.scratchGain) return;
    if (this.scratchTimer) clearTimeout(this.scratchTimer);
    this.scratchTimer = null;
    const t = this.ctx.currentTime;
    const sr = this.buffer?.sampleRate ?? 44100;
    const here = this.scratchWin.start + Math.max(0, Math.min(this.scratchWin.len, this.scratchPos)) / sr;
    const elapsed = (t - r.at) * this._rate * this._bend;
    const resumeAt = mode === "beat" ? Math.min(this.duration, r.pos + elapsed) : here;
    this.scratchGain.gain.setTargetAtTime(0, t, 0.004);
    this.scratchNode.parameters.get("rate")!.cancelScheduledValues(t);
    this.scratchNode.parameters.get("rate")!.setTargetAtTime(0, t, 0.01);
    this.scratchResume = null;
    this.offset = Math.max(0, resumeAt);
    if (r.wasPlaying) this.play(t + 0.006);
    this.onScratchEnd?.();
  }

  /**
   * Classic scratch patterns performed by the deck itself over `beats` beats at `bpm` (start = now; the caller
   * quantises). The hand returns the record on the beat so the track continues in time.
   */
  scratchPattern(kind: "baby" | "chirp" | "transformer" | "scribble" | "stab" | "rewind", bpm: number, beats = 2) {
    if (!this.scratchBegin() || !this.scratchNode || !this.scratchGain) return;
    const beat = 60 / bpm;
    const total = beat * beats;
    const t0 = this.ctx.currentTime + 0.005;
    const N = 512;
    const rate = new Float32Array(N);
    const gate = new Float32Array(N);
    const tri = (x: number) => 1 - 4 * Math.abs(((x + 0.25) % 1) - 0.5); // -1..1 triangle (smooth hand)
    for (let i = 0; i < N; i++) {
      const x = i / N; // 0..1 over the pattern
      const tb = x * beats; // beats elapsed
      let r = 1;
      let g = 1;
      switch (kind) {
        case "baby": // forward / back every half beat, slightly faster than play speed
          r = 1.6 * tri(tb * 1); // one full fwd+back per beat
          break;
        case "chirp": // short forward with the fader opening, back with it closing
          r = 1.8 * tri(tb * 2);
          g = r > 0 ? Math.min(1, (tb * 2) % 1 < 0.5 ? 1 : 0.15) : 0.15;
          break;
        case "transformer": // steady slow pull with the fader clicked on/off every 1/8 beat
          r = 0.9 * tri(tb * 0.5);
          g = (tb * 4) % 1 < 0.5 ? 1 : 0;
          break;
        case "scribble": // tiny fast wiggles
          r = 2.2 * tri(tb * 6);
          break;
        case "stab": // push forward hard, then stop and drag back slowly
          r = x < 0.2 ? 3 : x < 0.35 ? 0 : -0.8;
          break;
        case "rewind": // spin backwards accelerating
          r = -0.5 - 5 * x * x;
          break;
      }
      rate[i] = r;
      gate[i] = g;
    }
    const sr = this.buffer?.sampleRate ?? 44100;
    const scale = (sr / this.ctx.sampleRate) * this._rate;
    for (let i = 0; i < N; i++) rate[i] *= scale;
    const rp = this.scratchNode.parameters.get("rate")!;
    rp.cancelScheduledValues(t0);
    rp.setValueCurveAtTime(rate, t0, total);
    if (kind === "chirp" || kind === "transformer") {
      this.scratchGain.gain.cancelScheduledValues(t0);
      this.scratchGain.gain.setValueCurveAtTime(gate, t0, total);
    }
    this.scratchTimer = setTimeout(() => this.scratchEnd(kind === "rewind" ? "here" : "beat"), total * 1000 + 10);
  }

  /** Called by the engine when the key-lock worklet module is available. */
  attachKeylock() {
    if (this.shifter) return;
    try {
      this.shifter = new AudioWorkletNode(this.ctx, "granular-pitch", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      // Overlap-add loses ~1.5 dB of noise-like highs (hats / air); a gentle shelf gives it back so key lock
      // does not sound dull next to the bypassed signal.
      const air = this.ctx.createBiquadFilter();
      air.type = "highshelf";
      air.frequency.value = 5000;
      air.gain.value = 1.5;
      this.shifterIn.connect(this.shifter).connect(air).connect(this.input);
      this.applyPitch();
    } catch {
      this.shifter = null;
    }
  }

  setKeylock(on: boolean) {
    this.keylock = on;
    this.applyPitch();
  }

  /** Routes through the shifter only while key lock is on and the tempo differs from 1 (bypass otherwise). */
  private applyPitch() {
    const rate = this._rate * this._bend;
    const shift = Math.pow(2, this.keyShift / 12);
    const target = (this.keylock ? 1 / rate : 1) * shift;
    const use = !!this.shifter && Math.abs(target - 1) > 0.003;
    const t = this.ctx.currentTime;
    this.direct.gain.setTargetAtTime(use ? 0 : 1, t, 0.01);
    this.shifterIn.gain.setTargetAtTime(use ? 1 : 0, t, 0.01);
    const p = this.shifter?.parameters.get("pitch");
    if (p) p.setTargetAtTime(use ? Math.min(2, Math.max(0.5, target)) : 1, t, 0.01);
  }

  setKeyShift(semitones: number) {
    this.keyShift = Math.max(-6, Math.min(6, Math.round(semitones)));
    this.applyPitch();
  }

  get playing() {
    return this._playing;
  }
  get duration() {
    return this.buffer?.duration ?? 0;
  }
  get rate() {
    return this._rate;
  }

  get position() {
    if (!this.buffer) return 0;
    if (this.scratchResume) return this.scratchWin.start + Math.max(0, Math.min(this.scratchWin.len, this.scratchPos)) / this.buffer.sampleRate;
    if (!this._playing) return this.offset;
    const pos = this.offset + Math.max(0, this.ctx.currentTime - this.startedAt) * this._rate * this._bend;
    const { active, in: li, out: lo } = this.loop;
    // Inside an active loop the source wraps, so the clock has to wrap with it.
    if (active && li != null && lo != null && lo > li && pos >= lo) return li + ((pos - li) % (lo - li));
    return Math.min(pos, this.duration);
  }

  /** Beat phase 0..1 of the current position (0 = on the beat), or null without a BPM. */
  get beatPhase(): number | null {
    const bpm = this.track?.bpm;
    if (!bpm) return null;
    const beats = ((this.position - (this.track?.beatOffset ?? 0)) * bpm) / 60;
    return ((beats % 1) + 1) % 1;
  }

  load(buffer: AudioBuffer, track: TrackMeta) {
    this.stop();
    this.buffer = buffer;
    this.track = track;
    this.cues = track.cues ? [...track.cues] : [null, null, null, null];
    this.cuePoint = track.cuePoint ?? 0;
    this.loop = { in: track.loopIn ?? null, out: track.loopOut ?? null, active: false };
    this.offset = this.cuePoint;
    this.keyShift = 0;
    this.applyTrim();
    this.applyPitch();
  }

  /** Target -14 LUFS (streaming reference); older RMS values aim at -16 dBFS. Trim is limited to ±6 dB. */
  private applyTrim() {
    const l = this.track?.loudness;
    const target = this.track?.loudnessV === 2 ? -14 : -16;
    const db = l == null ? 0 : Math.max(-6, Math.min(6, target - l));
    this.trim.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.05);
  }

  /** Metadata (BPM / grid) updated while the track is loaded. */
  updateTrack(patch: Partial<TrackMeta>) {
    if (this.track) this.track = { ...this.track, ...patch };
    if (patch.loudness != null) this.applyTrim();
  }

  eject() {
    this.stop();
    this.buffer = null;
    this.track = null;
    this.offset = 0;
    this.cuePoint = 0;
  }

  /** Start now, or at AudioContext time `at` (sample-accurate; used to land on the other deck's beat). */
  play(at = 0) {
    if (!this.buffer || this._playing) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this._rate * this._bend;
    this.applyLoopTo(src);
    src.connect(this.direct);
    src.connect(this.shifterIn);
    src.onended = () => {
      if (this.source !== src) return;
      this._playing = false;
      this.offset = this.loop.active && this.loop.in != null ? this.loop.in : 0;
      this.source = null;
      this.onEnded?.();
    };
    const when = Math.max(at, this.ctx.currentTime);
    src.start(when, this.offset);
    this.source = src;
    this.startedAt = when;
    this._playing = true;
  }

  pause() {
    if (!this._playing) return;
    this.offset = this.position;
    this.killSource();
  }

  stop() {
    this.killSource();
    this.offset = 0;
  }

  togglePlay() {
    this.previewing = false;
    if (this._playing) this.pause();
    else this.play();
  }

  /**
   * CDJ cue button, press phase:
   *  playing            -> jump back to the cue point and pause
   *  paused at the cue  -> preview (play while held; see cueRelease)
   *  paused elsewhere   -> set the cue point here
   */
  cuePress() {
    if (!this.buffer) return;
    if (this._playing) {
      this.pause();
      this.offset = this.cuePoint;
      return;
    }
    if (Math.abs(this.offset - this.cuePoint) < 0.02) {
      this.previewing = true;
      this.play();
    } else this.cuePoint = this.offset;
  }

  cueRelease() {
    if (!this.previewing) return;
    this.previewing = false;
    this.pause();
    this.offset = this.cuePoint;
  }

  seek(time: number) {
    if (!Number.isFinite(time)) return;
    const t = Math.max(0, Math.min(time, this.duration));
    const was = this._playing;
    this.killSource();
    this.offset = t;
    if (was) this.play();
  }

  setRate(rate: number) {
    if (!Number.isFinite(rate)) return;
    this.rebase();
    this._rate = rate;
    this.source?.playbackRate.setValueAtTime(rate * this._bend, this.ctx.currentTime);
    this.applyPitch();
  }

  /**
   * Jog-wheel nudge: temporarily scales the playback rate (forwards only; Web Audio cannot play
   * buffers backwards). While paused the caller should scrub with seek() instead.
   */
  bend(mult: number) {
    this.rebase();
    this._bend = Math.max(0.02, Math.min(4, mult));
    this.source?.playbackRate.setTargetAtTime(this._rate * this._bend, this.ctx.currentTime, 0.02);
    this.applyPitch();
  }

  /** Re-anchor the position clock so a rate change does not retro-actively shift the position. */
  private rebase() {
    if (this.source && this._playing && this.ctx.currentTime >= this.startedAt) {
      this.offset = this.position;
      this.startedAt = this.ctx.currentTime;
    }
  }

  setVolume(v: number) {
    this.volume = v;
    const t = this.ctx.currentTime;
    this.fader.gain.cancelScheduledValues(t);
    this.fader.gain.setValueAtTime(this.fader.gain.value, t);
    this.fader.gain.setTargetAtTime(v, t, 0.01);
  }

  /**
   * Start with the fader closed and a low-pass over the sound, then open both over `seconds`
   * (equal-power curve) - the "slow start" a DJ does when opening a set instead of slamming the fader.
   */
  playFadeIn(seconds: number, at = 0) {
    const t0 = Math.max(at, this.ctx.currentTime);
    const v = this.volume;
    this.fader.gain.cancelScheduledValues(t0);
    this.fader.gain.setValueAtTime(0.0001, t0);
    this.fader.gain.exponentialRampToValueAtTime(Math.max(0.0001, v * 0.5), t0 + seconds * 0.5);
    this.fader.gain.linearRampToValueAtTime(v, t0 + seconds);
    if (this.filter >= 0) {
      // Open the low-pass over the fade (skipped when the DJ already has a filter position dialled in).
      this.lpf.frequency.cancelScheduledValues(t0);
      this.lpf.frequency.setValueAtTime(400, t0);
      this.lpf.frequency.exponentialRampToValueAtTime(22000, t0 + seconds * 0.9);
      this.lpf.frequency.setValueAtTime(22000, t0 + seconds * 0.9 + 0.01);
    }
    this.play(t0);
  }

  setEQ(band: "low" | "mid" | "high", db: number) {
    this.eq[band] = db;
    this[band].gain.setTargetAtTime(db, this.ctx.currentTime, 0.01);
  }

  /** value in [-1, 1]: negative = low-pass sweep, positive = high-pass sweep */
  setFilter(value: number) {
    this.filter = value;
    const t = this.ctx.currentTime;
    // Drop any scheduled ramp (fade-in opens the low-pass over time) so this setting always wins.
    this.lpf.frequency.cancelScheduledValues(t);
    this.lpf.frequency.setValueAtTime(this.lpf.frequency.value, t);
    if (value < 0) {
      this.lpf.frequency.setTargetAtTime(22000 * Math.pow(10, value * 3), t, 0.01);
      this.hpf.frequency.setTargetAtTime(10, t, 0.01);
    } else {
      this.lpf.frequency.setTargetAtTime(22000, t, 0.01);
      this.hpf.frequency.setTargetAtTime(10 * Math.pow(10, value * 3), t, 0.01);
    }
  }

  setCrossfadeGain(g: number) {
    this.output.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
  }

  setCue(i: number) {
    this.cues[i] = this.position;
  }
  jumpCue(i: number) {
    const c = this.cues[i];
    if (c == null) this.setCue(i);
    else this.seek(c);
  }
  clearCue(i: number) {
    this.cues[i] = null;
  }

  setLoopIn() {
    this.loop.in = this.position;
    this.loop.out = null;
    this.loop.active = false;
  }
  setLoopOut() {
    if (this.loop.in == null) return;
    this.loop.out = this.position;
    if (this.loop.out <= this.loop.in) return;
    this.loop.active = true;
    this.restartIfPlaying();
  }
  /** Loop of `beats` starting on the nearest beat-grid line (or the current position without a grid). */
  setBeatLoop(beats: number, bpm: number | null) {
    const b = bpm ?? 120;
    const len = (60 / b) * beats;
    let start = this.position;
    if (bpm) {
      const off = this.track?.beatOffset ?? 0;
      start = off + Math.round(((start - off) * bpm) / 60) * (60 / bpm);
      start = Math.max(0, Math.min(start, this.duration - len));
    }
    this.loop.in = start;
    this.loop.out = Math.min(this.duration, start + len);
    this.loop.active = true;
    this.restartIfPlaying();
  }
  /** Halve / double the current loop length, keeping the in-point. */
  scaleLoop(factor: number) {
    if (this.loop.in == null || this.loop.out == null) return;
    const len = (this.loop.out - this.loop.in) * factor;
    if (len < 0.02 || this.loop.in + len > this.duration) return;
    this.loop.out = this.loop.in + len;
    if (this.loop.active) this.restartIfPlaying();
  }
  clearLoop() {
    const was = this.loop.active;
    this.loop = { in: null, out: null, active: false };
    if (was) this.restartIfPlaying();
  }
  toggleLoop() {
    if (this.loop.in == null || this.loop.out == null) return;
    this.loop.active = !this.loop.active;
    this.restartIfPlaying();
  }

  getState(): DeckState {
    return {
      id: this.id,
      track: this.track,
      playing: this._playing,
      position: this.position,
      duration: this.duration,
      rate: this._rate,
      volume: this.volume,
      eq: { ...this.eq },
      filter: this.filter,
      cues: [...this.cues],
      cuePoint: this.cuePoint,
      loop: { ...this.loop },
      keylock: this.keylock,
      keyShift: this.keyShift,
      scratching: this.scratching,
    };
  }

  private applyLoopTo(src: AudioBufferSourceNode) {
    if (this.loop.active && this.loop.in != null && this.loop.out != null) {
      src.loop = true;
      src.loopStart = this.loop.in;
      src.loopEnd = this.loop.out;
    } else src.loop = false;
  }

  private restartIfPlaying() {
    if (!this._playing) return;
    this.offset = this.position;
    this.killSource();
    this.play();
  }

  private killSource() {
    if (this.source) {
      const s = this.source;
      this.source = null;
      try {
        s.stop();
      } catch {}
      s.disconnect();
    }
    this._playing = false;
  }
}
