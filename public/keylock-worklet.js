/**
 * Pitch shifter used as a "key lock" (master tempo) and for semitone key shifts.
 * The deck changes playbackRate for tempo; this node shifts the pitch back by 1/rate (times any key shift).
 *
 * WSOLA-style granular overlap-add: Hann-windowed grains (46 ms, 50% overlap) are read from a ring buffer at the
 * pitch ratio. Each new grain is NOT started at a fixed offset - its start is searched within ±6 ms for the
 * position whose waveform best matches what the still-running grain is about to output (normalised
 * cross-correlation). Without that alignment the two overlapping grains cancel at some frequencies and the
 * result sounds hollow / muffled ("comb filtering"); with it, the overlap is phase-coherent and the highs stay.
 * Bypassed (plain copy, zero latency) when the ratio is 1.
 */
class GranularPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "pitch", defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: "k-rate" }];
  }

  constructor(options) {
    super();
    this.grain = (options && options.processorOptions && options.processorOptions.grain) || 2048;
    this.hop = this.grain / 2;
    this.size = 1 << 16; // ring buffer (1.5 s at 44.1k)
    this.mask = this.size - 1;
    this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
    this.write = 0;
    this.sinceHop = 0;
    this.win = new Float32Array(this.grain);
    for (let i = 0; i < this.grain; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.grain);
    // Two active grains (50% overlap); each has a fractional read head and an index into the window.
    this.grains = [
      { pos: 0, n: this.grain, active: false },
      { pos: 0, n: this.grain, active: false },
    ];
    this.next = 0;
    // Similarity search: ±search samples around the nominal start, compared over `cmp` output samples.
    this.search = Math.round(this.grain * 0.14); // ~6.5 ms at 44.1k for the 2048 grain
    this.cmp = Math.round(this.grain * 0.19);
    this.step = 3; // decimation of the comparison (speed)
  }

  /** Best start position (fractional ring index) for a new grain so it lines up with `other`'s upcoming output. */
  alignedStart(nominal, other, pitch) {
    if (!other.active || other.n + this.cmp * 1 >= this.grain) return nominal;
    const buf = this.buf[0];
    const mask = this.mask;
    const L = this.cmp;
    const step = this.step;
    // Reference: what the running grain will read next (same output clock, same pitch step).
    const ref = this.ref || (this.ref = new Float32Array(this.cmp));
    let refE = 0;
    for (let k = 0; k < L; k += step) {
      const p = other.pos + k * pitch;
      const i0 = Math.floor(p);
      const fr = p - i0;
      const a = buf[i0 & mask];
      const b = buf[(i0 + 1) & mask];
      const v = a + (b - a) * fr;
      ref[k] = v;
      refE += v * v;
    }
    if (refE < 1e-7) return nominal;
    let best = nominal;
    let bestScore = -Infinity;
    // Coarse search every 4 samples, then refine ±4 around the best.
    const evalAt = (start) => {
      let dot = 0;
      let e = 0;
      for (let k = 0; k < L; k += step) {
        const p = start + k * pitch;
        const i0 = Math.floor(p);
        const fr = p - i0;
        const a = buf[i0 & mask];
        const b = buf[(i0 + 1) & mask];
        const v = a + (b - a) * fr;
        dot += v * ref[k];
        e += v * v;
      }
      return e < 1e-7 ? -1 : dot / Math.sqrt(e * refE);
    };
    for (let off = -this.search; off <= this.search; off += 4) {
      const s = evalAt(nominal + off);
      if (s > bestScore) {
        bestScore = s;
        best = nominal + off;
      }
    }
    const coarse = best;
    for (let off = -3; off <= 3; off++) {
      if (off === 0) continue;
      const s = evalAt(coarse + off);
      if (s > bestScore) {
        bestScore = s;
        best = coarse + off;
      }
    }
    return best;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;
    const pitch = params.pitch[0];
    const channels = Math.min(output.length, 2);
    const frames = input[0].length;

    // Always feed the ring buffer so a later pitch change starts with history.
    for (let c = 0; c < channels; c++) {
      const src = input[Math.min(c, input.length - 1)];
      const buf = this.buf[c];
      for (let i = 0; i < frames; i++) buf[(this.write + i) & this.mask] = src[i];
    }

    if (Math.abs(pitch - 1) < 0.0015) {
      // Bypass: identical output, no latency.
      for (let c = 0; c < channels; c++) output[c].set(input[Math.min(c, input.length - 1)]);
      this.write = (this.write + frames) & this.mask;
      this.grains.forEach((g) => (g.active = false));
      this.sinceHop = 0;
      return true;
    }

    // Grains read behind the write head; the read span is grain*pitch plus the search range, so leave that margin.
    const margin = Math.ceil(this.grain * Math.max(pitch, 1)) + this.search + 8;
    for (let c = 0; c < channels; c++) output[c].fill(0);

    for (let i = 0; i < frames; i++) {
      if (this.sinceHop <= 0) {
        const g = this.grains[this.next];
        const other = this.grains[this.next ^ 1];
        this.next ^= 1;
        g.active = true;
        g.n = 0;
        // Nominal start: `margin` samples behind the newest sample we have (write + i); then phase-align it.
        const nominal = (this.write + i - margin + this.size) & this.mask;
        let pos = this.alignedStart(nominal, other, pitch);
        if (pos < 0) pos += this.size;
        if (pos >= this.size) pos -= this.size;
        g.pos = pos;
        this.sinceHop = this.hop;
      }
      this.sinceHop--;
      for (const g of this.grains) {
        if (!g.active) continue;
        const w = this.win[g.n];
        const i0 = Math.floor(g.pos);
        const frac = g.pos - i0;
        for (let c = 0; c < channels; c++) {
          const buf = this.buf[c];
          const a = buf[i0 & this.mask];
          const b = buf[(i0 + 1) & this.mask];
          output[c][i] += (a + (b - a) * frac) * w;
        }
        g.pos += pitch;
        if (g.pos >= this.size) g.pos -= this.size;
        if (++g.n >= this.grain) g.active = false;
      }
    }
    this.write = (this.write + frames) & this.mask;
    return true;
  }
}

registerProcessor("granular-pitch", GranularPitch);
