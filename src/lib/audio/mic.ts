/**
 * MC / rap microphone channel.
 *
 *   mic -> gain -> [pitch shifter] -> voice colour (megaphone band-pass / ring-mod "robot") -> compressor -> master
 *                                                                                   \-> echo send  (tempo-synced)
 *                                                                                   \-> reverb send
 * plus talk-over ducking: while the mic is hot the music bus is pulled down a few dB and released slowly,
 * the way a DJ mixer's talkover switch works.
 */
export type VoicePreset = "clean" | "megaphone" | "robot" | "deep" | "chipmunk" | "radio";

export class MicChannel {
  private ctx: AudioContext;
  private stream: MediaStream | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  readonly input: GainNode;
  private pitchIn: GainNode;
  private direct: GainNode;
  private pitch: AudioWorkletNode | null = null;
  private colourIn: GainNode;
  private band: BiquadFilterNode;
  private bandMix: GainNode;
  private dryMix: GainNode;
  private ring: GainNode;
  private ringOsc: OscillatorNode;
  private ringMix: GainNode;
  private drive: WaveShaperNode;
  private comp: DynamicsCompressorNode;
  readonly out: GainNode;
  readonly echoSend: GainNode;
  readonly reverbSend: GainNode;
  readonly analyser: AnalyserNode;
  private level = new Uint8Array(256);
  private duckGain: GainNode;
  private duckTimer: ReturnType<typeof setInterval> | null = null;
  on = false;
  duck = true;
  voice: VoicePreset = "clean";
  semitones = 0;

  constructor(ctx: AudioContext, musicBus: GainNode, master: AudioNode, echoIn: AudioNode, reverbIn: AudioNode) {
    this.ctx = ctx;
    this.duckGain = musicBus;
    this.input = ctx.createGain();
    this.input.gain.value = 1;
    this.pitchIn = ctx.createGain();
    this.pitchIn.gain.value = 0;
    this.direct = ctx.createGain();
    this.colourIn = ctx.createGain();
    this.input.connect(this.direct).connect(this.colourIn);
    this.input.connect(this.pitchIn);
    // Voice colour: dry path + band-passed "megaphone" path + ring-modulated "robot" path, mixed by preset.
    this.dryMix = ctx.createGain();
    this.band = ctx.createBiquadFilter();
    this.band.type = "bandpass";
    this.band.frequency.value = 1400;
    this.band.Q.value = 1.2;
    this.bandMix = ctx.createGain();
    this.bandMix.gain.value = 0;
    this.drive = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 3) / Math.tanh(3);
    }
    this.drive.curve = curve;
    this.ring = ctx.createGain();
    this.ring.gain.value = 0;
    this.ringOsc = ctx.createOscillator();
    this.ringOsc.frequency.value = 55;
    this.ringOsc.connect(this.ring.gain);
    this.ringOsc.start();
    this.ringMix = ctx.createGain();
    this.ringMix.gain.value = 0;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.15;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.colourIn.connect(this.dryMix).connect(this.comp);
    this.colourIn.connect(this.band).connect(this.drive).connect(this.bandMix).connect(this.comp);
    this.colourIn.connect(this.ring).connect(this.ringMix).connect(this.comp);
    this.comp.connect(this.out).connect(master);
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.comp.connect(this.echoSend).connect(echoIn);
    this.comp.connect(this.reverbSend).connect(reverbIn);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.comp.connect(this.analyser);
  }

  /** Pitch shifter (same worklet as key lock) - attached once the module is loaded. */
  attachPitch() {
    if (this.pitch) return;
    try {
      this.pitch = new AudioWorkletNode(this.ctx, "granular-pitch", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      this.pitchIn.connect(this.pitch).connect(this.colourIn);
      this.applyPitch();
    } catch {
      this.pitch = null;
    }
  }

  async enable(deviceId?: string) {
    this.disable();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: true, autoGainControl: false },
    });
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.src.connect(this.input);
    this.on = true;
    this.out.gain.setTargetAtTime(1, this.ctx.currentTime, 0.02);
    this.startDucking();
  }

  disable() {
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    this.src?.disconnect();
    this.src = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.on = false;
    if (this.duckTimer) clearInterval(this.duckTimer);
    this.duckTimer = null;
    this.duckGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
  }

  setGain(v: number) {
    this.input.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setVoice(v: VoicePreset) {
    this.voice = v;
    const t = this.ctx.currentTime;
    const g = (n: GainNode, x: number) => n.gain.setTargetAtTime(x, t, 0.03);
    g(this.dryMix, v === "megaphone" || v === "radio" || v === "robot" ? 0 : 1);
    g(this.bandMix, v === "megaphone" ? 1.6 : v === "radio" ? 1.2 : 0);
    g(this.ringMix, v === "robot" ? 1.4 : 0);
    this.band.frequency.setTargetAtTime(v === "radio" ? 2000 : 1400, t, 0.03);
    this.band.Q.setTargetAtTime(v === "radio" ? 2.5 : 1.2, t, 0.03);
    this.semitones = v === "deep" ? -5 : v === "chipmunk" ? 6 : 0;
    this.applyPitch();
  }

  setSemitones(s: number) {
    this.semitones = Math.max(-12, Math.min(12, s));
    this.applyPitch();
  }

  private applyPitch() {
    const t = this.ctx.currentTime;
    const use = !!this.pitch && this.semitones !== 0;
    this.direct.gain.setTargetAtTime(use ? 0 : 1, t, 0.01);
    this.pitchIn.gain.setTargetAtTime(use ? 1 : 0, t, 0.01);
    this.pitch?.parameters.get("pitch")?.setTargetAtTime(use ? Math.pow(2, this.semitones / 12) : 1, t, 0.01);
  }

  setEcho(amount: number) {
    this.echoSend.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.02);
  }

  setReverb(amount: number) {
    this.reverbSend.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.02);
  }

  /** Current mic level 0..1 (RMS). */
  get rms() {
    this.analyser.getByteTimeDomainData(this.level);
    let s = 0;
    for (let i = 0; i < this.level.length; i++) s += ((this.level[i] - 128) / 128) ** 2;
    return Math.sqrt(s / this.level.length);
  }

  private startDucking() {
    if (this.duckTimer) clearInterval(this.duckTimer);
    let hot = 0;
    this.duckTimer = setInterval(() => {
      if (!this.on) return;
      const speaking = this.rms > 0.05;
      hot = speaking ? 1 : Math.max(0, hot - 0.08); // ~600 ms release
      const target = this.duck ? 1 - 0.6 * hot : 1; // -8 dB while talking
      this.duckGain.gain.setTargetAtTime(target, this.ctx.currentTime, speaking ? 0.03 : 0.25);
    }, 50);
  }
}
