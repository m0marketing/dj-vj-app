/**
 * Scratch player: plays a short window of a track at any rate, including negative (backwards), with linear
 * interpolation - AudioBufferSourceNode cannot go backwards, which is why scratching needs this.
 * The deck posts a window (Float32Array per channel) and a start position; the `rate` AudioParam (a-rate) drives
 * the read head so scratch patterns can be scheduled with setValueCurveAtTime and vinyl-mode can follow the hand.
 * The current position is posted back every quantum so the deck can resume the normal player where the hand left it.
 */
class ScratchPlayer extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "rate", defaultValue: 0, minValue: -8, maxValue: 8, automationRate: "a-rate" }];
  }

  constructor() {
    super();
    this.ch = [];
    this.pos = 0;
    this.len = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "load") {
        this.ch = m.channels;
        this.len = this.ch[0] ? this.ch[0].length : 0;
        this.pos = m.pos || 0;
      } else if (m.type === "seek") this.pos = m.pos;
    };
  }

  process(inputs, outputs, params) {
    const out = outputs[0];
    if (!out || !out.length) return true;
    const frames = out[0].length;
    const rates = params.rate;
    const nch = Math.min(out.length, 2);
    if (!this.len) {
      for (let c = 0; c < nch; c++) out[c].fill(0);
      return true;
    }
    for (let i = 0; i < frames; i++) {
      const r = rates.length > 1 ? rates[i] : rates[0];
      const p = this.pos;
      const i0 = Math.floor(p);
      const fr = p - i0;
      for (let c = 0; c < nch; c++) {
        const src = this.ch[Math.min(c, this.ch.length - 1)];
        const a = i0 >= 0 && i0 < this.len ? src[i0] : 0;
        const b = i0 + 1 >= 0 && i0 + 1 < this.len ? src[i0 + 1] : 0;
        out[c][i] = a + (b - a) * fr;
      }
      this.pos = Math.max(-1, Math.min(this.len, p + r));
    }
    this.port.postMessage(this.pos);
    return true;
  }
}

registerProcessor("scratch-player", ScratchPlayer);
