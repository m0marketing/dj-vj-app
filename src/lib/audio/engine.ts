import { Deck } from "./deck";
import { Sampler } from "./sampler";
import { FeatureExtractor } from "./features";
import { Sequencer } from "./sequencer";
import { MicChannel } from "./mic";
import type { DeckId } from "../types";

/** Decoded audio kept in memory (bytes). A 3-minute stereo track is ~60 MB, so this is ~6 tracks. */
const CACHE_BYTES = 400 * 1024 * 1024;
const bytesOf = (b: AudioBuffer) => b.length * b.numberOfChannels * 4;

/**
 * Singleton Web Audio graph:
 *
 *  Deck A ─┐
 *  Deck B ─┼─> master ─> compressor ─> analyser ─> destination
 *  Sampler ┘                                   └─> recorder (MediaStreamDestination)
 *  Preview ┘  (library audition, bypasses the crossfader)
 */
export type FxName = "echo" | "reverb" | "flanger";

/** Exponentially decaying stereo noise: a cheap, smooth hall impulse response. */
function makeImpulse(ctx: BaseAudioContext, seconds = 2.4) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += ((Math.random() * 2 - 1) - lp) * 0.35; // darker tail
      d[i] = lp * Math.pow(1 - i / n, 3.2);
    }
  }
  return buf;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly decks: Record<DeckId, Deck>;
  readonly sampler: Sampler;
  readonly sequencer: Sequencer;
  /** Tempo the sequencer follows when no deck is playing (BPM). */
  seqBpm = 124;
  /** Supplied by the store: BPM of the playing deck or null. */
  deckBpm: () => number | null = () => null;
  readonly master: GainNode;
  readonly analyser: AnalyserNode;
  private masterFilter: BiquadFilterNode;
  readonly features: FeatureExtractor;
  private recorderDest: MediaStreamAudioDestinationNode;
  /** Music bus (decks + sampler) ahead of the master so the mic can duck it. */
  private musicBus: GainNode;
  readonly mic: MicChannel;
  /**
   * Headphone cue bus. Web Audio has one output device per context, so the cue mix goes to a
   * MediaStreamAudioDestinationNode and is played by an <audio> element whose sink can be chosen with
   * HTMLMediaElement.setSinkId() (the standard way to get a second output in the browser).
   */
  private cueBus: GainNode;
  private cueMaster: GainNode;
  private cueDest: MediaStreamAudioDestinationNode;
  private cueEl: HTMLAudioElement | null = null;
  cueDeviceId = "";
  cueMix = 0; // 0 = cue only, 1 = master only
  cueOn: Record<"A" | "B", boolean> = { A: false, B: false };
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private _crossfader = 0.5;
  private decodeCache = new Map<string, AudioBuffer>();
  private cacheBytes = 0;
  private previewGain: GainNode;
  private fxSend: Record<FxName, GainNode>;
  private repDry: GainNode;
  private repIn: GainNode;
  private repDelay: DelayNode;
  private repFb: GainNode;
  private repOut: GainNode;
  private echoDelay: DelayNode;
  private echoFb: GainNode;
  private previewSrc: AudioBufferSourceNode | null = null;
  onPreviewEnd?: () => void;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.ratio.value = 4;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.recorderDest = this.ctx.createMediaStreamDestination();

    this.masterFilter = this.ctx.createBiquadFilter();
    this.masterFilter.type = "highpass";
    this.masterFilter.frequency.value = 10;
    // Beat repeat: master -> dry gate -> filter. While repeating, the dry gate closes and a delay loop with unity
    // feedback holds the slice that was captured through repIn for exactly one slice length.
    this.repDry = this.ctx.createGain();
    this.repIn = this.ctx.createGain();
    this.repIn.gain.value = 0;
    this.repDelay = this.ctx.createDelay(2);
    this.repFb = this.ctx.createGain();
    this.repFb.gain.value = 0;
    this.repOut = this.ctx.createGain();
    this.repOut.gain.value = 0;
    this.master.connect(this.repDry).connect(this.masterFilter);
    this.master.connect(this.repIn).connect(this.repDelay);
    this.repDelay.connect(this.repFb).connect(this.repDelay);
    this.repDelay.connect(this.repOut).connect(this.masterFilter);
    // Output protection: a fast limiter (ceiling -1 dBFS) followed by a soft clipper. Double drops, sampler and
    // mic can sum well above 0 dBFS; this keeps the PA from hard-clipping without audibly squashing normal levels.
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    const clip = this.ctx.createWaveShaper();
    const curve = new Float32Array(4096);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.abs(x) < 0.9 ? x : Math.sign(x) * (0.9 + 0.1 * Math.tanh((Math.abs(x) - 0.9) / 0.1));
    }
    clip.curve = curve;
    clip.oversample = "2x";
    this.masterFilter.connect(comp).connect(limiter).connect(clip).connect(this.analyser).connect(this.ctx.destination);
    this.analyser.connect(this.recorderDest);

    this.cueBus = this.ctx.createGain();
    this.cueMaster = this.ctx.createGain();
    this.cueMaster.gain.value = 0;
    this.cueDest = this.ctx.createMediaStreamDestination();
    this.cueBus.connect(this.cueDest);
    this.analyser.connect(this.cueMaster).connect(this.cueDest);

    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.decks = { A: new Deck(this.ctx, "A"), B: new Deck(this.ctx, "B") };
    this.decks.A.cueSend.connect(this.cueBus);
    this.decks.B.cueSend.connect(this.cueBus);
    this.decks.A.output.connect(this.musicBus);
    this.decks.B.output.connect(this.musicBus);
    this.sampler = new Sampler(this.ctx);
    this.sequencer = new Sequencer(this.ctx, this.sampler, () => this.deckBpm() ?? this.seqBpm);
    this.sampler.analyser.connect(this.musicBus);
    this.previewGain = this.ctx.createGain();
    this.previewGain.gain.value = 0.8;
    this.previewGain.connect(this.master);
    this.features = new FeatureExtractor(this.analyser);
    this.setCrossfader(0.5);

    // Master effect rack: parallel sends tapped from the master bus, returned ahead of the master filter.
    const fxOut = this.ctx.createGain();
    fxOut.connect(this.masterFilter);
    const send = () => {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      this.master.connect(g);
      return g;
    };
    this.fxSend = { echo: send(), reverb: send(), flanger: send() };
    // Echo: feedback delay with a darkening loop filter.
    this.echoDelay = this.ctx.createDelay(2);
    this.echoDelay.delayTime.value = 0.375;
    this.echoFb = this.ctx.createGain();
    this.echoFb.gain.value = 0.5;
    const damp = this.ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 3200;
    this.fxSend.echo.connect(this.echoDelay);
    this.echoDelay.connect(damp);
    damp.connect(this.echoFb).connect(this.echoDelay);
    damp.connect(fxOut);
    // Reverb: convolution with a generated hall.
    const conv = this.ctx.createConvolver();
    conv.buffer = makeImpulse(this.ctx);
    const revOut = this.ctx.createGain();
    revOut.gain.value = 0.55;
    this.fxSend.reverb.connect(conv).connect(revOut).connect(fxOut);
    // MC / rap mic: its own echo / reverb sends into the same effect returns, talk-over ducks the music bus.
    this.mic = new MicChannel(this.ctx, this.musicBus, this.master, this.echoDelay, conv);
    // Flanger: short LFO-swept delay with feedback.
    const fl = this.ctx.createDelay(0.02);
    fl.delayTime.value = 0.004;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.22;
    const lfoDepth = this.ctx.createGain();
    lfoDepth.gain.value = 0.0028;
    lfo.connect(lfoDepth).connect(fl.delayTime);
    lfo.start();
    const flFb = this.ctx.createGain();
    flFb.gain.value = 0.6;
    this.fxSend.flanger.connect(fl);
    fl.connect(flFb).connect(fl);
    const flOut = this.ctx.createGain();
    flOut.gain.value = 0.9;
    fl.connect(flOut).connect(fxOut);

    // iOS / background tabs suspend the context; wake it up when the page is visible again.
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void this.resume());
    this.ctx.onstatechange = () => {
      if (this.ctx.state === "interrupted" as string) void this.resume();
    };
  }

  private keylockReady: Promise<void> | null = null;

  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
    if (!this.keylockReady) {
      this.keylockReady = this.ctx.audioWorklet
        .addModule("/keylock-worklet.js")
        .then(() => {
          this.decks.A.attachKeylock();
          this.decks.B.attachKeylock();
          this.mic.attachPitch();
        })
        .catch((e) => console.warn("key lock unavailable", e));
      void this.ctx.audioWorklet
        .addModule("/scratch-worklet.js")
        .then(() => {
          this.decks.A.attachScratch();
          this.decks.B.attachScratch();
        })
        .catch((e) => console.warn("scratch unavailable", e));
    }
    await this.keylockReady;
  }

  async decode(id: string, blob: Blob): Promise<AudioBuffer> {
    const cached = this.decodeCache.get(id);
    if (cached) {
      // Refresh LRU order.
      this.decodeCache.delete(id);
      this.decodeCache.set(id, cached);
      return cached;
    }
    return this.cache(id, await this.ctx.decodeAudioData(await blob.arrayBuffer()));
  }

  /** Adds a buffer to the LRU cache; buffers loaded in a deck are never evicted. */
  cache(id: string, buf: AudioBuffer) {
    const old = this.decodeCache.get(id);
    if (old) this.cacheBytes -= bytesOf(old);
    this.decodeCache.set(id, buf);
    this.cacheBytes += bytesOf(buf);
    const pinned = new Set([this.decks.A.track?.id, this.decks.B.track?.id]);
    for (const [k, v] of this.decodeCache) {
      if (this.cacheBytes <= CACHE_BYTES) break;
      if (k === id || pinned.has(k)) continue;
      this.decodeCache.delete(k);
      this.cacheBytes -= bytesOf(v);
    }
    return buf;
  }

  uncache(id: string) {
    const b = this.decodeCache.get(id);
    if (!b) return;
    this.decodeCache.delete(id);
    this.cacheBytes -= bytesOf(b);
  }

  get crossfader() {
    return this._crossfader;
  }

  /** 0 = full A, 1 = full B (equal-power curve) */
  setCrossfader(x: number) {
    if (!Number.isFinite(x)) return;
    x = Math.max(0, Math.min(1, x));
    this._crossfader = x;
    this.decks.A.setCrossfadeGain(Math.cos((x * Math.PI) / 2));
    this.decks.B.setCrossfadeGain(Math.sin((x * Math.PI) / 2));
  }

  /** True when this browser can route the cue to a second output device. */
  static get cueSupported() {
    return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype && !!navigator.mediaDevices?.enumerateDevices;
  }

  /** Route the cue mix to an output device (empty id = stop). Returns false if the browser refused. */
  async setCueDevice(deviceId: string): Promise<boolean> {
    this.cueDeviceId = deviceId;
    if (!deviceId) {
      if (this.cueEl) {
        this.cueEl.pause();
        this.cueEl.srcObject = null;
        this.cueEl = null;
      }
      return true;
    }
    try {
      if (!this.cueEl) {
        this.cueEl = new Audio();
        this.cueEl.autoplay = true;
        this.cueEl.srcObject = this.cueDest.stream;
      }
      await (this.cueEl as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId);
      await this.cueEl.play();
      return true;
    } catch (e) {
      console.warn("cue sink", e);
      this.cueDeviceId = "";
      return false;
    }
  }

  setCue(deck: "A" | "B", on: boolean) {
    this.cueOn[deck] = on;
    this.decks[deck].cueSend.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  /** Cue / master blend in the headphones (0 = cue only, 1 = master only). */
  setCueMix(x: number) {
    this.cueMix = x;
    const t = this.ctx.currentTime;
    this.cueBus.gain.setTargetAtTime(Math.cos((x * Math.PI) / 2), t, 0.02);
    this.cueMaster.gain.setTargetAtTime(Math.sin((x * Math.PI) / 2), t, 0.02);
  }

  /** Hold-style filter sweep on the whole mix (null = release). */
  setFilterFx(mode: "hpf" | "lpf" | null) {
    const f = this.masterFilter;
    const t = this.ctx.currentTime;
    f.frequency.cancelScheduledValues(t);
    if (!mode) {
      f.frequency.setTargetAtTime(f.type === "lowpass" ? 22000 : 10, t, 0.06);
      f.Q.setTargetAtTime(0.7, t, 0.06);
      return;
    }
    const hp = mode === "hpf";
    f.type = hp ? "highpass" : "lowpass";
    f.Q.value = 3;
    f.frequency.setValueAtTime(hp ? 10 : 22000, t);
    f.frequency.exponentialRampToValueAtTime(hp ? 3000 : 250, t + 2);
  }

  /**
   * Gater: tempo-synced on/off of the music bus (1/8 or 1/16 notes) - the "stutter the whole mix" trick.
   * `division` in beats (0.5 = 1/8, 0.25 = 1/16), null = release. Uses the music bus so the mic stays clean.
   */
  gate(division: number | null, bpm = 128) {
    const g = this.musicBus.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    if (!division) {
      g.setTargetAtTime(this.micDuck, t, 0.01);
      return;
    }
    const step = (60 / bpm) * division;
    // Schedule 4 bars of gating; the caller re-arms before it runs out while held.
    const n = Math.ceil((16 * 60) / bpm / step);
    for (let i = 0; i < n; i++) {
      const on = t + i * step;
      g.setValueAtTime(this.micDuck, on);
      g.setTargetAtTime(0.0001, on + step * 0.5, 0.004);
      g.setValueAtTime(0.0001, on + step * 0.98);
    }
    g.setValueAtTime(this.micDuck, t + n * step);
  }
  /** Current talk-over gain the gater must return to (1 when the mic is not ducking). */
  get micDuck() {
    return this.mic?.on && this.mic.duck ? Math.max(0.3, this.musicBus.gain.value) : 1;
  }

  /** One-shot filter rise: high-pass sweeps up over `bars` bars and snaps open on the bar line (build without a drop sample). */
  filterRise(bars: number, bpm = 128) {
    const f = this.masterFilter;
    const t = this.ctx.currentTime;
    const dur = (bars * 240) / bpm;
    f.frequency.cancelScheduledValues(t);
    f.type = "highpass";
    f.Q.setValueAtTime(2.5, t);
    f.frequency.setValueAtTime(10, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + dur);
    f.frequency.setValueAtTime(10, t + dur + 0.005);
    f.Q.setTargetAtTime(0.7, t + dur + 0.01, 0.05);
  }

  setMasterVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  /**
   * Master effect send, `amount` 0..1 (0 = off). Echo time follows `bpm` (dotted eighth); the echo tail
   * keeps ringing after the send closes, which is what makes echo-out transitions work.
   */
  /** Keep the shared echo in time with the music (used by the mic echo when the master echo is off). */
  syncEchoTempo(bpm = 128) {
    this.echoDelay.delayTime.setTargetAtTime(Math.min(1.9, (60 / bpm) * 0.75), this.ctx.currentTime, 0.02);
  }

  setFx(name: FxName, amount: number, bpm = 128) {
    const t = this.ctx.currentTime;
    if (name === "echo" && amount > 0) {
      this.echoDelay.delayTime.setTargetAtTime(Math.min(1.9, (60 / bpm) * 0.75), t, 0.02);
      this.echoFb.gain.setTargetAtTime(0.45 + amount * 0.25, t, 0.05);
    }
    const scale = name === "echo" ? 0.95 : name === "reverb" ? 1 : 0.8;
    this.fxSend[name].gain.setTargetAtTime(amount * scale, t, 0.02);
  }

  /**
   * Beat repeat (stutter) on the whole mix. `beats` = slice length in beats (1, 0.5, 0.25, 0.125) at `bpm`;
   * capture starts at AudioContext time `at` (align it to a beat). null releases back to the live signal.
   */
  beatRepeat(beats: number | null, bpm = 128, at = this.ctx.currentTime) {
    const t = Math.max(at, this.ctx.currentTime);
    const g = (node: GainNode, v: number, when = t, tc = 0.004) => {
      node.gain.cancelScheduledValues(when);
      node.gain.setTargetAtTime(v, when, tc);
    };
    if (beats == null) {
      g(this.repDry, 1);
      g(this.repOut, 0);
      g(this.repFb, 0);
      g(this.repIn, 0);
      return;
    }
    const len = Math.min(1.9, (60 / bpm) * beats);
    this.repDelay.delayTime.cancelScheduledValues(t);
    this.repDelay.delayTime.setValueAtTime(len, t);
    // Open the input for one slice, then seal the loop (feedback 1) and mute the dry path.
    g(this.repIn, 1, t, 0.001);
    g(this.repIn, 0, t + len, 0.001);
    g(this.repFb, 1, t + len, 0.001);
    g(this.repDry, 0, t + len, 0.004);
    g(this.repOut, 1, t, 0.001);
  }

  /** Audition a buffer on the master bus (library preview). `offset` in seconds; call with null to stop. */
  preview(buffer: AudioBuffer | null, offset = 0, maxSeconds = 20) {
    if (this.previewSrc) {
      const s = this.previewSrc;
      this.previewSrc = null;
      try {
        s.stop();
      } catch {}
      s.disconnect();
    }
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.previewGain);
    src.onended = () => {
      if (this.previewSrc === src) {
        this.previewSrc = null;
        this.onPreviewEnd?.();
      }
    };
    const start = Math.min(Math.max(0, offset), Math.max(0, buffer.duration - 0.1));
    src.start(0, start, Math.min(maxSeconds, buffer.duration - start));
    this.previewSrc = src;
  }

  get previewing() {
    return this.previewSrc != null;
  }

  get recording() {
    return this.recorder?.state === "recording";
  }

  startRecording() {
    if (this.recording) return;
    this.chunks = [];
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    this.recorder = new MediaRecorder(this.recorderDest.stream, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(1000);
  }

  stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const r = this.recorder;
      if (!r || r.state === "inactive") return resolve(null);
      r.onstop = () => resolve(new Blob(this.chunks, { type: r.mimeType }));
      r.stop();
    });
  }
}

let engine: AudioEngine | null = null;

export function getEngine(): AudioEngine {
  if (typeof window === "undefined") throw new Error("AudioEngine is client-only");
  if (!engine) engine = new AudioEngine();
  return engine;
}
